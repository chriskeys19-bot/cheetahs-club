import { Link } from 'react-router'
import { GameMeta } from './GameMeta.tsx'
import { GameStreamControls } from './GameStreamControls.tsx'
import { formatFixture } from '../lib/format.ts'
import { ballLabel, dressLabel, effectiveKit, venueLabel } from '../lib/games.ts'
import { eventKindLabel, eventTitle } from '../lib/schedules.ts'
import type { ScheduleEvent } from '../lib/types.ts'

type ChipTone = 'gold' | 'navy' | 'plain'

type Chip = {
  key: string
  label: string
  tone: ChipTone
}

function sideLabel(sideName: string | null): string {
  if (!sideName) return 'Club-wide'
  const short = sideName.replace(/^Cheetahs /, '').trim()
  return short.length > 0 ? short : sideName
}

function chips(event: ScheduleEvent, teamSlug: string | null, sideName: string | null): Chip[] {
  const items: Chip[] = [
    { key: 'kind', label: eventKindLabel(event.event_type), tone: 'navy' },
    { key: 'side', label: sideLabel(sideName), tone: 'plain' },
  ]
  if (event.event_type === 'league_game') {
    if (event.venue_side) items.push({ key: 'venue', label: venueLabel(event.venue_side), tone: 'gold' })
    const kit = effectiveKit(event, teamSlug)
    if (kit.ball) items.push({ key: 'ball', label: ballLabel(kit.ball), tone: 'plain' })
    if (kit.dress) items.push({ key: 'dress', label: dressLabel(kit.dress), tone: 'plain' })
  }
  if (event.match_format) items.push({ key: 'format', label: event.match_format, tone: 'plain' })
  if (event.division) items.push({ key: 'division', label: event.division, tone: 'plain' })
  if (event.series_id) items.push({ key: 'series', label: 'Series', tone: 'plain' })
  return items
}

export function GameCard({
  id,
  event,
  sideName,
  teamSlug,
  asOf,
  href,
  showNotes = false,
  showMap = true,
  canEdit = false,
  pending = false,
  onEdit,
  onRemove,
  onVideoSaved,
}: {
  id?: string
  event: ScheduleEvent
  sideName: string | null
  teamSlug: string | null
  asOf: number | null
  href?: string
  showNotes?: boolean
  showMap?: boolean
  canEdit?: boolean
  pending?: boolean
  onEdit?: () => void
  onRemove?: () => void
  onVideoSaved?: (videoUrl: string | null) => void
}) {
  const when = formatFixture(event.game_date, event.start_time, event.end_time)
  const played = asOf !== null && new Date(event.starts_at).getTime() < asOf
  const title = eventTitle(event, sideName)
  const mapHref =
    showMap && event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`
      : null
  const summary = (
    <>
      <p className="game-card-when">
        <span className="game-card-date">{when.date}</span>
        <span className="game-card-time">{when.time}</span>
      </p>
      <h3 className="game-card-title">{title}</h3>
      <p className="game-card-venue">{event.ground}</p>
    </>
  )

  return (
    <li id={id} className={played ? 'info-card game-card is-past' : 'info-card game-card'}>
      <div className="game-card-copy">
        {href ? (
          <Link className="game-card-link" to={href}>
            {summary}
          </Link>
        ) : (
          <div className="game-card-summary">{summary}</div>
        )}
        {event.address ? (
          <p className="game-card-address">
            {event.address}
            {mapHref ? (
              <>
                {' · '}
                <a href={mapHref} target="_blank" rel="noreferrer">
                  Map
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <ul className="game-chips">
        {chips(event, teamSlug, sideName).map((chip) => (
          <li key={chip.key}>
            <span className={chip.tone === 'plain' ? 'tag' : `tag tag-${chip.tone}`}>{chip.label}</span>
          </li>
        ))}
        <li className="game-chip-stream">
          <GameStreamControls
            event={event}
            teamName={sideName}
            teamSlug={teamSlug}
            onVideoReady={onVideoSaved}
          />
        </li>
      </ul>
      <GameMeta event={event} asOf={asOf} canEdit={canEdit} onVideoSaved={onVideoSaved} />
      {showNotes && event.notes ? <p className="game-card-notes">{event.notes}</p> : null}
      {canEdit && onEdit && onRemove ? (
        <div className="card-actions">
          <button type="button" className="button button-quiet" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="button button-quiet" onClick={onRemove} disabled={pending}>
            Remove
          </button>
        </div>
      ) : null}
    </li>
  )
}
