import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { FixtureForm } from '../components/FixtureForm.tsx'
import { GameMeta } from '../components/GameMeta.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { formatFixture } from '../lib/format.ts'
import {
  eventKindLabel,
  eventTitle,
  isCheetahsLeagueGame,
  isCompletedLeagueListing,
  isUpcomingLeagueGame,
  loadSchedule,
  removeFixture,
} from '../lib/schedules.ts'
import { loadMyTeamIds, loadTeams } from '../lib/teams.ts'
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
  const staff = canManageClub(profile?.role)
  const [params, setParams] = useSearchParams()
  const side = parseSide(params.get('side'))
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

  function selectSide(next: SideFilter) {
    const nextParams = new URLSearchParams(params)
    if (next === 'all') nextParams.delete('side')
    else nextParams.set('side', next)
    setParams(nextParams, { replace: true })
  }

  useEffect(() => {
    const pressed = filterBarRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    pressed?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [side])

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
          Availability stays on the club sheet.
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins can add, edit, or remove events. Recurring adds one row per date. Players can read the list.
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
        {rows && (side === 'practice' || teams.length > 0) && visible.length === 0 && !error ? (
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
        {visible.length > 0 ? (
          <ul className="card-list tiles">
            {visible.map((row) => {
              const when = formatFixture(row.game_date, row.start_time, row.end_time)
              const played = asOf !== null && new Date(row.starts_at).getTime() < asOf
              const sideName = teamName(teams, row.team_id)
              const mapHref = row.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`
                : null
              return (
                <li key={row.id} className={played ? 'info-card is-past' : 'info-card'}>
                  <div className="tag-row">
                    <span className="tag tag-gold">{when.time}</span>
                    <span className="tag tag-navy">{eventKindLabel(row.event_type)}</span>
                    <span className="tag">{sideName ? sideName.replace(/^Cheetahs /, '') : 'Club-wide'}</span>
                    {row.series_id ? <span className="tag">Series</span> : null}
                    {row.match_format ? <span className="tag">{row.match_format}</span> : null}
                    {row.division ? <span className="tag">{row.division}</span> : null}
                    {played ? <span className="tag">Played</span> : null}
                  </div>
                  <p className="fixture-date">{when.date}</p>
                  <h3>{eventTitle(row, sideName)}</h3>
                  <GameMeta event={row} teamSlug={teamSlug(teams, row.team_id)} asOf={asOf} />
                  <p>{row.ground}</p>
                  {row.address ? (
                    <p className="fine-print">
                      {row.address}
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
                  {row.notes ? <p className="fine-print">{row.notes}</p> : null}
                  {staff ? (
                    <div className="card-actions">
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => {
                          setComposing(false)
                          setEditing(row)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => onRemove(row)}
                        disabled={pendingId === row.id}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
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
