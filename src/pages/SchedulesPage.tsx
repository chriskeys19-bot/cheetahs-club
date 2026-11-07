import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { FixtureForm } from '../components/FixtureForm.tsx'
import { GameCard } from '../components/GameCard.tsx'
import { MonthCalendar } from '../components/MonthCalendar.tsx'
import { useStreams } from '../components/streams-context.ts'
import { RoleNote } from '../components/RoleNote.tsx'
import {
  eventTitle,
  isCheetahsLeagueGame,
  isCompletedLeagueListing,
  isUpcomingLeagueGame,
  loadSchedule,
  removeFixture,
} from '../lib/schedules.ts'
import { loadMyTeamIds, loadTeams } from '../lib/teams.ts'
import { scrollToLocationHash } from '../lib/scrollHash.ts'
import { canManageClub, type ScheduleEvent, type Team } from '../lib/types.ts'

const SIDES = ['all', 'upcoming', 'completed', 'alpha', 'beta', 'gamma', 'practice', 'mine'] as const
type SideFilter = (typeof SIDES)[number]

function parseSide(value: string | null): SideFilter {
  if (
    value === 'upcoming' ||
    value === 'completed' ||
    value === 'alpha' ||
    value === 'beta' ||
    value === 'gamma' ||
    value === 'practice' ||
    value === 'mine'
  ) {
    return value
  }
  return 'all'
}

function listHeading(side: SideFilter): string {
  if (side === 'all') return 'Full winter list'
  if (side === 'upcoming') return 'Upcoming games'
  if (side === 'completed') return 'Completed games'
  if (side === 'practice') return 'Wednesday practice'
  return 'Filtered list'
}

function teamSlug(teams: Team[], teamId: string | null): string | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId)?.slug ?? null
}

function teamName(teams: Team[], teamId: string | null): string | null {
  if (!teamId) return null
  return teams.find((team) => team.id === teamId)?.name ?? null
}

