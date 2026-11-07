import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { ActivityForm } from '../components/ActivityForm.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { RichText } from '../components/RichText.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { loadActivities, removeActivity, removeActivitySeries } from '../lib/activities.ts'
import { formatPacific } from '../lib/format.ts'
import { visibleText } from '../lib/richText.ts'
import { scrollToLocationHash } from '../lib/scrollHash.ts'
import { loadTeams } from '../lib/teams.ts'
import { canEditItem, canManageClub, type Activity, type Team } from '../lib/types.ts'

const PAST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

function teamLabel(teams: Team[], teamId: string | null): string {
  if (!teamId) return 'Club-wide'
  return teams.find((team) => team.id === teamId)?.name ?? 'Side'
}

export function ActivitiesPage() {
  const { session, profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const userId = session?.user.id ?? null
  const [teams, setTeams] = useState<Team[]>([])
  const [upcoming, setUpcoming] = useState<Activity[] | null>(null)
  const [past, setPast] = useState<Activity[]>([])
  const [showPast, setShowPast] = useState(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    return id.startsWith('activity-')
  })
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Activity | null>(null)

  function canEdit(row: Activity) {
    return canEditItem(profile?.role, userId, row.created_by)
  }

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

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    if (!id.startsWith('activity-')) return
    scrollToLocationHash()
  }, [upcoming, past, showPast])

  function refresh() {
    setEditing(null)
    setUpcoming(null)
    setError(null)
    setToken((value) => value + 1)
  }

  async function onRemove(row: Activity, scope: 'one' | 'series') {
    setPendingId(row.id)
    const message =
      scope === 'series' && row.series_id ? await removeActivitySeries(row.series_id) : await removeActivity(row.id)
    setPendingId(null)
    setConfirming(null)
    if (message) {
      setError(message)
      return
    }
    if (editing?.id === row.id || (scope === 'series' && editing?.series_id === row.series_id)) setEditing(null)
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
        Captains and admins add activities. You can edit or delete an activity you added.
      </RoleNote>
      <div className="desk-split">
      {staff || editing ? (
        <ActivityForm
          key={editing?.id ?? 'new'}
          teams={teams}
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <div className="desk-main">
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
          <ul className="card-list tiles">
            {upcoming.map((row) => (
              <ActivityCard
                key={row.id}
                row={row}
                teams={teams}
                canEdit={canEdit(row)}
                pending={pendingId === row.id}
                onEdit={() => setEditing(row)}
                onDelete={() => setConfirming(row)}
              />
            ))}
          </ul>
        ) : null}
      </section>
      </div>
      </div>
      {showPast ? (
        <section className="panel" aria-labelledby="past-heading">
          <div className="section-heading">
            <p className="kicker">Last 90 days</p>
            <h2 id="past-heading">Recent</h2>
          </div>
          {past.length === 0 ? <p className="empty-copy">No recent activities.</p> : null}
          {past.length > 0 ? (
            <ul className="card-list tiles">
              {past.map((row) => (
                <ActivityCard
                  key={row.id}
                  row={row}
                  teams={teams}
                  canEdit={canEdit(row)}
                  pending={pendingId === row.id}
                  onEdit={() => setEditing(row)}
                  onDelete={() => setConfirming(row)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`Delete “${visibleText(confirming.title)}”?`}
          body={
            confirming.series_id
              ? 'This date is part of a series. Deleting the series removes every date in it.'
              : 'This activity comes off the feed for every member.'
          }
          confirmLabel={confirming.series_id ? 'This date' : 'Delete'}
          extra={
            confirming.series_id
              ? { label: 'Entire series', onClick: () => onRemove(confirming, 'series') }
              : undefined
          }
          busy={pendingId === confirming.id}
          onCancel={() => {
            if (pendingId !== confirming.id) setConfirming(null)
          }}
          onConfirm={() => onRemove(confirming, 'one')}
        />
      ) : null}
    </div>
  )
}

function ActivityCard({
  row,
  teams,
  canEdit,
  pending,
  onEdit,
  onDelete,
}: {
  row: Activity
  teams: Team[]
  canEdit: boolean
  pending: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li id={`activity-${row.id}`} className="info-card">
      <div className="tag-row">
        <span className="tag tag-navy">{teamLabel(teams, row.team_id)}</span>
        {row.series_id ? <span className="tag">Series</span> : null}
        <span className="fine-print">{formatPacific(row.starts_at)}</span>
      </div>
      <RichText value={row.title} as="h3" />
      {row.ends_at ? <p className="fine-print">Until {formatPacific(row.ends_at)}</p> : null}
      {row.location ? <p>{row.location}</p> : null}
      {row.description ? <RichText value={row.description} /> : null}
      {canEdit ? (
        <div className="card-actions">
          <button type="button" className="button button-quiet" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="button button-quiet" onClick={onDelete} disabled={pending}>
            Delete
          </button>
        </div>
      ) : null}
    </li>
  )
}
