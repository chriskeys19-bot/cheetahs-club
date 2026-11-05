import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { ActivityForm } from '../components/ActivityForm.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { loadActivities, removeActivity } from '../lib/activities.ts'
import { formatPacific } from '../lib/format.ts'
import { loadTeams } from '../lib/teams.ts'
import { canManageClub, type Activity, type Team } from '../lib/types.ts'

const PAST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

function teamLabel(teams: Team[], teamId: string | null): string {
  if (!teamId) return 'Club-wide'
  return teams.find((team) => team.id === teamId)?.name ?? 'Side'
}

export function ActivitiesPage() {
  const { profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const [teams, setTeams] = useState<Team[]>([])
  const [upcoming, setUpcoming] = useState<Activity[] | null>(null)
  const [past, setPast] = useState<Activity[]>([])
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

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
    const gate = { current: false }
    const now = new Date().toISOString()
    const pastFrom = new Date(Date.now() - PAST_WINDOW_MS).toISOString()
    Promise.all([
      loadActivities({ from: now }),
      showPast ? loadActivities({ from: pastFrom, to: now }) : Promise.resolve({ rows: [], error: null }),
    ]).then(([nextUpcoming, nextPast]) => {
      if (gate.current) return
      setUpcoming(nextUpcoming.rows)
      setPast([...nextPast.rows].reverse())
      setError(nextUpcoming.error ?? nextPast.error)
    })
    return () => {
      gate.current = true
    }
  }, [token, showPast])

  function refresh() {
    setEditing(null)
    setUpcoming(null)
    setError(null)
    setToken((value) => value + 1)
  }

  async function onRemove(row: Activity) {
    if (!window.confirm(`Remove “${row.title}”?`)) return
    setPendingId(row.id)
    const message = await removeActivity(row.id)
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    if (editing?.id === row.id) setEditing(null)
    setToken((value) => value + 1)
  }

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Coming up</p>
        <h1>Activities</h1>
        <p className="lede">
          Nets, meetings, and other club plans, soonest first. Times are Pacific (America/Los_Angeles).
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins add activities. Recurring adds one row per date. Every member can read the feed.
      </RoleNote>
      {staff ? (
        <ActivityForm
          key={editing?.id ?? 'new'}
          teams={teams}
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <div className="filter-bar" role="group" aria-label="Activity range">
        <button type="button" className="filter-chip" aria-pressed={showPast} onClick={() => setShowPast((value) => !value)}>
          {showPast ? 'Hide recent past' : 'Show recent past'}
        </button>
      </div>
      <section className="panel" aria-labelledby="upcoming-heading">
        <div className="section-heading">
          <p className="kicker">Feed</p>
          <h2 id="upcoming-heading">Upcoming</h2>
        </div>
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {upcoming === null && !error ? <p className="empty-copy">Loading activities…</p> : null}
        {upcoming && upcoming.length === 0 && !error ? (
          <p className="empty-copy">Nothing on the calendar yet.</p>
        ) : null}
        {upcoming && upcoming.length > 0 ? (
          <ul className="card-list">
            {upcoming.map((row) => (
              <ActivityCard
                key={row.id}
                row={row}
                teams={teams}
                staff={staff}
                pending={pendingId === row.id}
                onEdit={() => setEditing(row)}
                onRemove={() => onRemove(row)}
              />
            ))}
          </ul>
        ) : null}
      </section>
      {showPast ? (
        <section className="panel" aria-labelledby="past-heading">
          <div className="section-heading">
            <p className="kicker">Last 90 days</p>
            <h2 id="past-heading">Recent</h2>
          </div>
          {past.length === 0 ? <p className="empty-copy">No recent activities.</p> : null}
          {past.length > 0 ? (
            <ul className="card-list">
              {past.map((row) => (
                <ActivityCard
                  key={row.id}
                  row={row}
                  teams={teams}
                  staff={staff}
                  pending={pendingId === row.id}
                  onEdit={() => setEditing(row)}
                  onRemove={() => onRemove(row)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function ActivityCard({
  row,
  teams,
  staff,
  pending,
  onEdit,
  onRemove,
}: {
  row: Activity
  teams: Team[]
  staff: boolean
  pending: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="info-card">
      <div className="tag-row">
        <span className="tag tag-navy">{teamLabel(teams, row.team_id)}</span>
        {row.series_id ? <span className="tag">Series</span> : null}
        <span className="fine-print">{formatPacific(row.starts_at)}</span>
      </div>
      <h3>{row.title}</h3>
      {row.ends_at ? <p className="fine-print">Until {formatPacific(row.ends_at)}</p> : null}
      {row.location ? <p>{row.location}</p> : null}
      {row.description ? <p className="feedback-body">{row.description}</p> : null}
      {staff ? (
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
