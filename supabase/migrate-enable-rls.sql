-- Enable Row Level Security on the public tables.
--
-- Intent: the widget's browser runtime never talks to Supabase directly —
-- all access goes through the Vercel API functions, which use a
-- service_role key that bypasses RLS.
--
-- With RLS enabled and NO policies defined, the anon/public roles are
-- denied everything by default. This means:
--   - The server-side API (using service_role) keeps working.
--   - Anyone with the old anon/publishable key can't read, write, or
--     delete any row via the Supabase client SDK.
--
-- Before running this migration:
--   1. In the Supabase dashboard, copy the service_role key.
--   2. Set SUPABASE_SERVICE_ROLE_KEY on the Vercel deployment to that value.
--   3. Remove the old SUPABASE_KEY env var.
--   4. Deploy the api/ handlers (updated to read SUPABASE_SERVICE_ROLE_KEY).
--
-- Only after the API is deploying with the service_role key should you
-- run this migration. Otherwise the API will start returning 500s the
-- moment RLS is enabled.

alter table comments enable row level security;
alter table projects enable row level security;
