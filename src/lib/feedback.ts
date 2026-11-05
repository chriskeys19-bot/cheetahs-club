import type { FeedbackRow } from './types.ts'
import { supabase } from './supabase.ts'

const MAX_BODY = 2000

export function feedbackErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('jwt') || lower.includes('not authenticated') || lower.includes('permission')) {
    return 'Sign in again, then send the suggestion.'
  }
  if (lower.includes('feedback_body_not_blank') || lower.includes('check constraint')) {
    return 'Write a suggestion between 1 and 2000 characters.'
  }
  return message
}

export function parseFeedbackRows(value: unknown): FeedbackRow[] {
  if (!Array.isArray(value)) return []
  const rows: FeedbackRow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.user_id !== 'string' ||
      typeof row.body !== 'string' ||
      typeof row.created_at !== 'string'
    ) {
      continue
    }
    rows.push({
      id: row.id,
      user_id: row.user_id,
      body: row.body,
      created_at: row.created_at,
      submitter_name: typeof row.submitter_name === 'string' ? row.submitter_name : null,
      submitter_email: typeof row.submitter_email === 'string' ? row.submitter_email : null,
      role: typeof row.role === 'string' ? row.role : null,
    })
  }
  return rows
}

export async function loadFeedback(limit = 50): Promise<{ rows: FeedbackRow[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('feedback')
    .select('id, user_id, submitter_name, submitter_email, role, body, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { rows: [], error: error.message }
  return { rows: parseFeedbackRows(data), error: null }
}

export async function submitFeedback(input: {
  userId: string
  name: string
  email: string | null
  role: string
  body: string
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const body = input.body.trim()
  if (body.length < 1 || body.length > MAX_BODY) {
    return 'Write a suggestion between 1 and 2000 characters.'
  }

  const { error } = await supabase.from('feedback').insert({
    user_id: input.userId,
    submitter_name: input.name,
    submitter_email: input.email,
    role: input.role,
    body,
  })

  return error ? feedbackErrorMessage(error.message) : null
}
