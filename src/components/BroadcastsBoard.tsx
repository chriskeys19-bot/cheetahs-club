import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import {
  CHICAGO,
  PACIFIC,
  canEndBroadcast,
  canStartBroadcast,
  displayStatus,
  endConfirmCopy,
  groupBroadcasts,
  lifeCycleLabel,
  looksLikePulsePlay,
  startConfirmCopy,
  startNeedsConfirm,
  zonedClock,
  type BroadcastConnection,
  type BroadcastFilter,
  type BroadcastRow,
} from '../lib/youtubeBroadcasts.ts'

const FILTERS: { id: BroadcastFilter; label: string }[] = [
  { id: 'upcoming', label: 'Today & upcoming' },
  { id: 'live', label: 'Live now' },
  { id: 'ended', label: 'Recent ended' },
]

export function BroadcastsBoard({
  now,
  isAdmin,
  connection,
  rows,
  listError,
  notice,
  filter,
  onFilter,
  inflightId,
  cardNotes,
  refreshing,
  testing,
  testMessage,
  onConnect,
  onTest,
  onRefresh,
  onStart,
  onEnd,
}: {
  now: number
  isAdmin: boolean
  connection: BroadcastConnection | null
  rows: BroadcastRow[] | null
  listError: string | null
  notice: { ok: boolean; text: string } | null
  filter: BroadcastFilter
  onFilter: (filter: BroadcastFilter) => void
  inflightId: string | null
  cardNotes: Record<string, { ok: boolean; text: string }>
  refreshing: boolean
  testing: boolean
  testMessage: string | null
  onConnect: () => void
  onTest: () => void
  onRefresh: () => void
  onStart: (row: BroadcastRow) => void
  onEnd: (row: BroadcastRow) => void
}) {
  const [pending, setPending] = useState<{ action: 'start' | 'end'; row: BroadcastRow } | null>(null)
  const groups = rows ? groupBroadcasts(rows, filter, now) : []
  const connected = connection?.connected === true
  const wrongChannel = connected && connection?.channelTitle && !/cricketcraze/i.test(connection.channelTitle)
  const confirm = pending ? (pending.action === 'start' ? startConfirmCopy(pending.row) : endConfirmCopy(pending.row)) : null

  function askStart(row: BroadcastRow) {
    if (inflightId) return
    if (startNeedsConfirm(row.scheduledStart, now)) {
      setPending({ action: 'start', row })
      return
    }
    onStart(row)
  }

  function askEnd(row: BroadcastRow) {
    if (inflightId) return
    setPending({ action: 'end', row })
  }

  return (
    <div className="page broadcasts-page">
      <header className="page-intro">
        <p className="kicker">YouTube</p>
        <h1>Streams</h1>
        <p className="lede">
          Every live broadcast on the CricketCrazeUSA channel. Times are Central (America/Chicago). Pulse
          Play rows also show Pacific.
        </p>
      </header>

      <section className="panel broadcast-connection">
        <h2>YouTube connection</h2>
        {!connection ? <p>Checking the YouTube connection…</p> : null}
        {connection && !connected ? (
          <p>YouTube is not connected. An admin needs to connect the CricketCrazeUSA account.</p>
        ) : null}
        {connected ? (
          <p>
            Connected as <strong>{connection?.channelTitle || 'a YouTube channel'}</strong>
            {connection?.channelId ? <span className="fine-print"> ({connection.channelId})</span> : null}.
          </p>
        ) : null}
        {connection?.needsReconnect && connection.message ? (
          <p className="banner banner-error" role="alert">
            {connection.message}
          </p>
        ) : null}
        {wrongChannel ? (
          <p className="banner banner-note" role="status">
            This is not the CricketCrazeUSA channel. Reconnect with cricketcrazeusa@gmail.com.
          </p>
        ) : null}
        <div className="broadcast-actions">
          {isAdmin ? (
            <button type="button" className="button button-gold" onClick={onConnect} disabled={Boolean(inflightId)}>
              {connected ? 'Reconnect' : 'Connect YouTube'}
            </button>
          ) : null}
          <button type="button" className="button button-quiet" onClick={onTest} disabled={!connected || testing || Boolean(inflightId)}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="button button-quiet" onClick={onRefresh} disabled={refreshing || Boolean(inflightId)}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {testMessage ? (
          <p className={testMessage.startsWith('YouTube responded') ? 'banner banner-success' : 'banner banner-error'} role="status">
            {testMessage}
          </p>
        ) : null}
      </section>

      {notice ? (
        <p className={notice.ok ? 'banner banner-success' : 'banner banner-error'} role="status">
          {notice.text}
        </p>
      ) : null}
      {listError ? (
        <p className="banner banner-error" role="alert">
          {listError}
        </p>
      ) : null}

      <div className="filter-bar" role="group" aria-label="Which broadcasts">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="filter-chip"
            aria-pressed={filter === item.id}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {rows === null && !listError ? <p className="empty-copy">Loading broadcasts…</p> : null}
      {rows && groups.length === 0 && !listError ? (
        <p className="empty-copy">
          {filter === 'live'
            ? 'Nothing is live right now.'
            : filter === 'ended'
              ? 'No broadcasts ended in the last 14 days.'
              : 'No broadcasts are scheduled for today or later.'}
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.dayKey} className="broadcast-day">
          <h2>{group.dayLabel}</h2>
          <ul className="card-list">
            {group.rows.map((row) => {
              const central = row.scheduledStart ? zonedClock(row.scheduledStart, CHICAGO) : null
              const pulse = looksLikePulsePlay(row.title, row.streamKeyName)
              const pacific = pulse && row.scheduledStart ? zonedClock(row.scheduledStart, PACIFIC) : null
              const status = displayStatus(row.lifeCycle)
              const busy = inflightId === row.id
              const locked = inflightId !== null
              const note = cardNotes[row.id]
              return (
                <li key={row.id} className="broadcast-card">
                  <div className="tag-row">
                    {central ? <span className="tag tag-gold">{central.timeLabel}</span> : <span className="tag">No time</span>}
                    {pacific ? <span className="tag">{pacific.timeLabel}</span> : null}
                    <span className={status === 'live' ? 'tag tag-navy' : 'tag'}>{lifeCycleLabel(row.lifeCycle)}</span>
                  </div>
                  <h3>{row.title}</h3>
                  <p>{row.streamKeyName ? `Stream key: ${row.streamKeyName}` : 'Stream key: not matched to a club stream key'}</p>
                  <p className="broadcast-watch">
                    <a href={row.watchUrl} target="_blank" rel="noreferrer">
                      {row.watchUrl}
                    </a>
                  </p>
                  <div className="broadcast-actions">
                    {canStartBroadcast(row.lifeCycle) ? (
                      <button type="button" className="button button-gold" onClick={() => askStart(row)} disabled={locked}>
                        {busy ? 'Starting…' : 'Start'}
                      </button>
                    ) : null}
                    {canEndBroadcast(row.lifeCycle) ? (
                      <button type="button" className="button button-danger" onClick={() => askEnd(row)} disabled={locked}>
                        {busy ? 'Ending…' : 'End'}
                      </button>
                    ) : null}
                  </div>
                  {note ? (
                    <p className={note.ok ? 'banner banner-success' : 'banner banner-error'} role="status">
                      {note.text}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {pending && confirm ? (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={pending.action === 'start' ? 'Start stream' : 'End stream'}
          busy={inflightId === pending.row.id}
          busyLabel={pending.action === 'start' ? 'Starting…' : 'Ending…'}
          onCancel={() => {
            if (!inflightId) setPending(null)
          }}
          onConfirm={() => {
            const current = pending
            setPending(null)
            if (current.action === 'start') onStart(current.row)
            else onEnd(current.row)
          }}
        />
      ) : null}
    </div>
  )
}
