import { useId, useRef, useState, type FormEvent } from 'react'
import { RecurrenceFields } from './RecurrenceFields.tsx'
import {
  ballLabel,
  defaultKit,
  dressLabel,
  isBallColor,
  isDressCode,
  isGameResult,
  isVenueSide,
  parseScorecardUrl,
  parseVideoUrl,
} from '../lib/games.ts'
import { expandCadence, type Cadence } from '../lib/recurrence.ts'
import { saveFixture, saveFixtureSeries, type FixtureInput } from '../lib/schedules.ts'
import type { ScheduleEvent, ScheduleEventType, Team } from '../lib/types.ts'

function clock(value: string): string {
  const match = /^(\d{2}:\d{2})/.exec(value)
  return match ? match[1] : ''
}

function minutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function isEventType(value: string): value is ScheduleEventType {
  return value === 'league_game' || value === 'umpiring' || value === 'practice' || value === 'other'
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
  const [opponent, setOpponent] = useState(initial?.opponent ?? '')
  const [date, setDate] = useState(initial?.game_date.slice(0, 10) ?? '')
  const [time, setTime] = useState(initial ? clock(initial.start_time) : '')
  const [endTime, setEndTime] = useState(initial?.end_time ? clock(initial.end_time) : '')
  const [format, setFormat] = useState(initial?.match_format ?? (initial ? '' : 'T20'))
  const [ground, setGround] = useState(initial?.ground ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [division, setDivision] = useState(initial?.division ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [recurring, setRecurring] = useState(false)
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [recurMode, setRecurMode] = useState<'until' | 'count'>('count')
  const [recurUntil, setRecurUntil] = useState('')
  const [recurCount, setRecurCount] = useState('')
  const [venueSide, setVenueSide] = useState(initial?.venue_side ?? '')
  const [ballColor, setBallColor] = useState(initial?.ball_color ?? '')
  const [dressCode, setDressCode] = useState(initial?.dress_code ?? '')
  const [result, setResult] = useState(initial?.result ?? '')
  const [scorecard, setScorecard] = useState(initial?.scorecard_url ?? '')
  const [video, setVideo] = useState(initial?.video_url ?? '')
  const [matchStatus, setMatchStatus] = useState<'scheduled' | 'completed'>(initial?.match_status ?? 'scheduled')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const teamRequired = eventType === 'league_game' || eventType === 'umpiring'
  const selectedTeam = teamRequired ? teamId || teams[0]?.id || '' : teamId
  const teamSlug = teams.find((team) => team.id === selectedTeam)?.slug ?? null
  const kitDefault = defaultKit(teamSlug)
  const opponentLabel =
    eventType === 'umpiring' ? 'Matchup' : eventType === 'other' ? 'Title' : eventType === 'practice' ? 'Label' : 'Opponent'

  function onTypeChange(value: string) {
    if (!isEventType(value)) return
    setEventType(value)
    if (value === 'practice' && opponent.trim().length === 0) setOpponent('Cheetahs practice')
    if (value !== 'umpiring') setDivision('')
    if (!initial && (value === 'practice' || value === 'other' || value === 'umpiring')) setFormat('')
    if (!initial && value === 'league_game' && format.trim().length === 0) setFormat('T20')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (teamRequired && !selectedTeam) {
      setError('Choose a side.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      setError('Choose a date and a Pacific start time.')
      return
    }
    if (endTime.length > 0 && !/^\d{2}:\d{2}$/.test(endTime)) {
      setError('Choose a Pacific end time, or leave it blank.')
      return
    }
    const startMinutes = minutes(time)
    const finishMinutes = endTime.length > 0 ? minutes(endTime) : null
    if (startMinutes === null || (endTime.length > 0 && finishMinutes === null)) {
      setError('Choose a Pacific start time and, if you set one, an end time.')
      return
    }
    if (finishMinutes !== null && finishMinutes <= startMinutes) {
      setError('End time has to be later than the start, on the same Pacific day.')
      return
    }
    const nextOpponent = (opponent.trim() || (eventType === 'practice' ? 'Cheetahs practice' : '')).trim()
    const nextGround = ground.trim()
    if (nextOpponent.length < 1 || nextOpponent.length > 160 || nextGround.length < 1 || nextGround.length > 160) {
      setError(eventType === 'practice' || eventType === 'other' ? 'Add a label and a ground.' : 'Add an opponent and a ground.')
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
    let nextVenue: 'home' | 'away' | null = null
    let nextBall: 'white' | 'pink' | null = null
    let nextDress: 'cheetahs_colors' | 'whites' | null = null
    let nextResult: 'win' | 'loss' | 'draw' | 'nr' | null = null
    let nextScorecard: string | null = null
    let nextVideo: string | null = null
    let nextStatus: 'scheduled' | 'completed' = 'scheduled'
    if (eventType === 'league_game') {
      if (!isVenueSide(venueSide)) {
        setError('Mark the league game Home or Away.')
        return
      }
      nextVenue = venueSide
      if (ballColor.length > 0) {
        if (!isBallColor(ballColor)) {
          setError('Choose a ball color.')
          return
        }
        nextBall = ballColor
      }
      if (dressCode.length > 0) {
        if (!isDressCode(dressCode)) {
          setError('Choose a dress code.')
          return
        }
        nextDress = dressCode
      }
      if (result.length > 0) {
        if (!isGameResult(result)) {
          setError('Choose a result.')
          return
        }
        nextResult = result
      }
      const parsedScorecard = parseScorecardUrl(scorecard)
      if (parsedScorecard === 'invalid') {
        setError('Paste a public https://cricclubs.com scorecard link.')
        return
      }
      nextScorecard = parsedScorecard
      const parsedVideo = parseVideoUrl(video)
      if (parsedVideo === 'invalid') {
        setError('Paste a YouTube link (youtube.com or youtu.be), or leave it blank.')
        return
      }
      nextVideo = parsedVideo
      nextStatus = matchStatus === 'completed' ? 'completed' : 'scheduled'
    }
    const draft: FixtureInput = {
      id: initial?.id,
      team_id: selectedTeam.length > 0 ? selectedTeam : null,
      event_type: eventType,
      game_date: date,
      start_time: time,
      end_time: endTime.length > 0 ? endTime : null,
      match_format: nextFormat.length > 0 ? nextFormat : null,
      ground: nextGround,
      address: nextAddress.length > 0 ? nextAddress : null,
      opponent: nextOpponent,
      division: eventType === 'umpiring' && nextDivision.length > 0 ? nextDivision : null,
      notes: nextNotes.length > 0 ? nextNotes : null,
      venue_side: nextVenue,
      ball_color: nextBall,
      dress_code: nextDress,
      result: nextResult,
      scorecard_url: nextScorecard,
      video_url: nextVideo,
      match_status: nextStatus,
    }
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
    sending.current = true
    setBusy(true)
    setError(null)
    const message = seriesDates
      ? await saveFixtureSeries(
          seriesDates.map((gameDate) => ({ ...draft, id: undefined, game_date: gameDate })),
          crypto.randomUUID(),
        )
      : await saveFixture(draft)
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
        <h2>{initial ? 'Update this event' : 'Add an event'}</h2>
      </div>
      <p className="lede">
        Date and times are Pacific wall-clock times. End is optional. Choose Club-wide for a practice or other event that is for every Cheetahs side.
      </p>
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-type`}>Kind</label>
          <select id={`${titleId}-type`} name="eventType" value={eventType} onChange={(event) => onTypeChange(event.target.value)}>
            <option value="league_game">League game</option>
            <option value="practice">Practice</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${titleId}-side`}>Side</label>
          <select id={`${titleId}-side`} name="team" value={selectedTeam} onChange={(event) => setTeamId(event.target.value)}>
            {teamRequired ? null : <option value="">Club-wide</option>}
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
        <div>
          <label htmlFor={`${titleId}-end`}>End</label>
          <input
            id={`${titleId}-end`}
            name="end"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>
      <label htmlFor={titleId}>{opponentLabel}</label>
      <input
        id={titleId}
        name="opponent"
        value={opponent}
        onChange={(event) => setOpponent(event.target.value)}
        maxLength={160}
        required={eventType !== 'practice'}
        placeholder={
          eventType === 'umpiring' ? 'Home vs Visitor' : eventType === 'practice' ? 'Cheetahs practice' : eventType === 'other' ? 'Event title' : 'Opposition'
        }
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
      {eventType === 'league_game' ? (
        <div className="form-grid two">
          <div>
            <label htmlFor={`${titleId}-venue`}>Home or away</label>
            <select
              id={`${titleId}-venue`}
              name="venueSide"
              value={venueSide}
              onChange={(event) => setVenueSide(isVenueSide(event.target.value) ? event.target.value : '')}
              required
            >
              <option value="">Choose</option>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${titleId}-status`}>Status</label>
            <select
              id={`${titleId}-status`}
              name="matchStatus"
              value={matchStatus}
              onChange={(event) => setMatchStatus(event.target.value === 'completed' ? 'completed' : 'scheduled')}
            >
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${titleId}-ball`}>Ball</label>
            <select
              id={`${titleId}-ball`}
              name="ballColor"
              value={ballColor}
              onChange={(event) => setBallColor(isBallColor(event.target.value) ? event.target.value : '')}
            >
              <option value="">
                Team default{kitDefault ? ` (${ballLabel(kitDefault.ball)})` : ''}
              </option>
              <option value="white">White Ball</option>
              <option value="pink">Pink Ball</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${titleId}-dress`}>Dress code</label>
            <select
              id={`${titleId}-dress`}
              name="dressCode"
              value={dressCode}
              onChange={(event) => setDressCode(isDressCode(event.target.value) ? event.target.value : '')}
            >
              <option value="">
                Team default{kitDefault ? ` (${dressLabel(kitDefault.dress)})` : ''}
              </option>
              <option value="cheetahs_colors">Cheetahs Colors</option>
              <option value="whites">Whites</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${titleId}-result`}>Result</label>
            <select
              id={`${titleId}-result`}
              name="result"
              value={result}
              onChange={(event) => setResult(isGameResult(event.target.value) ? event.target.value : '')}
            >
              <option value="">Not posted</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="draw">Draw</option>
              <option value="nr">No result</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${titleId}-scorecard`}>CricClubs scorecard</label>
            <input
              id={`${titleId}-scorecard`}
              name="scorecard"
              type="url"
              inputMode="url"
              value={scorecard}
              onChange={(event) => setScorecard(event.target.value)}
              maxLength={500}
              placeholder="https://cricclubs.com/NCCA/results/..."
            />
          </div>
          <div>
            <label htmlFor={`${titleId}-video`}>Match video</label>
            <input
              id={`${titleId}-video`}
              name="videoUrl"
              type="url"
              inputMode="url"
              value={video}
              onChange={(event) => setVideo(event.target.value)}
              maxLength={500}
              placeholder="https://youtu.be/…"
            />
          </div>
        </div>
      ) : null}
      {eventType === 'league_game' ? (
        <p className="fine-print">
          Alpha and Beta default to a white ball and Cheetahs colors. Gamma defaults to a pink ball and whites.
          Leave ball and dress on Team default unless this game is different. A past start counts as completed.
          Paste the public CricClubs scorecard used for the stream. The match video is an optional YouTube link
          (youtube.com or youtu.be). It shows on completed games. Leave it blank to clear it.
        </p>
      ) : null}
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
      {!initial ? (
        <RecurrenceFields
          idPrefix={titleId}
          noun="event"
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
        <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save event' : recurring ? 'Add events' : 'Add event'}
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
