ALTER TABLE "comment_external_work" DROP CONSTRAINT "comment_external_work_provider_check";--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "container_id" text;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "lifecycle_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "sync_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "sync_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD COLUMN "granted_scopes" text;--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD CONSTRAINT "comment_external_work_lifecycle_check" CHECK ("comment_external_work"."lifecycle_status" in ('active', 'closing', 'closed', 'failed', 'blocked'));--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD CONSTRAINT "comment_external_work_lifecycle_lease_check" CHECK ((
        ("comment_external_work"."lifecycle_status" = 'closing' and "comment_external_work"."sync_lease_token" is not null and "comment_external_work"."sync_lease_expires_at" is not null)
        or
        ("comment_external_work"."lifecycle_status" <> 'closing' and "comment_external_work"."sync_lease_token" is null and "comment_external_work"."sync_lease_expires_at" is null)
      ));--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD CONSTRAINT "comment_external_work_creation_lifecycle_check" CHECK ("comment_external_work"."state" = 'created' or "comment_external_work"."lifecycle_status" = 'active');--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD CONSTRAINT "comment_external_work_closed_at_check" CHECK (("comment_external_work"."lifecycle_status" = 'closed') = ("comment_external_work"."closed_at" is not null));--> statement-breakpoint
ALTER TABLE "comment_external_work" ADD CONSTRAINT "comment_external_work_provider_check" CHECK ("comment_external_work"."provider" in ('github', 'linear', 'jira'));--> statement-breakpoint

-- GitHub issue creation follows the same review-status policy as Linear and
-- Jira: pending and approved feedback may create work; rejected feedback may
-- not. The original fencing functions predated creation-from-open feedback and
-- required `approved`, which made a normal pending comment look like another
-- request already held its lease.
CREATE OR REPLACE FUNCTION public.claim_comment_github_issue(
	p_comment_id uuid,
	p_project_key text,
	p_lease_token uuid,
	p_lease_seconds integer,
	p_recovery boolean DEFAULT false
)
RETURNS SETOF public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('crrt-github-issue:' || p_project_key, 0));

	RETURN QUERY
	UPDATE public.comments AS comment
	SET
		github_issue_lease_token = p_lease_token,
		github_issue_lease_expires_at = now() + make_interval(
			secs => least(greatest(p_lease_seconds, 30), 900)
		)
	WHERE comment.id = p_comment_id
		AND comment.project_id = p_project_key
		AND comment.status IN ('pending', 'approved')
		AND comment.github_issue_number IS NULL
		AND (
			(p_recovery AND comment.github_issue_uncertain_at IS NOT NULL)
			OR
			(NOT p_recovery AND comment.github_issue_uncertain_at IS NULL)
		)
		AND (
			comment.github_issue_lease_token IS NULL
			OR comment.github_issue_lease_expires_at <= now()
		)
	RETURNING comment.*;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.finalize_comment_github_issue(
	p_comment_id uuid,
	p_project_key text,
	p_lease_token uuid,
	p_issue_number integer,
	p_issue_url text,
	p_issue_created_at timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_updated integer;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('crrt-github-issue:' || p_project_key, 0));

	UPDATE public.comments AS comment
	SET
		github_issue_number = p_issue_number,
		github_issue_url = p_issue_url,
		github_issue_created_at = p_issue_created_at,
		github_issue_lease_token = NULL,
		github_issue_lease_expires_at = NULL,
		github_issue_uncertain_at = NULL
	WHERE comment.id = p_comment_id
		AND comment.project_id = p_project_key
		AND comment.status IN ('pending', 'approved')
		AND comment.github_issue_lease_token = p_lease_token
		AND comment.github_issue_number IS NULL;

	GET DIAGNOSTICS v_updated = ROW_COUNT;
	RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.mark_comment_github_issue_uncertain(
	p_comment_id uuid,
	p_project_key text,
	p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_updated integer;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('crrt-github-issue:' || p_project_key, 0));

	UPDATE public.comments AS comment
	SET
		github_issue_uncertain_at = COALESCE(comment.github_issue_uncertain_at, now())
	WHERE comment.id = p_comment_id
		AND comment.project_id = p_project_key
		AND comment.status IN ('pending', 'approved')
		AND comment.github_issue_lease_token = p_lease_token
		AND comment.github_issue_number IS NULL;

	GET DIAGNOSTICS v_updated = ROW_COUNT;
	RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reset_comment_github_issue_attempt(
	p_comment_id uuid,
	p_project_key text,
	p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_updated integer;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('crrt-github-issue:' || p_project_key, 0));

	UPDATE public.comments AS comment
	SET
		github_issue_lease_token = NULL,
		github_issue_lease_expires_at = NULL,
		github_issue_uncertain_at = NULL
	WHERE comment.id = p_comment_id
		AND comment.project_id = p_project_key
		AND comment.status IN ('pending', 'approved')
		AND comment.github_issue_lease_token = p_lease_token
		AND comment.github_issue_number IS NULL;

	GET DIAGNOSTICS v_updated = ROW_COUNT;
	RETURN v_updated = 1;
END;
$$;
