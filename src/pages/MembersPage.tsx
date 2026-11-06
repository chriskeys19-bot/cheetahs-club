import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { AdminNav } from '../components/AdminNav.tsx'
import { SearchField } from '../components/SearchField.tsx'
import { ResetPasswordDialog, type ResetMember } from '../components/ResetPasswordDialog.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { compareMembers, loadMembers, setMemberRole } from '../lib/members.ts'
import { filterByQuery } from '../lib/search.ts'
import {
  displayName,
  isAssignableRole,
  isClubRole,
  roleLabel,
  type AssignableRole,
  type ClubMember,
  type ClubRole,
} from '../lib/types.ts'

function roleTagClass(role: ClubRole): string {
  if (role === 'admin') return 'tag tag-gold'
  if (role === 'captain') return 'tag tag-navy'
  return 'tag'
}

export function MembersPage() {
  const { session, profile, profileReady, profileError } = useAuth()
  const searchId = useId()
  const isAdmin = profile?.role === 'admin'
  const actorId = session?.user.id ?? null
  const [rows, setRows] = useState<ClubMember[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, AssignableRole>>({})
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const [resetTarget, setResetTarget] = useState<ResetMember | null>(null)
  const [toast, setToast] = useState<{ id: number; tone: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    loadMembers().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      const nextDrafts: Record<string, AssignableRole> = {}
      for (const member of next) {
        if (isAssignableRole(member.role)) nextDrafts[member.id] = member.role
      }
      setRows(next)
      setDrafts(nextDrafts)
      setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current))
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function onSave(member: ClubMember) {
    if (!actorId || !isAssignableRole(member.role)) return
    const nextRole = drafts[member.id]
    if (!nextRole || nextRole === member.role) return
    setPendingId(member.id)
    setRowError(null)
    setSavedId(null)
    const result = await setMemberRole({
      targetId: member.id,
      role: nextRole,
      actorId,
    })
    setPendingId(null)
    if (result.error || !result.role) {
      setRowError({ id: member.id, message: result.error ?? 'The role could not be saved.' })
      return
    }
    const savedRole = result.role
    setRows((current) =>
      current?.map((row) => (row.id === member.id ? { ...row, role: savedRole } : row)).sort(compareMembers) ??
      current,
    )
    if (isAssignableRole(savedRole)) {
      setDrafts((current) => ({ ...current, [member.id]: savedRole }))
    }
    setSavedId(member.id)
  }

  const visible = filterByQuery(rows ?? [], query, (member) => [
    member.full_name,
    member.email,
    displayName({ id: member.id, full_name: member.full_name, role: member.role }, member.email),
  ])

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Admin</p>
        <h1>Members</h1>
        <p className="lede">
          Everyone with a Cheetahs account. Join links still create players. An admin can switch a
          player to captain, or a captain back to player, and can send a password reset.
        </p>
      </header>
      {isAdmin ? <AdminNav /> : null}
      <section className="panel" aria-labelledby="members-heading">
        {profileError ? (
          <p className="banner banner-error" role="alert">
            {profileError}
          </p>
        ) : null}
        <RoleNote ready={profileReady} restricted={!isAdmin}>
          Captains and players cannot change club roles. Captains can still invite players and add
          an existing player to another side.
        </RoleNote>
        {isAdmin ? (
          <div>
            <div className="section-heading">
              <p className="kicker">Roster</p>
              <h2 id="members-heading">Club members</h2>
            </div>
            <p className="lede">
              Your own role stays as it is. The last admin stays an admin.
            </p>
            <p className="fine-print">
              <Link to="/invites">Invites</Link> still add players, and they place an existing member on
              another side.
            </p>
            {rows && !error && rows.length > 0 ? (
              <SearchField
                id={searchId}
                label="Search members"
                value={query}
                onChange={setQuery}
                placeholder="Name or email"
              />
            ) : null}
            {rows === null && !error ? <p className="empty-copy">Loading members…</p> : null}
            {error ? (
              <p className="banner banner-error" role="alert">
                {error}
              </p>
            ) : null}
            {rows && !error && rows.length === 0 ? <p className="empty-copy">No members yet.</p> : null}
            {rows && !error && rows.length > 0 && visible.length === 0 ? (
              <p className="empty-copy">No matches.</p>
            ) : null}
            {rows && !error && visible.length > 0 ? (
              <ul className="card-list member-list">
                {visible.map((member) => {
                  const name = displayName(
                    { id: member.id, full_name: member.full_name, role: member.role },
                    member.email,
                  )
                  const mine = member.id === actorId
                  const draft = drafts[member.id]
                  const editable = isAssignableRole(member.role) && !mine && draft !== undefined
                  const busy = pendingId === member.id
                  return (
                    <li key={member.id} className="info-card member-card">
                      <div className="member-head">
                        <div className="member-identity">
                          <p className="team-name">{name}</p>
                          <p className="fine-print member-email">{member.email ?? 'No email on the account'}</p>
                        </div>
                        <span className={roleTagClass(member.role)}>{roleLabel(member.role)}</span>
                      </div>
                      {mine ? (
                        <p className="fine-print">
                          {member.role === 'admin' && rows.filter((row) => row.role === 'admin').length < 2
                            ? 'You are the last admin. This role stays.'
                            : 'This is you. Your role stays as it is.'}
                        </p>
                      ) : null}
                      {!mine && member.role === 'admin' ? (
                        <p className="fine-print">Admins are listed here. This screen changes players and captains.</p>
                      ) : null}
                      {editable ? (
                        <form
                          className="member-role"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void onSave(member)
                          }}
                        >
                          <label htmlFor={`role-${member.id}`}>Club role for {name}</label>
                          <select
                            id={`role-${member.id}`}
                            name="role"
                            value={draft}
                            disabled={busy}
                            onChange={(event) => {
                              const value = event.target.value
                              if (!isClubRole(value) || !isAssignableRole(value)) return
                              setDrafts((current) => ({ ...current, [member.id]: value }))
                              setSavedId((current) => (current === member.id ? null : current))
                              setRowError((current) => (current?.id === member.id ? null : current))
                            }}
                          >
                            <option value="player">Player</option>
                            <option value="captain">Captain</option>
                          </select>
                          <button type="submit" className="button button-gold" disabled={busy || draft === member.role}>
                            {busy ? 'Saving…' : 'Save role'}
                          </button>
                        </form>
                      ) : null}
                      {savedId === member.id ? (
                        <p className="fine-print" role="status">
                          Saved as {roleLabel(member.role).toLowerCase()}.
                        </p>
                      ) : null}
                      {rowError?.id === member.id ? (
                        <p className="banner banner-error" role="alert">
                          {rowError.message}
                        </p>
                      ) : null}
                      {member.email ? (
                        <div className="card-actions">
                          <button
                            type="button"
                            className="button-quiet"
                            onClick={() =>
                              setResetTarget({
                                id: member.id,
                                name,
                                email: member.email ?? '',
                              })
                            }
                          >
                            Reset password
                          </button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
      {resetTarget ? (
        <ResetPasswordDialog
          key={resetTarget.id}
          member={resetTarget}
          onClose={() => setResetTarget(null)}
          onToast={(next) => setToast({ ...next, id: Date.now() })}
        />
      ) : null}
      {toast ? (
        <div className="toast-stack">
          <p
            className={toast.tone === 'success' ? 'toast toast-success' : 'toast toast-error'}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span>{toast.message}</span>
            <button type="button" className="toast-dismiss" onClick={() => setToast(null)}>
              Dismiss
            </button>
          </p>
        </div>
      ) : null}
    </div>
  )
}
