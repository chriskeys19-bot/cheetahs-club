import { Link } from 'react-router'
import { GameMeta } from './GameMeta.tsx'
import { formatFixture, formatPacificDate } from '../lib/format.ts'
import { eventKindLabel, eventTitle } from '../lib/schedules.ts'
import type { ScheduleEvent, Team } from '../lib/types.ts'

function sideName(teams: Team[], teamId: string | null): string | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId)?.name ?? null
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
}: {
  events: ScheduleEvent[]
  teams: Team[]
  loading: boolean
  error: string | null
  start: string
  end: string
  asOf: number | null
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
            const when = formatFixture(event.game_date, event.start_time, event.end_time)
            const side = sideName(teams, event.team_id)
            const slug = teams.find((team) => team.id === event.team_id)?.slug ?? null
            const played = asOf !== null && new Date(event.starts_at).getTime() < asOf
            return (
              <li key={event.id} className={played ? 'info-card is-past' : 'info-card'}>
                <Link className="card-title-link" to={scheduleHref(event, teams)}>
                  <div className="tag-row">
                    <span className="tag tag-gold">{when.time}</span>
                    <span className="tag tag-navy">{eventKindLabel(event.event_type)}</span>
                    <span className="tag">{side ? side.replace(/^Cheetahs /, '') : 'Club-wide'}</span>
                    {played ? <span className="tag">Played</span> : null}
                  </div>
                  <p className="fixture-date">{when.date}</p>
                  <h3>{eventTitle(event, side)}</h3>
                  <p>{event.ground}</p>
                </Link>
                <GameMeta event={event} teamSlug={slug} asOf={asOf} />
              </li>
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
