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

// 교사 저장: 서버 최신 상태를 먼저 읽고 자신의 prefs만 덮어써서 저장 (동시 저장 충돌 방지)
export async function saveTeacherPrefs(localState: unknown, userId: string): Promise<void> {
  const { data: serverData } = await loadState()
  const local = localState as any

  if (!serverData) {
    await saveState(local)
    return
  }

  const merged = structuredClone(serverData) as any
  for (const vacId of Object.keys(local.vacations ?? {})) {
    if (!merged.vacations?.[vacId]) continue
    merged.vacations[vacId].prefs = {
      ...merged.vacations[vacId].prefs,
      [userId]: local.vacations[vacId].prefs?.[userId] ?? {}
    }
    merged.vacations[vacId].prefDone = {
      ...merged.vacations[vacId].prefDone,
      [userId]: local.vacations[vacId].prefDone?.[userId] ?? false
    }
  }

  await saveState(merged)
}

export async function getServerUpdatedAt(): Promise<string | null> {
  const { data } = await supabase
    .from('app_state')
    .select('updated_at')
    .eq('id', STATE_ROW_ID)
    .single()
  return data?.updated_at ?? null
}
