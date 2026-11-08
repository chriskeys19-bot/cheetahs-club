import { isLeagueCompleted, resultLabel, resultTagClass } from '../lib/games.ts'
import type { ScheduleEvent } from '../lib/types.ts'

export function GameMeta({ event, asOf }: { event: ScheduleEvent; asOf: number | null }) {
  if (event.event_type !== 'league_game') return null
  const completed = isLeagueCompleted(event, asOf) || event.result !== null
  if (!completed) return null

  return (
    <div className="game-meta">
      <p className="game-result">
        <span className={resultTagClass(event.result)}>{resultLabel(event.result)}</span>
        {event.scorecard_url ? (
          <a href={event.scorecard_url} target="_blank" rel="noreferrer">
            Scorecard
          </a>
        ) : null}
        {event.video_url ? <WatchVideoLink href={event.video_url} /> : null}
      </p>
    </div>
  )
}

export function WatchVideoLink({ href }: { href: string }) {
  return (
    <a className="watch-video" href={href} target="_blank" rel="noreferrer" aria-label="Watch match video">
      <YouTubePlayIcon />
    </a>
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
