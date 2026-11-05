import type { FeedbackRow } from './types.ts'
import { supabase } from './supabase.ts'

const MAX_BODY = 2000

export const FEEDBACK_CATEGORIES = [
  { id: 'feature', label: 'Feature' },
  { id: 'bug', label: 'Bug' },
  { id: 'other', label: 'Other' },
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]['id']

const CATEGORY_PREFIX: Record<FeedbackCategory, string> = {
  feature: '[Feature] ',
  bug: '[Bug] ',
  other: '[Other] ',
}

const MAX_PREFIX = CATEGORY_PREFIX.feature.length

export const MAX_FEEDBACK_TEXT = MAX_BODY - MAX_PREFIX

export function feedbackLengthMessage(): string {
  return `Write feedback between 1 and ${MAX_FEEDBACK_TEXT} characters.`
}

export function feedbackCategoryLabel(category: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find((item) => item.id === category)?.label ?? 'Other'
}

// Category stays inside `body` so stamp_feedback and the sheet's Suggestion column stay as they are.
export function composeFeedbackBody(category: FeedbackCategory, text: string): string {
  return `${CATEGORY_PREFIX[category]}${text.trim()}`
}

const CATEGORY_PATTERN = /^\[(Feature|Bug|Other)\]\s+/

export function splitFeedbackBody(body: string): { category: FeedbackCategory | null; text: string } {
  const match = CATEGORY_PATTERN.exec(body)
  if (!match) return { category: null, text: body }
  const label = match[1]
  const category: FeedbackCategory = label === 'Feature' ? 'feature' : label === 'Bug' ? 'bug' : 'other'
  return { category, text: body.slice(match[0].length) }
}

export function feedbackErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('jwt') || lower.includes('not authenticated') || lower.includes('permission')) {
    return 'Sign in again, then send your feedback.'
  }
  if (lower.includes('feedback_body_not_blank') || lower.includes('check constraint')) {
    return feedbackLengthMessage()
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
  category: FeedbackCategory
  body: string
}): Promise<string | null> {
  const text = input.body.trim()
  const body = composeFeedbackBody(input.category, text)
  if (text.length < 1 || text.length > MAX_FEEDBACK_TEXT || body.length > MAX_BODY) {
    return feedbackLengthMessage()
  }
  if (!supabase) return 'Supabase is not configured.'

  const { error } = await supabase.from('feedback').insert({
    user_id: input.userId,
    submitter_name: input.name,
    submitter_email: input.email,
    role: input.role,
    body,
  })

  return error ? feedbackErrorMessage(error.message) : null
}
