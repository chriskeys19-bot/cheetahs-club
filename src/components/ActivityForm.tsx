import { useId, useRef, useState, type FormEvent } from 'react'
import { saveActivity } from '../lib/activities.ts'
import { pacificWallToIso } from '../lib/format.ts'
import type { Activity, Team } from '../lib/types.ts'

function wallParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  const hour = map.hour === '24' ? '00' : map.hour
  if (!map.year || !map.month || !map.day || !hour || !map.minute) return { date: '', time: '' }
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${hour}:${map.minute}` }
}

export function ActivityForm({
  teams,
  initial,
  onSaved,
  onCancel,
}: {
  teams: Team[]
  initial: Activity | null
  onSaved: () => void
  onCancel: () => void
}) {
  const start = wallParts(initial?.starts_at ?? null)
  const end = wallParts(initial?.ends_at ?? null)
  const titleId = useId()
  const sending = useRef(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  const [endDate, setEndDate] = useState(end.date)
  const [endTime, setEndTime] = useState(end.time)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [teamId, setTeamId] = useState(initial?.team_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextTitle = title.trim()
    if (nextTitle.length < 1 || nextTitle.length > 140) {
      setError('Give the activity a title up to 140 characters.')
      return
    }
    const startsAt = pacificWallToIso(date, time)
    if (!startsAt) {
      setError('Choose a start date and time. Times are Pacific.')
      return
    }
    const hasEndDate = endDate.trim().length > 0
    const hasEndTime = endTime.trim().length > 0
    if (hasEndDate !== hasEndTime) {
      setError('Add both an end date and an end time, or leave both blank.')
      return
    }
    const endsAt = hasEndDate ? pacificWallToIso(endDate, endTime) : null
    if (hasEndDate && !endsAt) {
      setError('The end time could not be read.')
      return
    }
    if (endsAt && endsAt < startsAt) {
      setError('The end has to be after the start.')
      return
    }
    const nextDescription = description.trim()
    const nextLocation = location.trim()
    if (nextDescription.length > 2000 || nextLocation.length > 200) {
      setError('Shorten the description or location.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveActivity({
      id: initial?.id,
      title: nextTitle,
      description: nextDescription.length > 0 ? nextDescription : null,
      starts_at: startsAt,
      ends_at: endsAt,
      location: nextLocation.length > 0 ? nextLocation : null,
      team_id: teamId || null,
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
        <h2>{initial ? 'Update this activity' : 'Add an activity'}</h2>
      </div>
      <p className="lede">Start and end times are Pacific (America/Los_Angeles).</p>
      <label htmlFor={titleId}>Title</label>
      <input
        id={titleId}
        name="title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={140}
        required
      />
      <label htmlFor={`${titleId}-detail`}>Details</label>
      <textarea
        id={`${titleId}-detail`}
        name="description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={2000}
        rows={4}
      />
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-date`}>Start date</label>
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
          <label htmlFor={`${titleId}-time`}>Start time</label>
          <input
            id={`${titleId}-time`}
            name="time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-end-date`}>End date</label>
          <input
            id={`${titleId}-end-date`}
            name="endDate"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-end-time`}>End time</label>
          <input
            id={`${titleId}-end-time`}
            name="endTime"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>
      <label htmlFor={`${titleId}-where`}>Location</label>
      <input
        id={`${titleId}-where`}
        name="location"
        value={location}
        onChange={(event) => setLocation(event.target.value)}
        maxLength={200}
      />
      <label htmlFor={`${titleId}-side`}>Side</label>
      <select id={`${titleId}-side`} name="team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
        <option value="">Club-wide</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <div className="composer-row">
        {initial ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add to the feed'}
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
