import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { CopySignupLink } from '../components/CopySignupLink.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import {
  approveAccessRequest,
  loadAccessQueue,
  notifyAccessChanged,
  rejectAccessRequest,
  type AccessQueueRow,
} from '../lib/access.ts'
import { defaultTeamId } from '../lib/accessRules.ts'
import { formatWhen } from '../lib/format.ts'
import { canManageClub, roleLabel, type AssignableRole } from '../lib/types.ts'

type Draft = {
  teamId: string
  role: AssignableRole
}

export function AccessPage() {
  const { profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const [rows, setRows] = useState<AccessQueueRow[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [listToken, setListToken] = useState(0)

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    loadAccessQueue().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      const nextDrafts: Record<string, Draft> = {}
      for (const row of next) {
        nextDrafts[row.id] = {
          teamId: defaultTeamId(row.requestedTeamIds, row.assignableTeamIds),
          role: 'player',
        }
      }
      setRows(next)
      setDrafts(nextDrafts)
      setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [staff, listToken])

  async function onApprove(row: AccessQueueRow) {
    const draft = drafts[row.id]
    if (!draft?.teamId || pendingId) return
    setPendingId(row.id)
    setError(null)
    setNotice(null)
    const result = await approveAccessRequest({
      requestId: row.id,
      teamId: draft.teamId,
      role: row.canSetRole ? draft.role : 'player',
    })
    setPendingId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    const teamName = row.assignableTeamNames[row.assignableTeamIds.indexOf(draft.teamId)] ?? 'that side'
    setNotice(
      result.emailNote
        ? `${row.fullName || row.email || 'They'} can now play with ${teamName}. ${result.emailNote}`
        : `${row.fullName || row.email || 'They'} can now play with ${teamName}.`,
    )
    notifyAccessChanged()
    setListToken((value) => value + 1)
  }

  async function onReject(row: AccessQueueRow) {
    if (pendingId) return
    const extra =
      row.requestedTeamNames.length > 1
        ? ` This closes the request for ${row.requestedTeamNames.join(', ')}.`
        : ''
    if (!window.confirm(`Reject the request from ${row.fullName || row.email || 'this person'}?${extra}`)) return
    setPendingId(row.id)
    setError(null)
    setNotice(null)
    const result = await rejectAccessRequest(row.id)
    setPendingId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    setNotice(
      result.emailNote
        ? `Request from ${row.fullName || row.email || 'them'} was declined. ${result.emailNote}`
        : `Request from ${row.fullName || row.email || 'them'} was declined.`,
    )
    notifyAccessChanged()
    setListToken((value) => value + 1)
  }

  const pending = rows?.filter((row) => row.status === 'pending') ?? []
  const decided = rows?.filter((row) => row.status !== 'pending') ?? []

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Clubhouse</p>
        <h1>Access requests</h1>
        <p className="lede">
          People who open the public sign-up link wait here. Admins can approve any side. Captains
          can approve a request only when it includes a side they captain, and only as a player.
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins review access requests. Ask one of them.
      </RoleNote>
      {staff ? (
        <section className="panel" aria-labelledby="signup-link-heading">
          <div className="section-heading">
            <p className="kicker">Share</p>
            <h2 id="signup-link-heading">Public sign-up link</h2>
          </div>
          <p className="lede">
            Anyone with this link can ask to join and pick a side. They cannot see the clubhouse
            until you approve them.
          </p>
          <CopySignupLink prominent />
        </section>
      ) : null}
      {notice ? (
        <p className="banner banner-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {staff ? (
        <section className="panel" aria-labelledby="queue-heading">
          <div className="section-heading">
            <p className="kicker">Waiting</p>
            <h2 id="queue-heading">Pending</h2>
          </div>
          {rows === null ? <p className="empty-copy">Loading requests…</p> : null}
          {rows && pending.length === 0 ? <p className="empty-copy">No one is waiting.</p> : null}
          {pending.length > 0 ? (
            <ul className="card-list tiles">
              {pending.map((row) => {
                const draft = drafts[row.id]
                const busy = pendingId === row.id
                return (
                  <li key={row.id} className="info-card">
                    <p className="team-name">{row.fullName || row.email || 'New player'}</p>
                    {row.email ? <p className="fine-print">{row.email}</p> : null}
                    <p className="fine-print">
                      Asked for {row.requestedTeamNames.join(', ') || 'a side'} · {formatWhen(row.createdAt)}
                    </p>
                    {row.note ? <p>{row.note}</p> : null}
                    <label htmlFor={`team-${row.id}`}>Side to assign</label>
                    <select
                      id={`team-${row.id}`}
                      value={draft?.teamId ?? ''}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.id]: { teamId: event.target.value, role: current[row.id]?.role ?? 'player' },
                        }))
                      }
                    >
                      {row.assignableTeamIds.map((teamId, index) => (
                        <option key={teamId} value={teamId}>
                          {row.assignableTeamNames[index] ?? 'Side'}
                        </option>
                      ))}
                    </select>
                    {row.canSetRole ? (
                      <>
                        <label htmlFor={`role-${row.id}`}>Role</label>
                        <select
                          id={`role-${row.id}`}
                          value={draft?.role ?? 'player'}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.id]: {
                                teamId: current[row.id]?.teamId ?? '',
                                role: event.target.value === 'captain' ? 'captain' : 'player',
                              },
                            }))
                          }
                        >
                          <option value="player">Player</option>
                          <option value="captain">Captain</option>
                        </select>
                      </>
                    ) : (
                      <p className="fine-print">They join as a player. An admin can change that later.</p>
                    )}
                    <div className="card-actions">
                      <button
                        type="button"
                        className="button button-gold"
                        onClick={() => void onApprove(row)}
                        disabled={busy || !draft?.teamId}
                      >
                        {busy ? 'Saving…' : 'Approve'}
                      </button>
                      <button type="button" className="button-quiet" onClick={() => void onReject(row)} disabled={busy}>
                        Reject
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
      {staff && decided.length > 0 ? (
        <section className="panel" aria-labelledby="decided-heading">
          <div className="section-heading">
            <p className="kicker">Recent</p>
            <h2 id="decided-heading">Decided</h2>
          </div>
          <ul className="card-list tiles">
            {decided.map((row) => (
              <li key={row.id} className="info-card">
                <p className="team-name">{row.fullName || row.email || 'Player'}</p>
                <p className="fine-print">
                  {row.status === 'approved'
                    ? `Approved as ${roleLabel(row.assignedRole ?? 'player')}`
                    : 'Declined'}
                  {row.decidedAt ? ` · ${formatWhen(row.decidedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
