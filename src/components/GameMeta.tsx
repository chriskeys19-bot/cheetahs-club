import { useId, useRef, useState, type FormEvent } from 'react'
import { isLeagueCompleted, parseVideoUrl, resultLabel, type GameResult } from '../lib/games.ts'
import { saveGameVideo } from '../lib/schedules.ts'
import type { ScheduleEvent } from '../lib/types.ts'

function resultClass(result: GameResult | null): string {
  if (result === 'win') return 'tag tag-win'
  if (result === 'loss') return 'tag tag-loss'
  return 'tag tag-navy'
}

export function GameMeta({
  event,
  asOf,
  canEdit = false,
  onVideoSaved,
}: {
  event: ScheduleEvent
  asOf: number | null
  canEdit?: boolean
  onVideoSaved?: (videoUrl: string | null) => void
}) {
  const fieldId = useId()
  const sending = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(event.video_url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (event.event_type !== 'league_game') return null
  const completed = isLeagueCompleted(event, asOf) || event.result !== null
  if (!completed) return null

  async function persist(next: string | null) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveGameVideo(event.id, next)
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setDraft(next ?? '')
    setOpen(false)
    onVideoSaved?.(next)
  }

  function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    const parsed = parseVideoUrl(draft)
    if (parsed === 'invalid') {
      setError('Paste a YouTube link (youtube.com or youtu.be), or leave it blank.')
      return
    }
    void persist(parsed)
  }

  return (
    <div className="game-meta">
      <p className="game-result">
        <span className={resultClass(event.result)}>{resultLabel(event.result)}</span>
        {event.scorecard_url ? (
          <a href={event.scorecard_url} target="_blank" rel="noreferrer">
            Scorecard
          </a>
        ) : null}
        {event.video_url ? (
          <a
            className="watch-video"
            href={event.video_url}
            target="_blank"
            rel="noreferrer"
            aria-label="Watch match video"
          >
            <YouTubePlayIcon />
          </a>
        ) : null}
      </p>
      {canEdit && !open ? (
        <button
          type="button"
          className="button button-quiet video-add"
          onClick={() => {
            setDraft(event.video_url ?? '')
            setError(null)
            setOpen(true)
          }}
        >
          {event.video_url ? 'Edit video link' : 'Add video link'}
        </button>
      ) : null}
      {canEdit && open ? (
        <form className="video-form" onSubmit={onSubmit}>
          <label htmlFor={fieldId}>Match video</label>
          <input
            id={fieldId}
            name="videoUrl"
            type="url"
            inputMode="url"
            value={draft}
            onChange={(input) => setDraft(input.target.value)}
            maxLength={500}
            placeholder="https://youtu.be/…"
            autoFocus
          />
          <div className="video-form-actions">
            <button type="submit" className="button button-gold" disabled={busy}>
              {busy ? 'Saving…' : 'Save link'}
            </button>
            {event.video_url ? (
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => void persist(null)}>
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="button button-quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setError(null)
                setDraft(event.video_url ?? '')
              }}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

function YouTubePlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#FF0000"
        d="M23.5 6.2a3.05 3.05 0 0 0-2.15-2.16C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.35.44A3.05 3.05 0 0 0 .5 6.2 31.8 31.8 0 0 0 0 12a31.8 31.8 0 0 0 .5 5.8 3.05 3.05 0 0 0 2.15 2.16C4.5 20.4 12 20.4 12 20.4s7.5 0 9.35-.44a3.05 3.05 0 0 0 2.15-2.16A31.8 31.8 0 0 0 24 12a31.8 31.8 0 0 0-.5-5.8z"
      />
      <path fill="#fff" d="M9.75 15.57V8.43L15.84 12l-6.09 3.57z" />
    </svg>
  )
}
