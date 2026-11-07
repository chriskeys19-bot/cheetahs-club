import { supabase } from './supabase.ts'
import { parseVideoUrl } from './games.ts'
import {
  isJobStatus,
  isStreamAction,
  isStreamStatus,
  parseHttpsUrl,
  parseStreamScorecardUrl,
  type GameStream,
  type StreamAction,
  type StreamJob,
  type StreamKey,
} from './streamStatus.ts'

const STREAM_COLUMNS =
  'id, schedule_event_id, status, stream_key_name, youtube_video_id, youtube_url, scorecard_url, overlay_url, overlay_short_url, whatsapp_message, last_error, requested_by, checked_at, created_at, updated_at'

const JOB_COLUMNS = 'id, game_stream_id, action, status, payload, error, created_by, created_at, updated_at'

const KEY_COLUMNS = 'id, name, active, sort_order'

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function parseGameStream(value: unknown): GameStream | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.schedule_event_id !== 'string' || !isStreamStatus(row.status)) {
    return null
  }
  return {
    id: row.id,
    schedule_event_id: row.schedule_event_id,
    status: row.status,
    stream_key_name: textOrNull(row.stream_key_name),
    youtube_video_id: textOrNull(row.youtube_video_id),
    youtube_url: textOrNull(row.youtube_url),
    scorecard_url: textOrNull(row.scorecard_url),
    overlay_url: textOrNull(row.overlay_url),
    overlay_short_url: textOrNull(row.overlay_short_url),
    whatsapp_message: textOrNull(row.whatsapp_message),
    last_error: textOrNull(row.last_error),
    requested_by: textOrNull(row.requested_by),
    checked_at: textOrNull(row.checked_at),
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

export function parseStreamJob(value: unknown): StreamJob | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string' ||
    typeof row.game_stream_id !== 'string' ||
    !isStreamAction(row.action) ||
    !isJobStatus(row.status)
  ) {
    return null
  }
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {}
  return {
    id: row.id,
    game_stream_id: row.game_stream_id,
    action: row.action,
    status: row.status,
    payload,
    error: textOrNull(row.error),
    created_by: textOrNull(row.created_by),
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

export function parseStreamKey(value: unknown): StreamKey | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name,
    active: row.active !== false,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
  }
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const rows: T[] = []
  for (const item of value) {
    const parsed = parse(item)
    if (parsed) rows.push(parsed)
  }
  return rows
}

export type StreamBoard = {
  streams: GameStream[]
  jobs: StreamJob[]
  keys: StreamKey[]
  error: string | null
}

export async function loadStreamBoard(): Promise<StreamBoard> {
  if (!supabase) return { streams: [], jobs: [], keys: [], error: 'Supabase is not configured.' }
  const [streams, jobs, keys] = await Promise.all([
    supabase.from('game_streams').select(STREAM_COLUMNS),
    supabase.from('stream_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(200),
    supabase.from('stream_keys').select(KEY_COLUMNS).eq('active', true).order('sort_order', { ascending: true }),
  ])
  const error = streams.error?.message ?? jobs.error?.message ?? keys.error?.message ?? null
  return {
    streams: parseList(streams.data, parseGameStream),
    jobs: parseList(jobs.data, parseStreamJob),
    keys: parseList(keys.data, parseStreamKey),
    error,
  }
}

async function messageFromInvoke(error: unknown): Promise<string> {
  const context =
    error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context && typeof context === 'object' && 'json' in context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json()
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        const message = (body as { error: string }).error.trim()
        if (message) {
          if (message.toLowerCase().includes('already queued')) return ''
          return message
        }
      }
    } catch {
      return 'The stream job could not be queued.'
    }
  }
  const fallback = error instanceof Error ? error.message : ''
  if (fallback.toLowerCase().includes('already queued')) return ''
  return fallback || 'The stream job could not be queued.'
}

