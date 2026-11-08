import { pacificDateInput } from './format.ts'
import { canManageClub, isClubRole } from './types.ts'

export const STREAM_STATUSES = [
  'none',
  'checking',
  'creating',
  'awaiting_scorecard',
  'setting_up_overlay',
  'updating_stream',
  'ready',
  'ending',
  'ended',
  'failed',
] as const

export type StreamStatus = (typeof STREAM_STATUSES)[number]

export const STREAM_ACTIONS = ['check', 'create', 'add_scorecard', 'end'] as const

export const STREAM_CHECK_INTERVAL_MS = 10 * 60 * 1000

export const CHECKING_LABEL = 'Checking CricketCrazeUSA for an existing stream…'

export const NOT_FOUND_LABEL = 'No live stream found on CricketCrazeUSA. Create one?'

export const UPDATING_STREAM_LABEL = 'Overlay ready · finishing stream updates…'

/** CricClubs overlay page. CC_1712 is the fixed overlay build, not the club id. */
export const CRICCLUBS_OVERLAY_PAGE = 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html'

export type StreamAction = (typeof STREAM_ACTIONS)[number]

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export type GameStream = {
  id: string
  schedule_event_id: string
  status: StreamStatus
  stream_key_name: string | null
  youtube_video_id: string | null
  youtube_url: string | null
  scorecard_url: string | null
  overlay_url: string | null
  overlay_short_url: string | null
  whatsapp_message: string | null
  last_error: string | null
  requested_by: string | null
  checked_at: string | null
  created_at: string
  updated_at: string
}

export type StreamJob = {
  id: string
  game_stream_id: string
  action: StreamAction
  status: JobStatus
  payload: Record<string, unknown>
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type StreamKey = {
  id: string
  name: string
  active: boolean
  sort_order: number
}

export type StreamPhase =
  | 'create'
  | 'checking'
  | 'check_failed'
  | 'queued'
  | 'creating'
  | 'scorecard'
  | 'overlay'
  | 'updating'
  | 'ready'
  | 'ending'
  | 'ended'
  | 'failed'

export type StreamLive = {
  phase: StreamPhase
  label: string
  busy: boolean
}

export function isStreamStatus(value: unknown): value is StreamStatus {
  return typeof value === 'string' && STREAM_STATUSES.includes(value as StreamStatus)
}

export function isStreamAction(value: unknown): value is StreamAction {
  return value === 'check' || value === 'create' || value === 'add_scorecard' || value === 'end'
}

export function isJobStatus(value: unknown): value is JobStatus {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'failed'
}

export function streamStatusLabel(status: StreamStatus): string {
  if (status === 'none') return 'No stream'
  if (status === 'checking') return 'Checking CricketCrazeUSA'
  if (status === 'creating') return 'Creating stream'
  if (status === 'awaiting_scorecard') return 'Awaiting scorecard'
  if (status === 'setting_up_overlay') return 'Adding scorecard and overlay'
  if (status === 'updating_stream') return 'Overlay ready'
  if (status === 'ready') return 'Ready'
  if (status === 'ending') return 'Ending stream'
  if (status === 'ended') return 'Ended'
  return 'Failed'
}

export function parseStreamScorecardUrl(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 500) return 'invalid'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid'
  if (url.username || url.password) return 'invalid'
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host !== 'cricclubs.com' && !host.endsWith('.cricclubs.com')) return 'invalid'
  url.protocol = 'https:'
  url.hash = ''
  return url.toString()
}

function queryId(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() !== name) continue
    if (!/^[0-9]{1,12}$/.test(value)) return null
    return value
  }
  return null
}

/** Build the CricClubs overlay when the scorecard URL already has matchId and clubId. */
export function overlayUrlFromScorecard(value: string): string | null {
  const parsed = parseStreamScorecardUrl(value)
  if (!parsed || parsed === 'invalid') return null
  let url: URL
  try {
    url = new URL(parsed)
  } catch {
    return null
  }
  const matchId = queryId(url, 'matchid')
  const clubId = queryId(url, 'clubid')
  if (!matchId || !clubId) return null
  return `${CRICCLUBS_OVERLAY_PAGE}?matchId=${matchId}&clubId=${clubId}`
}

export function preferredOverlayUrl(
  stream: Pick<GameStream, 'overlay_short_url' | 'overlay_url'> | null,
): string | null {
  const short = stream?.overlay_short_url?.trim() ?? ''
  if (short) return short
  const full = stream?.overlay_url?.trim() ?? ''
  return full || null
}

