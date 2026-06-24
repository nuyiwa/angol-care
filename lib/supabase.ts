import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const STATE_ROW_ID = 'angol_care_v2'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function loadState(): Promise<{ data: Record<string, unknown> | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from('app_state')
    .select('data, updated_at')
    .eq('id', STATE_ROW_ID)
    .single()

  if (error || !data) return { data: null, updatedAt: null }
  return { data: data.data as Record<string, unknown>, updatedAt: data.updated_at }
}

export async function saveState(state: unknown): Promise<void> {
  const { error } = await supabase
    .from('app_state')
    .upsert({ id: STATE_ROW_ID, data: state, updated_at: new Date().toISOString() })

  if (error) console.error('Supabase save error:', error)
}

export async function getServerUpdatedAt(): Promise<string | null> {
  const { data } = await supabase
    .from('app_state')
    .select('updated_at')
    .eq('id', STATE_ROW_ID)
    .single()
  return data?.updated_at ?? null
}