export async function requestStreamJob(input: {
  scheduleEventId: string
  action: StreamAction
  streamKeyName?: string
  scorecardUrl?: string
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) return 'Sign in again, then try the stream.'

  const body: Record<string, string> = {
    scheduleEventId: input.scheduleEventId,
    action: input.action,
  }
  if (input.action === 'create') {
    const name = input.streamKeyName?.trim() ?? ''
    if (!name) return 'Choose a stream key.'
    body.streamKeyName = name
  }
  if (input.action === 'add_scorecard') {
    const parsed = parseStreamScorecardUrl(input.scorecardUrl ?? '')
    if (parsed === null || parsed === 'invalid') return 'Enter a cricclubs.com scorecard link.'
    body.scorecardUrl = parsed
  }

  const { error } = await supabase.functions.invoke('request-stream-job', {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!error) return null
  const message = await messageFromInvoke(error)
  return message || null
}

export async function linkExistingStream(scheduleEventId: string, youtubeUrl: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const parsed = parseVideoUrl(youtubeUrl)
  if (parsed === null || parsed === 'invalid') return 'Paste a YouTube link (youtube.com or youtu.be).'
  const https = parsed.replace(/^http:\/\//i, 'https://')
  const { error } = await supabase.rpc('link_existing_stream', {
    p_schedule_event_id: scheduleEventId,
    p_youtube_url: https,
  })
  if (!error) return null
  const message = error.message.trim()
  if (!message) return 'That YouTube link could not be saved.'
  return message
}

export type StreamTextField =
  | 'stream_key_name'
  | 'status'
  | 'youtube_url'
  | 'overlay_url'
  | 'overlay_short_url'
  | 'whatsapp_message'

export async function updateStreamField(
  streamId: string,
  field: StreamTextField,
  value: string,
  keys: StreamKey[],
): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const trimmed = value.trim()
  let stored: string | null = trimmed
  if (field === 'status') {
    if (!isStreamStatus(trimmed)) return 'Choose a setup status.'
  } else if (field === 'stream_key_name') {
    if (!keys.some((key) => key.name === trimmed)) return 'Choose a stream key from the list.'
  } else if (field === 'whatsapp_message') {
    if (trimmed.length > 2000) return 'That WhatsApp message is too long.'
    stored = trimmed.length === 0 ? null : trimmed
  } else {
    const parsed = parseHttpsUrl(trimmed)
    if (parsed === 'invalid') return 'Enter an https link.'
    stored = parsed
  }
  const { data, error } = await supabase
    .from('game_streams')
    .update({ [field]: stored })
    .eq('id', streamId)
    .select('id')
  if (error) {
    const lower = error.message.toLowerCase()
    if (lower.includes('players cannot')) return 'Players cannot update status or result fields.'
    if (lower.includes('service role')) return 'Results are written by the service role.'
    if (lower.includes('row-level security') || lower.includes('permission')) {
      return 'Only staff or the person who started this stream can edit it.'
    }
    return error.message
  }
  if (!Array.isArray(data) || data.length === 0) {
    return 'Only staff or the person who started this stream can edit it.'
  }
  return null
}

export async function loadAllStreamKeys(): Promise<{ keys: StreamKey[]; error: string | null }> {
  if (!supabase) return { keys: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.from('stream_keys').select(KEY_COLUMNS).order('sort_order', { ascending: true })
  return { keys: parseList(data, parseStreamKey), error: error?.message ?? null }
}

export async function saveStreamKey(input: {
  id?: string
  name: string
  active: boolean
  sortOrder: number
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const name = input.name.trim()
  if (name.length < 1 || name.length > 80) return 'Enter a key name.'
  const payload = { name, active: input.active, sort_order: input.sortOrder }
  const { error } = input.id
    ? await supabase.from('stream_keys').update(payload).eq('id', input.id)
    : await supabase.from('stream_keys').insert(payload)
  if (error) {
    if (error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')) {
      return 'That key name is already on the list.'
    }
    if (error.message.toLowerCase().includes('row-level security')) return 'Only an admin can edit stream keys.'
    return error.message
  }
  return null
}

export async function removeStreamKey(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('stream_keys').delete().eq('id', id)
  if (error) {
    if (error.message.toLowerCase().includes('row-level security')) return 'Only an admin can edit stream keys.'
    return error.message
  }
  return null
}

export function upsertById<T extends { id: string }>(rows: T[], next: T): T[] {
  const index = rows.findIndex((row) => row.id === next.id)
  if (index === -1) return [next, ...rows]
  const copy = rows.slice()
  copy[index] = next
  return copy
}

export function removeById<T extends { id: string }>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id)
}