/** Show a client-built overlay until the saved row catches up, without keeping a stale short link. */
export function streamWithEarlyOverlay(stream: GameStream | null, earlyOverlay: string | null): GameStream | null {
  if (!stream || !earlyOverlay || stream.overlay_url === earlyOverlay) return stream
  const workerPublished =
    stream.status === 'updating_stream' ||
    stream.status === 'ready' ||
    stream.status === 'failed' ||
    stream.status === 'ended'
  if (workerPublished && (stream.overlay_url || stream.overlay_short_url)) return stream
  return { ...stream, overlay_url: earlyOverlay, overlay_short_url: null }
}

export function streamNeedsLiveRefresh(
  streams: Pick<GameStream, 'status'>[],
  jobs: Pick<StreamJob, 'action' | 'status'>[],
): boolean {
  if (streams.some((row) => row.status === 'setting_up_overlay' || row.status === 'updating_stream')) return true
  return jobs.some(
    (job) => job.action === 'add_scorecard' && (job.status === 'pending' || job.status === 'running'),
  )
}

export function parseHttpsUrl(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 500 || /\s/.test(trimmed)) return 'invalid'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:' || url.username || url.password) return 'invalid'
  return trimmed
}

function overlayIsReady(
  stream: Pick<GameStream, 'overlay_short_url' | 'overlay_url'> | null,
): boolean {
  return preferredOverlayUrl(stream) !== null
}

export function liveStreamMessage(
  stream: Pick<
    GameStream,
    | 'status'
    | 'last_error'
    | 'youtube_url'
    | 'youtube_video_id'
    | 'scorecard_url'
    | 'overlay_url'
    | 'overlay_short_url'
    | 'checked_at'
  > | null,
  job: Pick<StreamJob, 'status' | 'action' | 'error'> | null,
): StreamLive {
  const openCheck = job && (job.status === 'pending' || job.status === 'running') && job.action === 'check'
  if (openCheck || stream?.status === 'checking') {
    return { phase: 'checking', label: CHECKING_LABEL, busy: true }
  }
  if (stream?.status === 'updating_stream') {
    return { phase: 'updating', label: UPDATING_STREAM_LABEL, busy: true }
  }
  const scorecardJobOpen = job?.action === 'add_scorecard' && (job.status === 'pending' || job.status === 'running')
  if (scorecardJobOpen && overlayIsReady(stream)) {
    return { phase: 'updating', label: UPDATING_STREAM_LABEL, busy: true }
  }
  if (job?.status === 'pending') return { phase: 'queued', label: 'Queued', busy: true }
  if (job?.status === 'running') {
    if (job.action === 'create') return { phase: 'creating', label: 'Creating stream…', busy: true }
    if (job.action === 'end') return { phase: 'ending', label: 'Ending stream…', busy: true }
    return { phase: 'overlay', label: 'Adding scorecard and overlay…', busy: true }
  }
  if (!stream || stream.status === 'none') {
    if (stream?.checked_at) return { phase: 'create', label: NOT_FOUND_LABEL, busy: false }
    return { phase: 'create', label: 'No live stream yet', busy: false }
  }
  if (stream.status === 'creating') return { phase: 'creating', label: 'Creating stream…', busy: true }
  if (stream.status === 'setting_up_overlay') {
    if (overlayIsReady(stream)) return { phase: 'updating', label: UPDATING_STREAM_LABEL, busy: true }
    return { phase: 'overlay', label: 'Adding scorecard and overlay…', busy: true }
  }
  if (stream.status === 'ending') return { phase: 'ending', label: 'Ending stream…', busy: true }
  if (stream.status === 'failed') {
    const detail = stream.last_error?.trim() || job?.error?.trim() || 'Something went wrong.'
    const label = `Setup failed: ${detail}`
    if (job?.action === 'check' && !stream.youtube_url && !stream.youtube_video_id) {
      return { phase: 'check_failed', label, busy: false }
    }
    return { phase: 'failed', label, busy: false }
  }
  if (stream.status === 'ended') return { phase: 'ended', label: 'Ended', busy: false }
  const hasBroadcast = Boolean(stream.youtube_url || stream.youtube_video_id)
  if (stream.status === 'awaiting_scorecard' || (hasBroadcast && !stream.scorecard_url)) {
    return { phase: 'scorecard', label: 'Awaiting scorecard', busy: false }
  }
  return { phase: 'ready', label: 'Ready', busy: false }
}

