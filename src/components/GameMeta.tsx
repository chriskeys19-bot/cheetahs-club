import { isLeagueCompleted, kitLine, resultLabel, venueLabel, type GameResult } from '../lib/games.ts'
import type { ScheduleEvent } from '../lib/types.ts'

function resultClass(result: GameResult | null): string {
  if (result === 'win') return 'tag tag-win'
  if (result === 'loss') return 'tag tag-loss'
  return 'tag tag-navy'
}

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
  const completed = isLeagueCompleted(event, asOf) || event.result !== null
  return (
    <div className="game-meta">
      <p className="tag-row">
        <span className={event.venue_side ? 'tag tag-gold' : 'tag'}>{venueLabel(event.venue_side)}</span>
        {kit ? <span className="fixture-meta">{kit}</span> : null}
      </p>
      {completed ? (
        <p className="fixture-meta">
          <span className={resultClass(event.result)}>{resultLabel(event.result)}</span>
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
