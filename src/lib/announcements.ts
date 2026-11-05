import { actionError } from './errors.ts'
import { supabase } from './supabase.ts'
import type { Announcement } from './types.ts'

function parseAnnouncements(value: unknown): Announcement[] {
  if (!Array.isArray(value)) return []
  const rows: Announcement[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.body !== 'string' ||
      typeof row.pinned !== 'boolean' ||
      typeof row.created_at !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      continue
    }
    rows.push({
      id: row.id,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author_id: typeof row.author_id === 'string' ? row.author_id : null,
    })
  }
  return rows
}

export async function loadAnnouncements(): Promise<{ rows: Announcement[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, author_id, pinned, created_at, updated_at')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return { rows: [], error: error.message }
  return { rows: parseAnnouncements(data), error: null }
}

export async function saveAnnouncement(input: {
  id?: string
  title: string
  body: string
  pinned: boolean
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const payload = {
    title: input.title.trim(),
    body: input.body.trim(),
    pinned: input.pinned,
  }
  const { error } = input.id
    ? await supabase.from('announcements').update(payload).eq('id', input.id)
    : await supabase.from('announcements').insert(payload)
  return error ? actionError(error.message) : null
}

export async function removeAnnouncement(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  return error ? actionError(error.message) : null
}
