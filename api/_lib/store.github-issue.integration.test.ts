import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('comment GitHub issue database fencing', () => {
  const sql = postgres(databaseUrl as string, { max: 6 })
  const projectKey = `github-issue-${randomUUID()}`
  const commentIds = Array.from({ length: 6 }, () => randomUUID())
  const actorUserId = randomUUID()
  const targetUserId = randomUUID()

  beforeAll(async () => {
    await sql`
      insert into auth.users (id, email)
      values
        (${actorUserId}::uuid, ${`actor-${actorUserId}@example.com`}),
        (${targetUserId}::uuid, ${`target-${targetUserId}@example.com`})
    `
    await sql`
      insert into projects (public_key, slug, name, allowed_origins, claimable)
      values (${projectKey}, ${projectKey}, 'GitHub issue fencing', '{}', false)
    `
    await sql`
      insert into project_members (project_key, user_id, role, is_owner)
      values
        (${projectKey}, ${actorUserId}::uuid, 'admin', true),
        (${projectKey}, ${targetUserId}::uuid, 'member', false)
    `
    await sql`
      insert into comments (id, project_id, comment, status)
      values
        (${commentIds[0]}, ${projectKey}, 'first', 'approved'),
        (${commentIds[1]}, ${projectKey}, 'second', 'approved'),
        (${commentIds[2]}, ${projectKey}, 'third', 'approved'),
        (${commentIds[3]}, ${projectKey}, 'fourth', 'approved'),
        (${commentIds[4]}, ${projectKey}, 'fifth', 'approved'),
        (${commentIds[5]}, ${projectKey}, 'pending', 'pending')
    `
  })

  afterAll(async () => {
    await sql`delete from comments where project_id = ${projectKey}`
    await sql`delete from projects where public_key = ${projectKey}`
    await sql`delete from auth.users where id in (${actorUserId}::uuid, ${targetUserId}::uuid)`
    await sql.end()
  })

  async function claim(
    commentId: string,
    token: string,
    recovery = false,
    scopedProject = projectKey,
  ) {
    return sql`
      select id
      from claim_comment_github_issue(
        ${commentId}::uuid,
        ${scopedProject},
        ${token}::uuid,
        300,
        ${recovery}
      )
    `
  }

  it('allows exactly one concurrent claimant and rejects cross-project claims', async () => {
    const firstToken = randomUUID()
    const secondToken = randomUUID()
    const [first, second] = await Promise.all([
      claim(commentIds[0], firstToken),
      claim(commentIds[0], secondToken),
    ])

    expect(first.length + second.length).toBe(1)
    const winner = first.length ? firstToken : secondToken
    await expect(claim(commentIds[0], randomUUID(), false, 'another-project'))
      .resolves.toHaveLength(0)

    const released = await sql`
      select release_comment_github_issue(
        ${commentIds[0]}::uuid,
        ${projectKey},
        ${winner}::uuid
      ) as released
    `
    expect(released[0].released).toBe(true)
  })

  it('fences review changes until the database lease is released', async () => {
    const token = randomUUID()
    await expect(claim(commentIds[1], token)).resolves.toHaveLength(1)

    await expect(sql`
      select *
      from update_comment_review_status(
        ${commentIds[1]}::uuid,
        ${projectKey},
        'rejected'
      )
    `).rejects.toThrow('github_issue_creation_in_progress')

    await expect(sql`
      select *
      from write_github_repo_connection_if_admin(
        ${projectKey},
        ${randomUUID()}::uuid,
        0,
        null,
        null,
        null,
        null
      )
    `).rejects.toThrow('github_issue_creation_in_progress')

    await expect(sql`
      select remove_project_member(
        ${projectKey},
        ${actorUserId}::uuid,
        ${targetUserId}::uuid
      )
    `).rejects.toThrow('github_issue_creation_in_progress')

    await sql`
      select release_comment_github_issue(
        ${commentIds[1]}::uuid,
        ${projectKey},
        ${token}::uuid
      )
    `
    const updated = await sql`
      select status
      from update_comment_review_status(
        ${commentIds[1]}::uuid,
        ${projectKey},
        'rejected'
      )
    `
    expect(updated[0].status).toBe('rejected')
  })

  it('requires explicit recovery for indeterminate creation attempts', async () => {
    const firstToken = randomUUID()
    await expect(claim(commentIds[2], firstToken)).resolves.toHaveLength(1)
    const marked = await sql`
      select mark_comment_github_issue_uncertain(
        ${commentIds[2]}::uuid,
        ${projectKey},
        ${firstToken}::uuid
      ) as marked
    `
    expect(marked[0].marked).toBe(true)

    await sql`
      select release_comment_github_issue(
        ${commentIds[2]}::uuid,
        ${projectKey},
        ${firstToken}::uuid
      )
    `
    await expect(claim(commentIds[2], randomUUID())).resolves.toHaveLength(0)
    const recoveryToken = randomUUID()
    await expect(claim(commentIds[2], recoveryToken, true)).resolves.toHaveLength(1)

    const finalized = await sql`
      select finalize_comment_github_issue(
        ${commentIds[2]}::uuid,
        ${projectKey},
        ${recoveryToken}::uuid,
        17,
        'https://github.com/acme/site/issues/17',
        now()
      ) as finalized
    `
    expect(finalized[0].finalized).toBe(true)
  })

  it('resets deterministic failures so a regular retry can claim', async () => {
    const token = randomUUID()
    await expect(claim(commentIds[4], token)).resolves.toHaveLength(1)
    await sql`
      select mark_comment_github_issue_uncertain(
        ${commentIds[4]}::uuid,
        ${projectKey},
        ${token}::uuid
      )
    `
    const reset = await sql`
      select reset_comment_github_issue_attempt(
        ${commentIds[4]}::uuid,
        ${projectKey},
        ${token}::uuid
      ) as reset
    `
    expect(reset[0].reset).toBe(true)
    await expect(claim(commentIds[4], randomUUID())).resolves.toHaveLength(1)
  })

  it('allows pending feedback through the complete GitHub creation lifecycle', async () => {
    const firstToken = randomUUID()
    await expect(claim(commentIds[5], firstToken)).resolves.toHaveLength(1)
    const marked = await sql`
      select mark_comment_github_issue_uncertain(
        ${commentIds[5]}::uuid,
        ${projectKey},
        ${firstToken}::uuid
      ) as marked
    `
    expect(marked[0].marked).toBe(true)

    const reset = await sql`
      select reset_comment_github_issue_attempt(
        ${commentIds[5]}::uuid,
        ${projectKey},
        ${firstToken}::uuid
      ) as reset
    `
    expect(reset[0].reset).toBe(true)

    const finalToken = randomUUID()
    await expect(claim(commentIds[5], finalToken)).resolves.toHaveLength(1)
    const finalized = await sql`
      select finalize_comment_github_issue(
        ${commentIds[5]}::uuid,
        ${projectKey},
        ${finalToken}::uuid,
        23,
        'https://github.com/acme/site/issues/23',
        now()
      ) as finalized
    `
    expect(finalized[0].finalized).toBe(true)
  })

  it('enforces all-or-none issue metadata and paired lease fields', async () => {
    await expect(sql`
      update comments
      set github_issue_url = 'https://github.com/acme/site/issues/1'
      where id = ${commentIds[3]}::uuid
    `).rejects.toThrow('comments_github_issue_fields_check')

    await expect(sql`
      update comments
      set github_issue_lease_token = ${randomUUID()}::uuid
      where id = ${commentIds[3]}::uuid
    `).rejects.toThrow('comments_github_issue_lease_check')
  })
})
