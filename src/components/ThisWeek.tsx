import { Link } from 'react-router'
import { GameCard } from './GameCard.tsx'
import { formatPacificDate } from '../lib/format.ts'
import type { ScheduleEvent, Team } from '../lib/types.ts'

function sideTeam(teams: Team[], teamId: string | null): Team | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId) ?? null
}

function scheduleHref(event: ScheduleEvent, teams: Team[]): string {
  if (event.event_type === 'practice' && event.team_id === null) return '/schedules?side=practice'
  const slug = teams.find((team) => team.id === event.team_id)?.slug
  if (slug === 'alpha' || slug === 'beta' || slug === 'gamma') return `/schedules?side=${slug}`
  if (event.event_type === 'practice') return '/schedules?side=practice'
  return '/schedules'
}

export function ThisWeek({
  events,
  teams,
  loading,
  error,
  start,
  end,
  asOf,
  canEdit = false,
  onVideoSaved,
}: {
  events: ScheduleEvent[]
  teams: Team[]
  loading: boolean
  error: string | null
  start: string
  end: string
  asOf: number | null
  canEdit?: boolean
  onVideoSaved?: (eventId: string, videoUrl: string | null) => void
}) {
  return (
    <section className="panel week-panel" aria-labelledby="week-heading">
      <div className="section-heading">
        <p className="kicker">This week</p>
        <h2 id="week-heading">What&apos;s happening this week</h2>
      </div>
      <p className="fine-print">
        {formatPacificDate(start)} – {formatPacificDate(end)}. The club week is Monday through Sunday,
        America/Los_Angeles.
      </p>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="empty-copy">Loading this week…</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="empty-copy">Nothing on the Cheetahs schedule this week.</p>
      ) : null}
      {events.length > 0 ? (
        <ul className="card-list tiles">
          {events.map((event) => {
            const side = sideTeam(teams, event.team_id)
            return (
              <GameCard
                key={event.id}
                event={event}
                sideName={side?.name ?? null}
                teamSlug={side?.slug ?? null}
                asOf={asOf}
                href={scheduleHref(event, teams)}
                canEdit={canEdit}
                onVideoSaved={onVideoSaved ? (videoUrl) => onVideoSaved(event.id, videoUrl) : undefined}
              />
            )
          })}
        </ul>
      ) : null}
      <p className="fine-print">
        <Link to="/schedules">Open the full schedule</Link>
      </p>
    </section>
  )
}