export function SchedulesPage() {
  const { session, profile, profileReady } = useAuth()
  const streams = useStreams()
  const staff = canManageClub(profile?.role)
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const side = parseSide(params.get('side'))
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list'
  const pinnedId = location.hash.startsWith('#fixture-') ? location.hash.slice('#fixture-'.length) : null
  const [teams, setTeams] = useState<Team[]>([])
  const [myTeamIds, setMyTeamIds] = useState<string[]>([])
  const [rows, setRows] = useState<ScheduleEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [editing, setEditing] = useState<ScheduleEvent | null>(null)
  const [composing, setComposing] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [asOf, setAsOf] = useState<number | null>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadTeams().then(({ teams: next, error: nextError }) => {
      if (cancelled) return
      setTeams(next)
      if (nextError) setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    let cancelled = false
    loadMyTeamIds(userId).then(({ ids, error: nextError }) => {
      if (cancelled) return
      setMyTeamIds(ids)
      if (nextError) setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    let cancelled = false
    loadSchedule().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      setError(nextError)
      setAsOf(Date.now())
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const visible = useMemo(() => {
    const events = rows ?? []
    return events.filter((event) => {
      if (side === 'practice') return event.event_type === 'practice'
      const slug = teamSlug(teams, event.team_id)
      if (side === 'completed') return isCompletedLeagueListing(event, slug)
      if (side === 'upcoming') return asOf !== null && isUpcomingLeagueGame(event, slug, asOf)
      if (!isCheetahsLeagueGame(event, slug)) return false
      if (side === 'all') return true
      if (side === 'mine') return event.team_id !== null && myTeamIds.includes(event.team_id)
      return slug === side
    })
  }, [rows, side, teams, myTeamIds, asOf])

  const listed = useMemo(() => {
    if (!pinnedId || !rows) return visible
    if (visible.some((event) => event.id === pinnedId)) return visible
    const pinned = rows.find((event) => event.id === pinnedId)
    return pinned ? [pinned, ...visible] : visible
  }, [visible, rows, pinnedId])

  function selectSide(next: SideFilter) {
    const nextParams = new URLSearchParams(params)
    if (next === 'all') nextParams.delete('side')
    else nextParams.set('side', next)
    setParams(nextParams, { replace: true })
  }

  function selectView(next: 'list' | 'calendar') {
    const nextParams = new URLSearchParams(params)
    if (next === 'list') nextParams.delete('view')
    else nextParams.set('view', 'calendar')
    setParams(nextParams, { replace: true })
  }

  useEffect(() => {
    const pressed = filterBarRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    pressed?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [side])

  useEffect(() => {
    if (view === 'calendar' || !rows) return
    scrollToLocationHash()
  }, [view, rows, side, listed])

  function refresh() {
    setEditing(null)
    setComposing(false)
    setRows(null)
    setError(null)
    setToken((value) => value + 1)
  }

  async function onRemove(row: ScheduleEvent) {
    const label = eventTitle(row, teamName(teams, row.team_id))
    if (!window.confirm(`Remove ${label} on ${row.game_date}?`)) return
    setPendingId(row.id)
    const message = await removeFixture(row.id)
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    if (editing?.id === row.id) setEditing(null)
    setToken((value) => value + 1)
  }

  const leagueRows = (rows ?? []).filter((event) => isCheetahsLeagueGame(event, teamSlug(teams, event.team_id)))
  const counts = {
    all: leagueRows.length,
    upcoming:
      asOf === null
        ? 0
        : leagueRows.filter((event) => isUpcomingLeagueGame(event, teamSlug(teams, event.team_id), asOf)).length,
    completed: leagueRows.filter((event) => isCompletedLeagueListing(event, teamSlug(teams, event.team_id))).length,
    alpha: leagueRows.filter((event) => teamSlug(teams, event.team_id) === 'alpha').length,
    beta: leagueRows.filter((event) => teamSlug(teams, event.team_id) === 'beta').length,
    gamma: leagueRows.filter((event) => teamSlug(teams, event.team_id) === 'gamma').length,
    practice: (rows ?? []).filter((event) => event.event_type === 'practice').length,
    mine: leagueRows.filter((event) => event.team_id !== null && myTeamIds.includes(event.team_id)).length,
  }

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Winter 2026-27</p>
        <h1>Schedules</h1>
        <p className="lede">
          Cheetahs Alpha, Beta, and Gamma league games from the winter sheet. Wednesday
          practice is on its own filter. Completed lists league games with a posted result.
          Upcoming lists league games still to be played. Times are Pacific
          (America/Los_Angeles). The club week on the home page is Monday through Sunday.
          Availability stays on the club sheet. Calendar is the month view of those league
          games, practice, activities (including each date in a series), and the other dated
          items already in the clubhouse.
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins can add, edit, or remove events, and can add a YouTube link on a completed game. Recurring adds one row per date. Players can read the list and watch a posted video.
      </RoleNote>
      {staff && (composing || editing) ? (
        <FixtureForm
          key={editing?.id ?? 'new'}
          teams={teams}
          initial={editing}
          onSaved={refresh}
          onCancel={() => {
            setEditing(null)
            setComposing(false)
          }}
        />
      ) : null}
      {staff && !composing && !editing ? (
        <button type="button" className="button button-gold" onClick={() => setComposing(true)}>
          Add an event
        </button>
      ) : null}
      <div className="filter-bar" role="group" aria-label="Schedule view">
        <button type="button" className="filter-chip" aria-pressed={view === 'list'} onClick={() => selectView('list')}>
          List
        </button>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={view === 'calendar'}
          onClick={() => selectView('calendar')}
        >
          Calendar
        </button>
      </div>
      {view === 'calendar' ? <MonthCalendar revision={token} /> : null}
      {view === 'list' ? (
      <>
      <div className="filter-bar" role="group" aria-label="Schedule filter" ref={filterBarRef}>
        <FilterChip label="All" count={counts.all} pressed={side === 'all'} onClick={() => selectSide('all')} />
        <FilterChip
          label="Upcoming"
          count={counts.upcoming}
          pressed={side === 'upcoming'}
          onClick={() => selectSide('upcoming')}
        />
        <FilterChip
          label="Completed"
          count={counts.completed}
          pressed={side === 'completed'}
          onClick={() => selectSide('completed')}
        />
        <FilterChip label="Alpha" count={counts.alpha} pressed={side === 'alpha'} onClick={() => selectSide('alpha')} />
        <FilterChip label="Beta" count={counts.beta} pressed={side === 'beta'} onClick={() => selectSide('beta')} />
        <FilterChip label="Gamma" count={counts.gamma} pressed={side === 'gamma'} onClick={() => selectSide('gamma')} />
        <FilterChip
          label="Practice"
          count={counts.practice}
          pressed={side === 'practice'}
          onClick={() => selectSide('practice')}
        />
        {myTeamIds.length > 0 ? (
          <FilterChip label="My side" count={counts.mine} pressed={side === 'mine'} onClick={() => selectSide('mine')} />
        ) : null}
      </div>
      <section className="panel" aria-labelledby="fixtures-heading">
        <div className="section-heading">
          <p className="kicker">Events</p>
          <h2 id="fixtures-heading">
            {listHeading(side)}
          </h2>
        </div>
        {(rows === null || (teams.length === 0 && side !== 'practice')) && !error ? (
          <p className="empty-copy">Loading the schedule…</p>
        ) : null}
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {streams.error ? (
          <p className="banner banner-error" role="alert">
            {streams.error}
          </p>
        ) : null}
        {rows && (side === 'practice' || teams.length > 0) && listed.length === 0 && !error ? (
          <p className="empty-copy">
            {side === 'mine'
              ? 'You are not on a side yet, or that side has no events.'
              : side === 'practice'
                ? 'No practice is on the schedule.'
                : side === 'completed'
                  ? 'No completed league games yet.'
                  : side === 'upcoming'
                    ? 'No upcoming league games.'
                    : 'No events in this view.'}
          </p>
        ) : null}
        {listed.length > 0 ? (
          <ul className="card-list tiles">
            {listed.map((row) => {
              const sideName = teamName(teams, row.team_id)
              return (
                <GameCard
                  id={`fixture-${row.id}`}
                  key={row.id}
                  event={row}
                  sideName={sideName}
                  teamSlug={teamSlug(teams, row.team_id)}
                  asOf={asOf}
                  showNotes
                  canEdit={staff}
                  pending={pendingId === row.id}
                  onEdit={() => {
                    setComposing(false)
                    setEditing(row)
                  }}
                  onRemove={() => onRemove(row)}
                  onVideoSaved={(videoUrl) => {
                    setRows((current) =>
                      current?.map((item) => (item.id === row.id ? { ...item, video_url: videoUrl } : item)) ?? current,
                    )
                  }}
                />
              )
            })}
          </ul>
        ) : null}
      </section>
      </>
      ) : null}
    </div>
  )
}

function FilterChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string
  count: number
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="filter-chip" aria-pressed={pressed} onClick={onClick}>
      {label} · {count}
    </button>
  )
}
