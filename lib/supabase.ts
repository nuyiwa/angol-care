import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const STATE_ROW_ID = 'angol_care_v2'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function loadState(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', STATE_ROW_ID)
    .single()

  if (error || !data) return null
  return data.data as Record<string, unknown>
}

export async function saveState(state: unknown): Promise<void> {
  const { error } = await supabase
    .from('app_state')
    .upsert({ id: STATE_ROW_ID, data: state, updated_at: new Date().toISOString() })

  if (error) console.error('Supabase save error:', error)
}
