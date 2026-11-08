import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { StreamCardControl } from '../components/GameStreamControls.tsx'
import { StreamDialog } from '../components/StreamDialog.tsx'
import {
  CHECKING_LABEL,
  NOT_FOUND_LABEL,
  UPDATING_STREAM_LABEL,
  canManuallyEndStream,
  preferredOverlayUrl,
  type GameStream,
  type StreamKey,
  type StreamLive,
} from '../lib/streamStatus.ts'

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

const STATES = ['checking', 'notfound', 'paste', 'create', 'queued', 'creating', 'scorecard', 'overlay', 'updating', 'failed', 'ready', 'ending', 'ended'] as const

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
  if (state === 'updating') {
    return {
      stream: {
        ...baseStream,
        status: 'updating_stream',
        scorecard_url: 'https://cricclubs.com/NCCA/viewScorecard.do?matchId=987&clubId=1712',
        overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712',
        overlay_short_url: 'https://is.gd/cheetahs42',
        whatsapp_message: null,
      },
      live: { phase: 'updating', label: UPDATING_STREAM_LABEL, busy: true },
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
  if (state === 'ended') {
    return {
      stream: { ...baseStream, status: 'ended' },
      live: { phase: 'ended', label: 'Ended', busy: false },
      pasteOpen: false,
    }
  }
  return { stream: baseStream, live: { phase: 'ready', label: 'Ready', busy: false }, pasteOpen: false }
}

export function StreamPreviewPage() {
  const [params] = useSearchParams()
  const requested = previewState(params.get('state'))
  const [acted, setActed] = useState<{ requested: PreviewState; phase: PreviewState } | null>(null)
  const state = acted?.requested === requested ? acted.phase : requested
  const roleParam = params.get('role')
  const role = roleParam === 'player' || roleParam === 'admin' || roleParam === 'captain' ? roleParam : 'captain'
  const model = previewModel(state)
  const canEnd = canManuallyEndStream(role, model.stream, model.live.busy)
  const roleLabel = { admin: 'Admin', captain: 'Captain', player: 'Player' }[role]
  const overlayUrl = preferredOverlayUrl(model.stream)

  useEffect(() => {
    if (acted?.phase !== 'ending') return
    const requestedAtClick = acted.requested
    const timer = window.setTimeout(() => {
      setActed({ requested: requestedAtClick, phase: 'ended' })
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [acted])

  if (params.get('view') === 'card') {
    return (
      <div className="stream-preview">
        <ul className="card-list">
          <li className="info-card game-card">
            <div className="game-card-copy">
              <div className="game-card-summary">
                <p className="game-card-when">
                  <span className="game-card-date">Sun, Nov 8</span>
                  <span className="game-card-time">9:30 AM</span>
                </p>
                <h3 className="game-card-title">Alpha vs Tracy Centurions</h3>
                <p className="game-card-venue">Central Park</p>
              </div>
            </div>
            <ul className="game-chips">
              <li>
                <span className="tag tag-navy">League</span>
              </li>
              <li>
                <span className="tag">Alpha</span>
              </li>
              <li className="game-chip-stream">
                <StreamCardControl
                  live={model.live}
                  overlayUrl={overlayUrl}
                  title="Alpha vs Tracy Centurions"
                  onOpen={() => undefined}
                />
              </li>
            </ul>
          </li>
        </ul>
      </div>
    )
  }

  return (
    <div className="stream-preview">
      <article className="info-card">
        <p className="kicker">Preview</p>
        <h1>Alpha vs Tracy Centurions</h1>
        <p className="fixture-date">Sun, Nov 8 · 9:30 AM Pacific</p>
        <p>Mock rows for the stream pop-up. Nothing here is saved. Viewing as {roleLabel}.</p>
      </article>
      <StreamDialog
        key={`${role}-${params.get('confirm') ?? ''}-${requested}`}
        title="Alpha vs Tracy Centurions"
        when="Sun, Nov 8 · 9:30 AM Pacific"
        stream={model.stream}
        keys={KEYS}
        live={model.live}
        loading={false}
        canEditText
        canEditStatus={state === 'ready' || state === 'ending' || state === 'ended'}
        canEndStream={canEnd}
        requestError={null}
        pending={false}
        pasteOpen={model.pasteOpen}
        confirmEnd={params.get('confirm') === '1' && canEnd}
        onClose={() => undefined}
        onCreate={() => undefined}
        onScorecard={() => undefined}
        onRetry={() => undefined}
        onCheckAgain={() => undefined}
        onPaste={() => undefined}
        onSave={() => undefined}
        onEnd={() => setActed({ requested, phase: 'ending' })}
      />
    </div>
  )
}
