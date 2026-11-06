import { useId, useRef, useState, type FormEvent } from 'react'
import { RecurrenceFields } from './RecurrenceFields.tsx'
import { RichTextField } from './RichTextField.tsx'
import { saveActivity, saveActivitySeries, updateActivitySeries } from '../lib/activities.ts'
import { isoToPacificWall, pacificWallToIso } from '../lib/format.ts'
import { visibleTextLength } from '../lib/richText.ts'
import { addCivilDays, civilDayOffset, expandCadence, type Cadence } from '../lib/recurrence.ts'
import type { Activity, Team } from '../lib/types.ts'

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
  const start = isoToPacificWall(initial?.starts_at ?? null)
  const end = isoToPacificWall(initial?.ends_at ?? null)
  const titleId = useId()
  const sending = useRef(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [titleLength, setTitleLength] = useState(() => visibleTextLength(initial?.title ?? ''))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [descriptionLength, setDescriptionLength] = useState(() => visibleTextLength(initial?.description ?? ''))
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  const [endDate, setEndDate] = useState(end.date)
  const [endTime, setEndTime] = useState(end.time)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [teamId, setTeamId] = useState(initial?.team_id ?? '')
  const [seriesScope, setSeriesScope] = useState<'one' | 'series'>('one')
  const [recurring, setRecurring] = useState(false)
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [recurMode, setRecurMode] = useState<'until' | 'count'>('count')
  const [recurUntil, setRecurUntil] = useState('')
  const [recurCount, setRecurCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextTitle = title
    if (titleLength < 1 || titleLength > 140 || title.length > 4000) {
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
    const nextLocation = location.trim()
    if (descriptionLength > 2000 || description.length > 16000 || nextLocation.length > 200) {
      setError('Shorten the description or location.')
      return
    }
    const descriptionValue = descriptionLength > 0 ? description : null
    const locationValue = nextLocation.length > 0 ? nextLocation : null
    const teamValue = teamId || null
    let seriesDates: string[] | null = null
    if (!initial && recurring) {
      if (recurMode === 'count' && !/^\d+$/.test(recurCount)) {
        setError('Enter a whole number of occurrences from 1 to 52.')
        return
      }
      const expanded = expandCadence(
        date,
        cadence,
        recurMode === 'count' ? { kind: 'count', count: Number(recurCount) } : { kind: 'until', until: recurUntil },
      )
      if ('error' in expanded) {
        setError(expanded.error)
        return
      }
      seriesDates = expanded.dates
    }
    const dayOffset = hasEndDate ? civilDayOffset(date, endDate) : null
    if (hasEndDate && dayOffset === null) {
      setError('The end date could not be read.')
      return
    }
    const seriesRows: Array<{
      title: string
      description: string | null
      starts_at: string
      ends_at: string | null
      location: string | null
      team_id: string | null
    }> = []
    if (seriesDates) {
      for (const day of seriesDates) {
        const seriesStart = pacificWallToIso(day, time)
        const seriesEndDay = dayOffset === null ? null : addCivilDays(day, dayOffset)
        const seriesEnd = seriesEndDay && hasEndTime ? pacificWallToIso(seriesEndDay, endTime) : null
        if (!seriesStart || (hasEndDate && !seriesEnd)) {
          setError('One of the repeated dates could not be saved.')
          return
        }
        if (seriesEnd && seriesEnd < seriesStart) {
          setError('The end has to be after the start on every date.')
          return
        }
        seriesRows.push({
          title: nextTitle,
          description: descriptionValue,
          starts_at: seriesStart,
          ends_at: seriesEnd,
          location: locationValue,
          team_id: teamValue,
        })
      }
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message =
      seriesDates
        ? await saveActivitySeries(seriesRows, crypto.randomUUID())
        : initial?.series_id && seriesScope === 'series'
          ? await updateActivitySeries({
              seriesId: initial.series_id,
              anchorStartsAt: initial.starts_at,
              title: nextTitle,
              description: descriptionValue,
              starts_at: startsAt,
              ends_at: endsAt,
              location: locationValue,
              team_id: teamValue,
            })
          : await saveActivity({
              id: initial?.id,
              title: nextTitle,
              description: descriptionValue,
              starts_at: startsAt,
              ends_at: endsAt,
              location: locationValue,
              team_id: teamValue,
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
      <RichTextField
        label="Title"
        initial={initial?.title ?? ''}
        compact
        required
        onChange={(stored, length) => {
          setTitle(stored)
          setTitleLength(length)
        }}
      />
      <RichTextField
        label="Details"
        initial={initial?.description ?? ''}
        onChange={(stored, length) => {
          setDescription(stored)
          setDescriptionLength(length)
        }}
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
      {initial?.series_id ? (
        <fieldset className="recurrence">
          <legend>Apply changes to</legend>
          <label className="check-row">
            <input
              type="radio"
              name={`${titleId}-series-scope`}
              checked={seriesScope === 'one'}
              onChange={() => setSeriesScope('one')}
            />
            This date
          </label>
          <label className="check-row">
            <input
              type="radio"
              name={`${titleId}-series-scope`}
              checked={seriesScope === 'series'}
              onChange={() => setSeriesScope('series')}
            />
            Entire series
          </label>
          <p className="fine-print">
            The whole series keeps each date, shifts those dates by the same number of days, and uses this
            start time. Title, details, location, and side are shared.
          </p>
        </fieldset>
      ) : null}
      {!initial ? (
        <RecurrenceFields
          idPrefix={titleId}
          noun="activity"
          enabled={recurring}
          cadence={cadence}
          mode={recurMode}
          until={recurUntil}
          count={recurCount}
          anchorDate={date}
          onEnabled={setRecurring}
          onCadence={setCadence}
          onMode={setRecurMode}
          onUntil={setRecurUntil}
          onCount={setRecurCount}
        />
      ) : null}
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
          {busy ? 'Saving…' : initial ? 'Save changes' : recurring ? 'Add activities' : 'Add to the feed'}
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
