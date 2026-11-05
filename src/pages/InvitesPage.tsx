import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { RoleNote } from '../components/RoleNote.tsx'
import { formatWhen } from '../lib/format.ts'
import { createInvite, loadPendingInvites, revokeInvite, teamName } from '../lib/invites.ts'
import { loadTeams } from '../lib/teams.ts'
import { canManageClub, joinUrl, type ClubInvite, type Team } from '../lib/types.ts'

export function InvitesPage() {
  const { profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const emailId = useId()
  const teamFieldId = useId()
  const sending = useRef(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [rows, setRows] = useState<ClubInvite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [fresh, setFresh] = useState<ClubInvite | null>(null)
  const [listToken, setListToken] = useState(0)

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    loadTeams().then(({ teams: next, error: nextError }) => {
      if (cancelled) return
      setTeams(next)
      if (nextError) setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [staff])

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    loadPendingInvites().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      if (nextError) setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [staff, listToken])

  async function copyLink(invite: ClubInvite) {
    const url = joinUrl(invite.token)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(invite.id)
    } catch {
      setCopiedId(null)
      setError('Select the join link and copy it from there.')
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError('Enter a valid email address.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const { invite, error: nextError } = await createInvite({
      email: nextEmail,
      teamId: teamId || null,
    })
    sending.current = false
    setBusy(false)
    if (nextError || !invite) {
      setError(nextError ?? 'The invite could not be created.')
      return
    }
    setEmail('')
    setTeamId('')
    setFresh(invite)
    setCopiedId(null)
    setListToken((value) => value + 1)
  }

  async function onRevoke(invite: ClubInvite) {
    if (!window.confirm(`Revoke the invite for ${invite.email}?`)) return
    setPendingId(invite.id)
    setError(null)
    const message = await revokeInvite(invite.id)
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    if (fresh?.id === invite.id) setFresh(null)
    setListToken((value) => value + 1)
  }

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Clubhouse</p>
        <h1>Invites</h1>
        <p className="lede">
          Invite a player by email. They open the join link, choose a password, and get a player
          account. This does not make captains or admins.
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins send join links. Ask one of them for an invite.
      </RoleNote>
      {staff ? (
        <form className="composer" onSubmit={onCreate}>
          <div className="section-heading">
            <p className="kicker">New</p>
            <h2>Invite player</h2>
          </div>
          <p className="lede">
            The club does not email the link yet. After you create it, copy the join URL and send
            it to that person.
          </p>
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="player@example.com"
          />
          <label htmlFor={teamFieldId}>Side</label>
          <select
            id={teamFieldId}
            name="team"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">No side yet</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <button type="submit" className="button button-gold" disabled={busy}>
            {busy ? 'Creating…' : 'Invite player'}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {fresh ? (
        <section className="panel" aria-labelledby="fresh-invite-heading">
          <div className="section-heading">
            <p className="kicker">Share this</p>
            <h2 id="fresh-invite-heading">Join link</h2>
          </div>
          <p className="lede">
            Send this to {fresh.email}. It expires {formatWhen(fresh.expires_at)} and works once.
          </p>
          <div className="join-link">
            <label className="sr-only" htmlFor="fresh-join-url">
              Join URL
            </label>
            <input id="fresh-join-url" readOnly value={joinUrl(fresh.token)} spellCheck={false} />
            <button type="button" className="button button-gold" onClick={() => copyLink(fresh)}>
              {copiedId === fresh.id ? 'Copied' : 'Copy join link'}
            </button>
          </div>
        </section>
      ) : null}
      {staff ? (
        <section className="panel" aria-labelledby="pending-heading">
          <div className="section-heading">
            <p className="kicker">Waiting</p>
            <h2 id="pending-heading">Pending invites</h2>
          </div>
          {rows === null ? <p className="empty-copy">Loading invites…</p> : null}
          {rows && rows.length === 0 ? <p className="empty-copy">No pending invites.</p> : null}
          {rows && rows.length > 0 ? (
            <ul className="card-list">
              {rows.map((invite) => (
                <li key={invite.id} className="info-card">
                  <p className="team-name">{invite.email}</p>
                  <p className="fine-print">
                    {teamName(teams, invite.team_id)} · Expires {formatWhen(invite.expires_at)}
                  </p>
                  <div className="join-link">
                    <label className="sr-only" htmlFor={`join-${invite.id}`}>
                      Join URL for {invite.email}
                    </label>
                    <input
                      id={`join-${invite.id}`}
                      readOnly
                      value={joinUrl(invite.token)}
                      spellCheck={false}
                    />
                  </div>
                  <div className="card-actions">
                    <button type="button" className="button button-gold" onClick={() => copyLink(invite)}>
                      {copiedId === invite.id ? 'Copied' : 'Copy join link'}
                    </button>
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => onRevoke(invite)}
                      disabled={pendingId === invite.id}
                    >
                      {pendingId === invite.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
