import { isLeagueCompleted, kitLine, resultLabel, venueLabel } from '../lib/games.ts'
import type { ScheduleEvent } from '../lib/types.ts'

export function GameMeta({
  event,
  teamSlug,
  asOf,
}: {
  event: ScheduleEvent
  teamSlug: string | null
  asOf: number | null
}) {
  if (event.event_type !== 'league_game') return null
  const kit = kitLine(event, teamSlug)
  const completed = isLeagueCompleted(event, asOf)
  return (
    <div className="game-meta">
      <p className="tag-row">
        <span className={event.venue_side ? 'tag tag-gold' : 'tag'}>{venueLabel(event.venue_side)}</span>
        {kit ? <span className="fixture-meta">{kit}</span> : null}
      </p>
      {completed ? (
        <p className="fixture-meta">
          <span className="tag tag-navy">{resultLabel(event.result)}</span>
          {event.scorecard_url ? (
            <>
              {' '}
              <a href={event.scorecard_url} target="_blank" rel="noreferrer">
                Scorecard
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