export function streamControlVisible(input: {
  cheetahsLeague: boolean
  completed: boolean
  status: StreamStatus | null
  role: string | null | undefined
}): boolean {
  if (!input.cheetahsLeague) return false
  const staff = isClubRole(input.role) && canManageClub(input.role)
  if (input.completed && input.status === 'ended' && !staff) return false
  return true
}

/**
 * The Setup failed chip stays while a match can still be fixed.
 * It comes off the card once the game is completed, or once its Pacific date has passed.
 */
export function failedStreamChipHidden(input: {
  status: StreamStatus | null
  completed: boolean
  gameDate: string
  asOf: number
}): boolean {
  if (input.status !== 'failed') return false
  if (input.completed) return true
  const today = pacificDateInput(new Date(input.asOf))
  const day = input.gameDate.slice(0, 10)
  return Boolean(today) && day < today
}

export function isPublicStreamStatus(status: StreamStatus): boolean {
  return (
    status === 'creating' ||
    status === 'awaiting_scorecard' ||
    status === 'setting_up_overlay' ||
    status === 'updating_stream' ||
    status === 'ready' ||
    status === 'ending'
  )
}

export function shouldAutoEnd(
  completed: boolean,
  stream: Pick<GameStream, 'status' | 'youtube_url' | 'youtube_video_id'> | null,
  jobOpen: boolean,
): boolean {
  if (!completed || !stream || jobOpen) return false
  if (
    stream.status === 'ended' ||
    stream.status === 'ending' ||
    stream.status === 'none' ||
    stream.status === 'checking' ||
    stream.status === 'creating'
  ) {
    return false
  }
  if (stream.status === 'failed' && !stream.youtube_url && !stream.youtube_video_id) return false
  return true
}

/** Pop-up End stream button: captain or admin, a YouTube video, and no open job. */
export function canManuallyEndStream(
  role: string | null | undefined,
  stream: Pick<GameStream, 'status' | 'youtube_url' | 'youtube_video_id'> | null,
  jobOpen: boolean,
): boolean {
  if (!isClubRole(role) || !canManageClub(role)) return false
  if (!stream || jobOpen) return false
  if (stream.status === 'none' || stream.status === 'ending' || stream.status === 'ended') return false
  return Boolean(stream.youtube_url || stream.youtube_video_id)
}

export function shouldAutoCheck(
  stream: Pick<GameStream, 'status' | 'checked_at' | 'youtube_url' | 'youtube_video_id'> | null,
  jobOpen: boolean,
  now: number,
): boolean {
  if (jobOpen) return false
  if (stream && (stream.youtube_url || stream.youtube_video_id)) return false
  if (stream && stream.status !== 'none') return false
  if (!stream?.checked_at) return true
  const checked = new Date(stream.checked_at).getTime()
  if (!Number.isFinite(checked)) return true
  return now - checked > STREAM_CHECK_INTERVAL_MS
}

export function retryAction(
  stream: Pick<GameStream, 'status' | 'youtube_url' | 'youtube_video_id'>,
  job: Pick<StreamJob, 'action' | 'status'> | null,
): StreamAction {
  if (job && job.status === 'failed') return job.action
  if (!stream.youtube_url && !stream.youtube_video_id) return 'create'
  if (stream.status === 'ending' || stream.status === 'ended') return 'end'
  return 'add_scorecard'
}

export function openJobFor(jobs: StreamJob[], streamId: string): StreamJob | null {
  let open: StreamJob | null = null
  for (const job of jobs) {
    if (job.game_stream_id !== streamId) continue
    if (job.status !== 'pending' && job.status !== 'running') continue
    if (!open || job.created_at > open.created_at) open = job
  }
  return open
}

export function latestJobFor(jobs: StreamJob[], streamId: string): StreamJob | null {
  let latest: StreamJob | null = null
  for (const job of jobs) {
    if (job.game_stream_id !== streamId) continue
    if (!latest || job.created_at > latest.created_at) latest = job
  }
  return latest
}

export function canEditStreamField(
  role: string | null | undefined,
  userId: string | null | undefined,
  requestedBy: string | null | undefined,
  field: 'status' | 'result' | 'text',
): boolean {
  if (field === 'result') return role === 'admin'
  if (field === 'status') return role === 'admin' || role === 'captain'
  if (role === 'admin' || role === 'captain') return true
  return Boolean(userId && requestedBy && userId === requestedBy)
}

export function watchUrl(videoUrl: string | null, stream: Pick<GameStream, 'status' | 'youtube_url'> | null): string | null {
  if (videoUrl) return videoUrl
  if (stream?.status === 'ended' && stream.youtube_url) return stream.youtube_url
  return null
}
