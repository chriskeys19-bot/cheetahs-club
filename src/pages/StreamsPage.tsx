import { useEffect, useMemo, useState } from 'react'
import { formatFixture } from '../lib/format.ts'
import { eventTitle, isCheetahsLeagueGame, isCompletedLeagueListing, loadSchedule } from '../lib/schedules.ts'
import { isPublicStreamStatus, liveStreamMessage, openJobFor } from '../lib/streamStatus.ts'
import { loadTeams } from '../lib/teams.ts'
import type { ScheduleEvent, Team } from '../lib/types.ts'
import { useStreams } from '../components/streams-context.ts'

function teamSlug(teams: Team[], teamId: string | null): string | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId)?.slug ?? null
}

function teamName(teams: Team[], teamId: string | null): string | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId)?.name ?? null
}

export function StreamsPage() {
  const board = useStreams()
  const [teams, setTeams] = useState<Team[]>([])
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTeams(), loadSchedule()]).then(([teamResult, schedule]) => {
      if (cancelled) return
      setTeams(teamResult.teams)
      setEvents(schedule.rows)
      setError(teamResult.error ?? schedule.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => {
    return (events ?? []).filter((event) => {
      const slug = teamSlug(teams, event.team_id)
      if (!isCheetahsLeagueGame(event, slug)) return false
      if (isCompletedLeagueListing(event, slug)) return false
      const stream = board.streams.find((item) => item.schedule_event_id === event.id)
      if (!stream || !isPublicStreamStatus(stream.status)) return false
      return true
    })
  }, [events, teams, board.streams])

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Broadcasts</p>
        <h1>Available streams</h1>
        <p className="lede">
          Upcoming and live Cheetahs games that have a YouTube stream on the way. Times are Pacific
          (America/Los_Angeles).
        </p>
      </header>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {board.error ? (
        <p className="banner banner-error" role="alert">
          {board.error}
        </p>
      ) : null}
      {events === null && !error ? <p className="empty-copy">Loading streams…</p> : null}
      {events && rows.length === 0 && !error && !board.error ? (
        <p className="empty-copy">No Cheetahs streams are live or coming up.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="card-list tiles">
          {rows.map((event) => {
            const stream = board.streams.find((item) => item.schedule_event_id === event.id)
            if (!stream) return null
            const when = formatFixture(event.game_date, event.start_time, event.end_time)
            const side = teamName(teams, event.team_id)
            const job = openJobFor(board.jobs, stream.id)
            const live = liveStreamMessage(stream, job)
            return (
              <li key={event.id} className="info-card">
                <div className="tag-row">
                  <span className="tag tag-gold">{when.time}</span>
                  <span className="tag tag-navy">{live.label}</span>
                </div>
                <p className="fixture-date">{when.date}</p>
                <h3>{eventTitle(event, side)}</h3>
                <p>{event.ground}</p>
                {stream.youtube_url ? (
                  <p>
                    <a href={stream.youtube_url} target="_blank" rel="noreferrer">
                      Watch on YouTube
                    </a>
                  </p>
                ) : (
                  <p className="fine-print">The YouTube link appears here once the stream is ready.</p>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
