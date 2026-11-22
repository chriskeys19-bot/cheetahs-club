import { supabase } from './supabase.ts'
import {
  oauthFlagMessage,
  parseBroadcastRows,
  parseConnection,
  type BroadcastConnection,
  type BroadcastRow,
} from './youtubeBroadcasts.ts'

async function authHeader(): Promise<Record<string, string> | string> {
  if (!supabase) return 'Supabase is not configured.'
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return 'Sign in again, then open Streams.'
  return { Authorization: `Bearer ${token}` }
}

async function readBody(error: unknown): Promise<{ message: string; connection: BroadcastConnection | null; rows: BroadcastRow[] }> {
  const context = error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as unknown
      const message =
        body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : 'YouTube could not complete that request.'
      return { message, connection: parseConnection(body), rows: parseBroadcastRows(body) }
    } catch {
      return { message: 'YouTube could not complete that request.', connection: null, rows: [] }
    }
  }
  return { message: 'YouTube could not complete that request.', connection: null, rows: [] }
}

export async function loadYouTubeBroadcasts(): Promise<{
  connection: BroadcastConnection | null
  rows: BroadcastRow[]
  error: string | null
}> {
  const headers = await authHeader()
  if (typeof headers === 'string') return { connection: null, rows: [], error: headers }
  if (!supabase) return { connection: null, rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.functions.invoke('youtube-broadcasts', {
    body: { action: 'list' },
    headers,
  })
  if (error) {
    const parsed = await readBody(error)
    return { connection: parsed.connection, rows: parsed.rows, error: parsed.message }
  }
  return { connection: parseConnection(data), rows: parseBroadcastRows(data), error: null }
}

export async function testYouTubeConnection(): Promise<{
  ok: boolean
  message: string
  connection: BroadcastConnection | null
}> {
  const headers = await authHeader()
  if (typeof headers === 'string') return { ok: false, message: headers, connection: null }
  if (!supabase) return { ok: false, message: 'Supabase is not configured.', connection: null }
  const { data, error } = await supabase.functions.invoke('youtube-broadcasts', {
    body: { action: 'test' },
    headers,
  })
  if (error) {
    const parsed = await readBody(error)
    return { ok: false, message: parsed.message, connection: parsed.connection }
  }
  const message =
    data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : 'YouTube responded.'
  return { ok: true, message, connection: parseConnection(data) }
}

export async function transitionYouTubeBroadcast(
  action: 'start' | 'end',
  broadcastId: string,
): Promise<{ ok: boolean; message: string; connection: BroadcastConnection | null }> {
  const headers = await authHeader()
  if (typeof headers === 'string') return { ok: false, message: headers, connection: null }
  if (!supabase) return { ok: false, message: 'Supabase is not configured.', connection: null }
  const { data, error } = await supabase.functions.invoke('youtube-broadcasts', {
    body: { action, broadcastId },
    headers,
  })
  if (error) {
    const parsed = await readBody(error)
    return { ok: false, message: parsed.message, connection: parsed.connection }
  }
  const message =
    data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : action === 'start'
        ? 'The broadcast is live on YouTube.'
        : 'The broadcast has ended on YouTube.'
  return { ok: true, message, connection: parseConnection(data) }
}

export async function startYouTubeConnect(): Promise<{ url: string } | { error: string }> {
  const headers = await authHeader()
  if (typeof headers === 'string') return { error: headers }
  if (!supabase) return { error: 'Supabase is not configured.' }
  const { data, error } = await supabase.functions.invoke('youtube-oauth-start', { body: {}, headers })
  if (error) return { error: (await readBody(error)).message }
  const url = data && typeof data === 'object' ? (data as { url?: unknown }).url : null
  if (typeof url !== 'string' || !url.startsWith('https://accounts.google.com/')) {
    return { error: 'YouTube could not be connected. Try again.' }
  }
  return { url }
}

export { oauthFlagMessage }
