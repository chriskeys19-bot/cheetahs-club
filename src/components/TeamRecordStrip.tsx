import {
  buildTeamRecords,
  recordParts,
  recordsForSide,
  type RecordEvent,
  type RecordFilter,
  type RecordTeam,
  type TeamSeasonRecord,
} from '../lib/teamRecord.ts'

const SELECTABLE = new Set(['alpha', 'beta', 'gamma'])

function spokenRecord(record: TeamSeasonRecord): string {
  const wins = `${record.wins} ${record.wins === 1 ? 'win' : 'wins'}`
  const losses = `${record.losses} ${record.losses === 1 ? 'loss' : 'losses'}`
  const ties =
    record.tiesOrNr > 0
      ? `, ${record.tiesOrNr} ${record.tiesOrNr === 1 ? 'tie or no result' : 'ties or no results'}`
      : ''
  return `${record.shortName}, ${wins}, ${losses}${ties}, ${record.toPlay} to play`
}

function badgeClass(result: TeamSeasonRecord['form'][number]['result']): string {
  if (result === 'win') return 'form-badge form-badge-win'
  if (result === 'loss') return 'form-badge form-badge-loss'
  if (result === 'nr') return 'form-badge form-badge-neutral form-badge-nr'
  return 'form-badge form-badge-neutral'
}

function RecordFigures({ record }: { record: TeamSeasonRecord }) {
  const parts = recordParts(record)
  return (
    <span className="record-figures" aria-hidden="true">
      <span className="record-name">{record.shortName}</span>
      <span className="record-stats">
        {parts.map((part, index) => (
          <span key={part.key} className="record-stat">
            {index > 0 ? <span className="record-dot">·</span> : null}
            <span className={`record-stat-${part.key}`}>{part.text}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

function FormBadges({ record }: { record: TeamSeasonRecord }) {
  if (record.form.length === 0) return null
  return (
    <ol className="form-badges" aria-label={`${record.shortName} last ${record.form.length} results, oldest to newest`}>
      {record.form.map((mark) => (
        <li key={mark.id}>
          <span className={badgeClass(mark.result)} role="img" aria-label={mark.label} title={mark.label}>
            <span aria-hidden="true">{mark.letter}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: TeamSeasonRecord
  selected: boolean
  onSelect?: () => void
}) {
  const className = selected ? 'record-row is-selected' : 'record-row'
  return (
    <li className={className}>
      {onSelect ? (
        <button
          type="button"
          className="record-select"
          aria-pressed={selected}
          aria-label={spokenRecord(record)}
          onClick={onSelect}
        >
          <RecordFigures record={record} />
        </button>
      ) : (
        <div className="record-select">
          <span className="sr-only">{spokenRecord(record)}</span>
          <RecordFigures record={record} />
        </div>
      )}
      <FormBadges record={record} />
    </li>
  )
}

export function TeamRecordStrip({
  teams,
  events,
  side,
  myTeamIds,
  onSelectTeam,
}: {
  teams: RecordTeam[]
  events: RecordEvent[]
  side: RecordFilter
  myTeamIds: readonly string[]
  onSelectTeam?: (slug: 'alpha' | 'beta' | 'gamma') => void
}) {
  const records = recordsForSide(buildTeamRecords(teams, events), side, myTeamIds)
  if (records.length === 0) return null

  return (
    <section className="record-strip-wrap" aria-labelledby="team-record-heading">
      <h2 id="team-record-heading" className="kicker">
        Team record
      </h2>
      <ul className="record-strip">
        {records.map((record) => {
          const selectable = Boolean(onSelectTeam) && SELECTABLE.has(record.slug)
          return (
            <RecordRow
              key={record.teamId}
              record={record}
              selected={side === record.slug}
              onSelect={
                selectable && onSelectTeam
                  ? () => onSelectTeam(record.slug as 'alpha' | 'beta' | 'gamma')
                  : undefined
              }
            />
          )
        })}
      </ul>
    </section>
  )
}
