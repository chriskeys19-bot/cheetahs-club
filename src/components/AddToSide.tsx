import { useEffect, useId, useState, type FormEvent } from 'react'
import { teamName } from '../lib/invites.ts'
import { addToSide, loadTeamRoster, removeFromSide } from '../lib/roster.ts'
import { displayName, roleLabel, type RosterMember, type Team } from '../lib/types.ts'

function memberLabel(member: RosterMember): string {
  return displayName({ id: member.id, full_name: member.full_name, role: member.role }, member.email)
}

function roleTag(role: RosterMember['role']): string {
  if (role === 'admin') return 'tag tag-gold'
  if (role === 'captain') return 'tag tag-navy'
  return 'tag'
}

function openSideId(teams: Team[], member: RosterMember | null): string {
  if (!member) return ''
  return teams.find((team) => !member.team_ids.includes(team.id))?.id ?? ''
}

export function AddToSide({ teams, suggestedEmail }: { teams: Team[]; suggestedEmail: string | null }) {
  const memberFieldId = useId()
  const teamFieldId = useId()
  const [rows, setRows] = useState<RosterMember[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [memberChoice, setMemberChoice] = useState<string | null>(null)
  const [teamChoice, setTeamChoice] = useState<string | null>(null)
  const [seenSuggestion, setSeenSuggestion] = useState(suggestedEmail)
  const [busy, setBusy] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [listToken, setListToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadTeamRoster().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      setLoadError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [listToken])

  if (suggestedEmail !== seenSuggestion) {
    setSeenSuggestion(suggestedEmail)
    setMemberChoice(null)
    setTeamChoice(null)
  }

  const suggestedMember =
    rows?.find((row) => suggestedEmail !== null && row.email?.toLowerCase() === suggestedEmail) ?? null
  const memberId = memberChoice ?? suggestedMember?.id ?? ''
  const member = rows?.find((row) => row.id === memberId) ?? null
  const teamId = teamChoice ?? openSideId(teams, member)
  const already = Boolean(member && teamId && member.team_ids.includes(teamId))
  const openSides = member ? teams.filter((team) => !member.team_ids.includes(team.id)) : teams

  function chooseMember(nextId: string) {
    setMemberChoice(nextId)
    setError(null)
    setNotice(null)
    const next = rows?.find((row) => row.id === nextId)
    setTeamChoice(openSideId(teams, next ?? null))
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!member || !teamId || already || busy) return
    const side = teamName(teams, teamId)
    const name = memberLabel(member)
    setBusy(true)
    setError(null)
    setNotice(null)
    const message = await addToSide({ profileId: member.id, teamId })
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setNotice(`${name} is now on ${side}. Their login and club role stay the same.`)
    setListToken((value) => value + 1)
  }

  async function onRemove(person: RosterMember, sideId: string) {
    const side = teamName(teams, sideId)
    const name = memberLabel(person)
    if (!window.confirm(`Remove ${name} from ${side}? They keep their account and any other sides.`)) return
    const key = `${person.id}:${sideId}`
    setPendingKey(key)
    setError(null)
    setNotice(null)
    const message = await removeFromSide({ profileId: person.id, teamId: sideId })
    setPendingKey(null)
    if (message) {
      setError(message)
      return
    }
    setNotice(`${name} is no longer on ${side}.`)
    setListToken((value) => value + 1)
  }

  return (
    <section className="panel" id="add-to-side" aria-labelledby="add-side-heading">
      <div className="section-heading">
        <p className="kicker">Already in the club</p>
        <h2 id="add-side-heading">Add to a side</h2>
      </div>
      <p className="lede">
        Someone who already has an account can be placed on Alpha, Beta, or Gamma as well. This
        does not send a join link and does not change their role.
      </p>
      {suggestedEmail ? (
        <p className="banner banner-success" role="status">
          {suggestedEmail} already has a club account. Add them to a side here.
        </p>
      ) : null}
      {loadError ? (
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {rows === null && !loadError ? <p className="empty-copy">Loading members…</p> : null}
      {rows && rows.length === 0 && !loadError ? (
        <p className="empty-copy">No members yet. Invite a player first.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <form className="composer" onSubmit={onAdd}>
          <label htmlFor={memberFieldId}>Member</label>
          <select
            id={memberFieldId}
            name="member"
            value={memberId}
            onChange={(event) => chooseMember(event.target.value)}
          >
            <option value="">Choose a member</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {memberLabel(row)}
                {row.email ? ` · ${row.email}` : ''}
              </option>
            ))}
          </select>
          <label htmlFor={teamFieldId}>Side</label>
          <select
            id={teamFieldId}
            name="side"
            value={teamId}
            onChange={(event) => {
              setTeamChoice(event.target.value)
              setError(null)
              setNotice(null)
            }}
          >
            <option value="">Choose a side</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          {member && already ? (
            <p className="fine-print">{memberLabel(member)} is already on {teamName(teams, teamId)}.</p>
          ) : null}
          {member && openSides.length === 0 ? (
            <p className="fine-print">{memberLabel(member)} is already on every side.</p>
          ) : null}
          <button
            type="submit"
            className="button button-gold"
            disabled={busy || !member || !teamId || already}
          >
            {busy ? 'Adding…' : 'Add to side'}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner banner-success" role="status">
          {notice}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <div className="add-side-roster">
          <div className="section-heading">
            <p className="kicker">Roster</p>
            <h2>Who is on which side</h2>
          </div>
          <ul className="card-list tiles">
            {rows.map((row) => {
              const name = memberLabel(row)
              const sides = teams.filter((team) => row.team_ids.includes(team.id))
              return (
                <li key={row.id} className="info-card">
                  <div className="member-head">
                    <div className="member-identity">
                      <p className="team-name">{name}</p>
                      <p className="fine-print member-email">{row.email ?? 'No email on the account'}</p>
                    </div>
                    <span className={roleTag(row.role)}>{roleLabel(row.role)}</span>
                  </div>
                  {sides.length === 0 ? <p className="fine-print">No side yet</p> : null}
                  {sides.length > 0 ? (
                    <ul className="card-list">
                      {sides.map((team) => {
                        const key = `${row.id}:${team.id}`
                        const removing = pendingKey === key
                        return (
                          <li key={team.id} className="card-actions">
                            <span className="tag tag-gold">{team.name}</span>
                            <button
                              type="button"
                              className="button-quiet"
                              onClick={() => onRemove(row, team.id)}
                              disabled={pendingKey !== null}
                            >
                              {removing ? 'Removing…' : `Remove from ${team.name}`}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
