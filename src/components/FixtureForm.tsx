import { useId, useRef, useState, type FormEvent } from 'react'
import { saveFixture } from '../lib/schedules.ts'
import type { ScheduleEvent, ScheduleEventType, Team } from '../lib/types.ts'

function clock(value: string): string {
  const match = /^(\d{2}:\d{2})/.exec(value)
  return match ? match[1] : ''
}

export function FixtureForm({
  teams,
  initial,
  onSaved,
  onCancel,
}: {
  teams: Team[]
  initial: ScheduleEvent | null
  onSaved: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const sending = useRef(false)
  const [eventType, setEventType] = useState<ScheduleEventType>(initial?.event_type ?? 'league_game')
  const [teamId, setTeamId] = useState(initial?.team_id ?? '')
  const selectedTeam = teamId || teams[0]?.id || ''
  const [opponent, setOpponent] = useState(initial?.opponent ?? '')
  const [date, setDate] = useState(initial?.game_date.slice(0, 10) ?? '')
  const [time, setTime] = useState(initial ? clock(initial.start_time) : '')
  const [format, setFormat] = useState(initial?.match_format ?? (initial ? '' : 'T20'))
  const [ground, setGround] = useState(initial?.ground ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [division, setDivision] = useState(initial?.division ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (!selectedTeam) {
      setError('Choose a side.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      setError('Choose a date and a Pacific start time.')
      return
    }
    const nextOpponent = opponent.trim()
    const nextGround = ground.trim()
    if (nextOpponent.length < 1 || nextOpponent.length > 160 || nextGround.length < 1 || nextGround.length > 160) {
      setError('Add an opponent and a ground.')
      return
    }
    const nextAddress = address.trim()
    const nextFormat = format.trim()
    const nextDivision = division.trim()
    const nextNotes = notes.trim()
    if (
      nextAddress.length > 240 ||
      nextFormat.length > 40 ||
      nextDivision.length > 40 ||
      nextNotes.length > 500
    ) {
      setError('One of the fields is too long.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveFixture({
      id: initial?.id,
      team_id: selectedTeam,
      event_type: eventType,
      game_date: date,
      start_time: time,
      match_format: nextFormat.length > 0 ? nextFormat : null,
      ground: nextGround,
      address: nextAddress.length > 0 ? nextAddress : null,
      opponent: nextOpponent,
      division: eventType === 'umpiring' && nextDivision.length > 0 ? nextDivision : null,
      notes: nextNotes.length > 0 ? nextNotes : null,
    })
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    onSaved()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">{initial ? 'Edit' : 'New'}</p>
        <h2>{initial ? 'Update this fixture' : 'Add a fixture'}</h2>
      </div>
      <p className="lede">Date and start time are Pacific wall-clock times.</p>
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-type`}>Kind</label>
          <select
            id={`${titleId}-type`}
            name="eventType"
            value={eventType}
            onChange={(event) => setEventType(event.target.value === 'umpiring' ? 'umpiring' : 'league_game')}
          >
            <option value="league_game">League game</option>
            <option value="umpiring">Umpiring</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${titleId}-side`}>Side</label>
          <select
            id={`${titleId}-side`}
            name="team"
            value={selectedTeam}
            onChange={(event) => setTeamId(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${titleId}-date`}>Date</label>
          <input
            id={`${titleId}-date`}
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-time`}>Start</label>
          <input
            id={`${titleId}-time`}
            name="time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </div>
      </div>
      <label htmlFor={titleId}>{eventType === 'umpiring' ? 'Matchup' : 'Opponent'}</label>
      <input
        id={titleId}
        name="opponent"
        value={opponent}
        onChange={(event) => setOpponent(event.target.value)}
        maxLength={160}
        required
        placeholder={eventType === 'umpiring' ? 'Home vs Visitor' : 'Opposition'}
      />
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-format`}>Format</label>
          <input
            id={`${titleId}-format`}
            name="format"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            maxLength={40}
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-division`}>Division</label>
          <input
            id={`${titleId}-division`}
            name="division"
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            maxLength={40}
            disabled={eventType !== 'umpiring'}
          />
        </div>
      </div>
      <label htmlFor={`${titleId}-ground`}>Ground</label>
      <input
        id={`${titleId}-ground`}
        name="ground"
        value={ground}
        onChange={(event) => setGround(event.target.value)}
        maxLength={160}
        required
      />
      <label htmlFor={`${titleId}-address`}>Address</label>
      <input
        id={`${titleId}-address`}
        name="address"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        maxLength={240}
      />
      <label htmlFor={`${titleId}-notes`}>Notes</label>
      <textarea
        id={`${titleId}-notes`}
        name="notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={500}
        rows={3}
      />
      <div className="composer-row">
        {initial ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save fixture' : 'Add fixture'}
        </button>
      </div>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
