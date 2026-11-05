import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { GameMeta } from '../components/GameMeta.tsx'
import { ThisWeek } from '../components/ThisWeek.tsx'
import { VenmoPayLink } from '../components/VenmoPayLink.tsx'
import { loadAnnouncements } from '../lib/announcements.ts'
import { formatFixture, pacificWeekBounds } from '../lib/format.ts'
import { formatCents } from '../lib/money.ts'
import { eventsInPacificWeek, eventTitle, isCheetahsLeagueGame, loadSchedule } from '../lib/schedules.ts'
import { loadSplitwiseHome, type SplitwiseHome } from '../lib/splitwise.ts'
import { loadTeams } from '../lib/teams.ts'
import { duesVenmoNote, resolveVenmoUsername } from '../lib/venmo.ts'
import {
  canManageClub,
  displayName,
  roleLabel,
  type Announcement,
  type ScheduleEvent,
  type Team,
} from '../lib/types.ts'

export function HomePage() {
  const { session, profile, profileReady, profileError } = useAuth()
  const [dues, setDues] = useState<SplitwiseHome | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamError, setTeamError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Announcement | null>(null)
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([])
  const [boardReady, setBoardReady] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [asOf, setAsOf] = useState<number | null>(null)
  const [week, setWeek] = useState<{ start: string; end: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTeams().then(({ teams: next, error }) => {
      if (cancelled) return
      setTeams(next)
      setTeamError(error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadAnnouncements(), loadSchedule()]).then(([announcements, schedule]) => {
      if (cancelled) return
      setNotice(announcements.rows[0] ?? null)
      setSchedule(schedule.rows)
      setBoardError(announcements.error)
      setScheduleError(schedule.error)
      setWeek(pacificWeekBounds(new Date()))
      setAsOf(Date.now())
      setBoardReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!profileReady || !session) return
    let cancelled = false
    loadSplitwiseHome(session.user.id, canManageClub(profile?.role)).then((home) => {
      if (!cancelled) setDues(home)
    })
    return () => {
      cancelled = true
    }
  }, [profileReady, session, profile?.role])

  const leagueGames = schedule.filter((event) => {
    if (event.event_type !== 'league_game') return false
    if (teams.length === 0) return true
    return isCheetahsLeagueGame(event, teams.find((team) => team.id === event.team_id)?.slug ?? null)
  })
  const thisWeek = week ? eventsInPacificWeek(leagueGames, week.start, week.end) : []
  const upcoming = leagueGames
    .filter((event) => asOf === null || new Date(event.starts_at).getTime() >= asOf)
    .slice(0, 3)
  const name = displayName(profile, session?.user.email)
  const roleLine = profile
    ? `You are signed in as ${roleLabel(profile.role).toLowerCase()}.`
    : profileError
      ? 'Your club role could not be loaded.'
      : 'Checking your club role…'

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Clubhouse</p>
        <h1>Welcome, {name}</h1>
        <p className="lede">{roleLine}</p>
        {profile && canManageClub(profile.role) ? (
          <p className="fine-print">
            <Link to="/invites">Invite a player or add them to a side</Link>
          </p>
        ) : null}
      </header>
      {dues ? (
        <section className="panel" aria-labelledby="home-dues-heading">
          <div className="section-heading">
            <p className="kicker">Dues</p>
            <h2 id="home-dues-heading">Splitwise</h2>
          </div>
          {dues.netCents === null ? (
            <p>Your sign-in email is not on the latest Splitwise list. A captain can match it and refresh.</p>
          ) : dues.netCents < 0 ? (
            <>
              <p className="money-line">
                <span>You owe {formatCents(-dues.netCents)}</span>
              </p>
              <p className="fine-print">
                Pay the club on Venmo. A captain records it in Splitwise, which is the ledger. This app does not mark
                the balance paid.
              </p>
              <VenmoPayLink
                username={resolveVenmoUsername({ venmoUsername: dues.venmoUsername, syncedAt: dues.syncedAt })}
                amountCents={-dues.netCents}
                note={duesVenmoNote(dues.groupName ?? 'Splitwise')}
              />
            </>
          ) : dues.netCents > 0 ? (
            <p>The group owes you {formatCents(dues.netCents)}.</p>
          ) : (
            <p>You&apos;re settled on the Splitwise ledger.</p>
          )}
          {canManageClub(profile?.role) && dues.owedByMembersCents !== null ? (
            <p className="fine-print">
              Members owe {formatCents(dues.owedByMembersCents)}
              {dues.owedToMembersCents !== null ? `, and are owed ${formatCents(dues.owedToMembersCents)}` : ''}. That
              rollup is staff-only.
            </p>
          ) : null}
          <p className="fine-print">
            <Link to="/dues">Open dues</Link>
          </p>
        </section>
      ) : null}
      {week ? (
        <ThisWeek
          events={scheduleError ? [] : thisWeek}
          teams={teams}
          loading={!boardReady}
          error={scheduleError}
          start={week.start}
          end={week.end}
          asOf={asOf}
        />
      ) : (
        <section className="panel" aria-labelledby="week-heading">
          <div className="section-heading">
            <p className="kicker">This week</p>
            <h2 id="week-heading">What&apos;s happening this week</h2>
          </div>
          <p className="empty-copy">Loading this week…</p>
        </section>
      )}
      <Link className="home-feedback" to="/feedback">
        <span>Feature request / feedback on the app</span>
        <span className="home-feedback-go" aria-hidden="true">
          Open
        </span>
      </Link>
      <section className="panel" aria-labelledby="sides-heading">
        <div className="section-heading">
          <p className="kicker">Squads</p>
          <h2 id="sides-heading">The sides</h2>
        </div>
        {teamError ? (
          <p className="banner banner-error" role="alert">
            {teamError}
          </p>
        ) : null}
        <ul className="team-grid">
          {teams.map((team) => (
            <li key={team.id}>
              <Link className="team-card" to={`/schedules?side=${team.slug}`}>
                <p className="team-slug">{team.slug}</p>
                <p className="team-name">{team.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="board-heading">
        <div className="section-heading">
          <p className="kicker">Noticeboard</p>
          <h2 id="board-heading">From the club</h2>
        </div>
        {boardError ? (
          <p className="banner banner-error" role="alert">
            {boardError}
          </p>
        ) : null}
        {!boardReady ? <p className="empty-copy">Loading the board…</p> : null}
        {boardReady && notice ? (
          <article className="info-card">
            <div className="tag-row">
              {notice.pinned ? <span className="tag tag-gold">Pinned</span> : null}
            </div>
            <h3>{notice.title}</h3>
            <p className="clamp">{notice.body}</p>
          </article>
        ) : null}
        {boardReady && !notice && !boardError ? <p className="empty-copy">No announcements yet.</p> : null}
        {upcoming.length > 0 ? (
          <ul className="card-list">
            {upcoming.map((fixture) => {
              const when = formatFixture(fixture.game_date, fixture.start_time, fixture.end_time)
              const side = teams.find((team) => team.id === fixture.team_id)
              return (
                <li key={fixture.id} className="info-card">
                  <p className="fixture-date">
                    {when.date} · {when.time}
                  </p>
                  <h3>{eventTitle(fixture, side?.name ?? null)}</h3>
                  <GameMeta event={fixture} teamSlug={side?.slug ?? null} asOf={asOf} />
                  <p className="fine-print">{fixture.ground}</p>
                </li>
              )
            })}
          </ul>
        ) : null}
        <p className="fine-print">
          <Link to="/announcements">Announcements</Link>
          {' · '}
          <Link to="/activities">Activities</Link>
          {' · '}
          <Link to="/schedules">Schedules</Link>
          {' · '}
          <Link to="/polls">Polls</Link>
          {' · '}
          <Link to="/dues">Dues</Link>
        </p>
      </section>
    </div>
  )
}
