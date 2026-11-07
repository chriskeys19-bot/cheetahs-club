import { useSearchParams } from 'react-router'
import { StreamDialog } from '../components/StreamDialog.tsx'
import { CHECKING_LABEL, NOT_FOUND_LABEL, type GameStream, type StreamKey, type StreamLive } from '../lib/streamStatus.ts'

const KEYS: StreamKey[] = [
  { id: 'key-1', name: 'Yolobox Pro 1', active: true, sort_order: 1 },
  { id: 'key-2', name: 'Yolobox Pro 2', active: true, sort_order: 2 },
]

const baseStream: GameStream = {
  id: 'stream-1',
  schedule_event_id: 'game-1',
  status: 'ready',
  stream_key_name: 'Yolobox Pro 2',
  youtube_video_id: 'abcdefghijk',
  youtube_url: 'https://youtube.com/watch?v=abcdefghijk',
  scorecard_url: 'https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=42',
  overlay_url: 'https://cheetahs-club.pages.dev/overlay/alpha-vs-royals',
  overlay_short_url: 'https://is.gd/cheetahs42',
  whatsapp_message:
    'Cheetahs Alpha vs Royals is live.\nWatch: https://youtube.com/watch?v=abcdefghijk\nScorecard: https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=42\nOverlay: https://is.gd/cheetahs42',
  last_error: null,
  requested_by: 'user-1',
  checked_at: null,
  created_at: '2026-11-07T18:00:00Z',
  updated_at: '2026-11-07T18:05:00Z',
}

const STATES = ['checking', 'notfound', 'paste', 'create', 'queued', 'creating', 'scorecard', 'overlay', 'failed', 'ready', 'ending'] as const

type PreviewState = (typeof STATES)[number]

function previewState(value: string | null): PreviewState {
  if (value && STATES.includes(value as PreviewState)) return value as PreviewState
  return 'create'
}

const emptyLinks = {
  youtube_video_id: null,
  youtube_url: null,
  scorecard_url: null,
  overlay_url: null,
  overlay_short_url: null,
  whatsapp_message: null,
  stream_key_name: null,
}

function previewModel(state: PreviewState): { stream: GameStream | null; live: StreamLive; pasteOpen: boolean } {
  if (state === 'checking') {
    return {
      stream: { ...baseStream, ...emptyLinks, status: 'checking', checked_at: '2026-11-08T16:00:00Z' },
      live: { phase: 'checking', label: CHECKING_LABEL, busy: true },
      pasteOpen: false,
    }
  }
  if (state === 'notfound' || state === 'paste') {
    return {
      stream: { ...baseStream, ...emptyLinks, status: 'none', checked_at: '2026-11-08T16:00:00Z' },
      live: { phase: 'create', label: NOT_FOUND_LABEL, busy: false },
      pasteOpen: state === 'paste',
    }
  }
  if (state === 'create') return { stream: null, live: { phase: 'create', label: 'No live stream yet', busy: false }, pasteOpen: false }
  if (state === 'queued') {
    return {
      stream: { ...baseStream, status: 'creating', youtube_video_id: null, youtube_url: null, scorecard_url: null, overlay_url: null, overlay_short_url: null, whatsapp_message: null },
      live: { phase: 'queued', label: 'Queued', busy: true },
      pasteOpen: false,
    }
  }
  if (state === 'creating') {
    return {
      stream: { ...baseStream, status: 'creating', youtube_video_id: null, youtube_url: null, scorecard_url: null, overlay_url: null, overlay_short_url: null, whatsapp_message: null },
      live: { phase: 'creating', label: 'Creating stream…', busy: true },
      pasteOpen: false,
    }
  }
  if (state === 'scorecard') {
    return {
      stream: { ...baseStream, status: 'awaiting_scorecard', scorecard_url: null, overlay_url: null, overlay_short_url: null, whatsapp_message: null },
      live: { phase: 'scorecard', label: 'Awaiting scorecard', busy: false },
      pasteOpen: false,
    }
  }
  if (state === 'overlay') {
    return {
      stream: { ...baseStream, status: 'setting_up_overlay', overlay_url: null, overlay_short_url: null, whatsapp_message: null },
      live: { phase: 'overlay', label: 'Adding scorecard and overlay…', busy: true },
      pasteOpen: false,
    }
  }
  if (state === 'failed') {
    return {
      stream: { ...baseStream, status: 'failed', last_error: 'YouTube rejected the broadcast.', youtube_video_id: null, youtube_url: null, scorecard_url: null, overlay_url: null, overlay_short_url: null, whatsapp_message: null },
      live: { phase: 'failed', label: 'Setup failed: YouTube rejected the broadcast.', busy: false },
      pasteOpen: false,
    }
  }
  if (state === 'ending') {
    return {
      stream: { ...baseStream, status: 'ending' },
      live: { phase: 'ending', label: 'Ending stream…', busy: true },
      pasteOpen: false,
    }
  }
  return { stream: baseStream, live: { phase: 'ready', label: 'Ready', busy: false }, pasteOpen: false }
}

export function StreamPreviewPage() {
  const [params] = useSearchParams()
  const state = previewState(params.get('state'))
  const model = previewModel(state)
  return (
    <div className="stream-preview">
      <article className="info-card">
        <p className="kicker">Preview</p>
        <h1>Alpha vs Tracy Centurions</h1>
        <p className="fixture-date">Sun, Nov 8 · 9:30 AM Pacific</p>
        <p>Mock rows for the stream pop-up. Nothing here is saved.</p>
      </article>
      <StreamDialog
        title="Alpha vs Tracy Centurions"
        when="Sun, Nov 8 · 9:30 AM Pacific"
        stream={model.stream}
        keys={KEYS}
        live={model.live}
        loading={false}
        canEditText
        canEditStatus={state === 'ready' || state === 'ending'}
        requestError={null}
        pending={false}
        pasteOpen={model.pasteOpen}
        onClose={() => undefined}
        onCreate={() => undefined}
        onScorecard={() => undefined}
        onRetry={() => undefined}
        onCheckAgain={() => undefined}
        onPaste={() => undefined}
        onSave={() => undefined}
      />
    </div>
  )
}
