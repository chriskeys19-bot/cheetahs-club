import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { FeedbackComposer } from '../components/FeedbackComposer.tsx'
import { FeedbackList } from '../components/FeedbackList.tsx'
import { loadAnnouncements } from '../lib/announcements.ts'
import { loadFeedback } from '../lib/feedback.ts'
import { formatFixture } from '../lib/format.ts'
import { loadSchedule } from '../lib/schedules.ts'
import { loadTeams } from '../lib/teams.ts'
import {
  canManageClub,
  displayName,
  roleLabel,
  type Announcement,
  type FeedbackRow,
  type ScheduleEvent,
  type Team,
} from '../lib/types.ts'

export function HomePage() {
  const { session, profile, profileError } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [teamError, setTeamError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Announcement | null>(null)
  const [fixtures, setFixtures] = useState<ScheduleEvent[]>([])
  const [boardReady, setBoardReady] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listToken, setListToken] = useState(0)

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
      const now = Date.now()
      setFixtures(
        schedule.rows.filter((event) => new Date(event.starts_at).getTime() >= now).slice(0, 3),
      )
      setBoardError(announcements.error ?? schedule.error)
      setBoardReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadFeedback(3).then(({ rows: next, error }) => {
      if (cancelled) return
      setRows(next)
      setListError(error)
    })
    return () => {
      cancelled = true
    }
  }, [listToken])

  const name = displayName(profile, session?.user.email)
  const roleLine = profile
    ? `You are signed in as ${roleLabel(profile.role).toLowerCase()}.`
    : profileError
      ? 'Your club role could not be loaded. You can still send a suggestion.'
      : 'Checking your club role…'

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Clubhouse</p>
        <h1>Welcome, {name}</h1>
        <p className="lede">{roleLine}</p>
        {profile && canManageClub(profile.role) ? (
          <p className="fine-print">
            <Link to="/invites">Invite a player</Link>
          </p>
        ) : null}
      </header>
      <div className="home-grid">
        <FeedbackComposer onSubmitted={() => setListToken((value) => value + 1)} />
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
      </div>
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
        {fixtures.length > 0 ? (
          <ul className="card-list">
            {fixtures.map((fixture) => {
              const when = formatFixture(fixture.game_date, fixture.start_time)
              const side = teams.find((team) => team.id === fixture.team_id)
              return (
                <li key={fixture.id} className="info-card">
                  <p className="fixture-date">
                    {when.date} · {when.time}
                  </p>
                  <h3>
                    {side ? side.name.replace('Cheetahs ', '') : 'Club'} ·{' '}
                    {fixture.event_type === 'umpiring' ? fixture.opponent : `vs ${fixture.opponent}`}
                  </h3>
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
        </p>
      </section>
      <section className="panel recent" aria-labelledby="recent-heading">
        <div className="section-heading">
          <p className="kicker">Yours</p>
          <h2 id="recent-heading">Latest suggestions</h2>
        </div>
        {listError ? (
          <p className="banner banner-error" role="alert">
            {listError}
          </p>
        ) : (
          <FeedbackList rows={rows} empty="Nothing in the box yet." showSubmitter={false} />
        )}
        <p className="fine-print">
          <Link to="/feedback">Open the full suggestion box</Link>
        </p>
      </section>
    </div>
  )
}
