import { formatPacificDate } from '../lib/format.ts'
import { CADENCE_LABEL, CADENCES, expandCadence, isCadence, type Cadence } from '../lib/recurrence.ts'

function seriesNoun(noun: 'event' | 'activity', count: number): string {
  if (count === 1) return noun
  return noun === 'activity' ? 'activities' : 'events'
}

export function RecurrenceFields({
  idPrefix,
  noun,
  enabled,
  cadence,
  mode,
  until,
  count,
  anchorDate,
  onEnabled,
  onCadence,
  onMode,
  onUntil,
  onCount,
}: {
  idPrefix: string
  noun: 'event' | 'activity'
  enabled: boolean
  cadence: Cadence
  mode: 'until' | 'count'
  until: string
  count: string
  anchorDate: string
  onEnabled: (value: boolean) => void
  onCadence: (value: Cadence) => void
  onMode: (value: 'until' | 'count') => void
  onUntil: (value: string) => void
  onCount: (value: string) => void
}) {
  const parsedCount = Number(count)
  const preview =
    enabled && anchorDate
      ? expandCadence(
          anchorDate,
          cadence,
          mode === 'count'
            ? { kind: 'count', count: parsedCount }
            : { kind: 'until', until },
        )
      : null
  const dates = preview && 'dates' in preview ? preview.dates : null

  return (
    <fieldset className="recurrence">
      <legend className="sr-only">Recurring</legend>
      <label className="check-row" htmlFor={`${idPrefix}-recurring`}>
        <input
          id={`${idPrefix}-recurring`}
          name="recurring"
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        Recurring
      </label>
      {enabled ? (
        <>
          <p className="fine-print">
            Each date is saved as its own {noun}. Editing or removing one later does not change the others.
            Dates are Pacific (America/Los_Angeles). A series can include at most 52.
          </p>
          <div>
            <label htmlFor={`${idPrefix}-cadence`}>Cadence</label>
            <select
              id={`${idPrefix}-cadence`}
              name="cadence"
              value={cadence}
              onChange={(event) => {
                if (isCadence(event.target.value)) onCadence(event.target.value)
              }}
            >
              {CADENCES.map((value) => (
                <option key={value} value={value}>
                  {CADENCE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="choice-list" role="radiogroup" aria-label="End condition">
            <label className="choice">
              <input
                type="radio"
                name={`${idPrefix}-recur-end`}
                value="until"
                checked={mode === 'until'}
                onChange={() => onMode('until')}
              />
              End date
            </label>
            <label className="choice">
              <input
                type="radio"
                name={`${idPrefix}-recur-end`}
                value="count"
                checked={mode === 'count'}
                onChange={() => onMode('count')}
              />
              Number of occurrences
            </label>
          </div>
          {mode === 'until' ? (
            <div>
              <label htmlFor={`${idPrefix}-until`}>Last date</label>
              <input
                id={`${idPrefix}-until`}
                name="until"
                type="date"
                value={until}
                onChange={(event) => onUntil(event.target.value)}
                required
              />
            </div>
          ) : (
            <div>
              <label htmlFor={`${idPrefix}-count`}>Occurrences</label>
              <input
                id={`${idPrefix}-count`}
                name="occurrences"
                type="number"
                inputMode="numeric"
                min={1}
                max={52}
                step={1}
                value={count}
                onChange={(event) => onCount(event.target.value)}
                required
              />
            </div>
          )}
          {dates && dates.length > 0 ? (
            <p className="fine-print">
              Adds {dates.length} {seriesNoun(noun, dates.length)}, {formatPacificDate(dates[0] ?? '')}
              {dates.length > 1 ? ` – ${formatPacificDate(dates[dates.length - 1] ?? '')}` : ''}.
            </p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  )
}
