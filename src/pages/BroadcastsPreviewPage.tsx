import { useRef, useState } from 'react'
import { BroadcastsBoard } from '../components/BroadcastsBoard.tsx'
import type { BroadcastConnection, BroadcastFilter, BroadcastRow } from '../lib/youtubeBroadcasts.ts'

const NOW = Date.parse('2026-11-26T16:00:00.000Z')

const ROWS: BroadcastRow[] = [
  {
    id: 'psdEarly111',
    title: 'Pulse Play vs Hawks',
    scheduledStart: '2026-11-26T18:30:00.000Z',
    actualStart: null,
    actualEnd: null,
    lifeCycle: 'ready',
    streamKeyName: 'PSD Key 1',
    watchUrl: 'https://www.youtube.com/watch?v=psdEarly111',
  },
  {
    id: 'soonGame222',
    title: 'Cheetahs Alpha vs Royals',
    scheduledStart: '2026-11-26T16:10:00.000Z',
    actualStart: null,
    actualEnd: null,
    lifeCycle: 'ready',
    streamKeyName: 'Yolobox Pro 2',
    watchUrl: 'https://www.youtube.com/watch?v=soonGame222',
  },
  {
    id: 'liveGame333',
    title: 'Cheetahs Beta vs Knights',
    scheduledStart: '2026-11-26T15:00:00.000Z',
    actualStart: '2026-11-26T15:02:00.000Z',
    actualEnd: null,
    lifeCycle: 'live',
    streamKeyName: 'Yolobox Pro 1',
    watchUrl: 'https://www.youtube.com/watch?v=liveGame333',
  },
  {
    id: 'ended444444',
    title: 'Cheetahs Gamma vs Lions',
    scheduledStart: '2026-11-25T18:00:00.000Z',
    actualStart: '2026-11-25T18:05:00.000Z',
    actualEnd: '2026-11-25T21:00:00.000Z',
    lifeCycle: 'complete',
    streamKeyName: 'Yolobox Pro 3',
    watchUrl: 'https://www.youtube.com/watch?v=ended444444',
  },
]

const CONNECTED: BroadcastConnection = {
  connected: true,
  needsReconnect: false,
  channelId: 'UCcricketcrazeusa',
  channelTitle: 'CricketCrazeUSA',
  connectedAt: '2026-11-22T12:00:00.000Z',
  message: null,
}

export function BroadcastsPreviewPage() {
  const [filter, setFilter] = useState<BroadcastFilter>('upcoming')
  const [connection, setConnection] = useState<BroadcastConnection>(CONNECTED)
  const [inflightId, setInflightId] = useState<string | null>(null)
  const [cardNotes, setCardNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const lock = useRef<string | null>(null)

  function run(action: 'start' | 'end', row: BroadcastRow) {
    if (lock.current) return
    lock.current = row.id
    setInflightId(row.id)
    window.setTimeout(() => {
      const text =
        action === 'start'
          ? `${row.title} would go live on YouTube. This preview does not call YouTube.`
          : `${row.title} would end on YouTube. This preview does not call YouTube.`
      setCardNotes((current) => ({ ...current, [row.id]: { ok: true, text } }))
      setNotice({ ok: true, text })
      lock.current = null
      setInflightId(null)
    }, 400)
  }

  return (
    <>
      <div className="broadcast-preview-switch">
        <button type="button" className="filter-chip" onClick={() => setConnection(CONNECTED)}>
          Connected
        </button>
        <button
          type="button"
          className="filter-chip"
          onClick={() =>
            setConnection({
              connected: true,
              needsReconnect: true,
              channelId: 'UCcricketcrazeusa',
              channelTitle: 'CricketCrazeUSA',
              connectedAt: '2026-11-01T12:00:00.000Z',
              message:
                'The YouTube connection expired or was revoked. An admin needs to reconnect. Google test-mode refresh tokens expire after 7 days unless the consent screen is published to Production.',
            })
          }
        >
          Expired
        </button>
        <button
          type="button"
          className="filter-chip"
          onClick={() =>
            setConnection({
              connected: false,
              needsReconnect: false,
              channelId: null,
              channelTitle: null,
              connectedAt: null,
              message: null,
            })
          }
        >
          Not connected
        </button>
      </div>
      <BroadcastsBoard
        now={NOW}
        isAdmin
        connection={connection}
        rows={ROWS}
        listError={null}
        notice={notice}
        filter={filter}
        onFilter={setFilter}
        inflightId={inflightId}
        cardNotes={cardNotes}
        refreshing={false}
        testing={testing}
        testMessage={testMessage}
        onConnect={() => setNotice({ ok: true, text: 'Connect would open Google. This preview stays on the page.' })}
        onTest={() => {
          setTesting(true)
          setTestMessage(null)
          window.setTimeout(() => {
            setTesting(false)
            setTestMessage('YouTube responded. The test read 4 broadcasts and did not change any.')
          }, 300)
        }}
        onRefresh={() => setNotice({ ok: true, text: 'The list would reload from YouTube.' })}
        onStart={(row) => run('start', row)}
        onEnd={(row) => run('end', row)}
      />
    </>
  )
}
