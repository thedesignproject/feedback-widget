import { createClient } from '@supabase/supabase-js'

let client: ReturnType<typeof createClient> | null = null

export function getSupabaseClient(url: string, key: string) {
  if (!client) {
    client = createClient(url, key)
  }
  return client
}
