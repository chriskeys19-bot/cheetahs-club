import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { BroadcastsBoard } from '../components/BroadcastsBoard.tsx'
import { canManageClub } from '../lib/types.ts'
import {
  loadYouTubeBroadcasts,
  oauthFlagMessage,
  startYouTubeConnect,
  testYouTubeConnection,
  transitionYouTubeBroadcast,
} from '../lib/youtubeBroadcastsApi.ts'
import type { BroadcastConnection, BroadcastFilter, BroadcastRow } from '../lib/youtubeBroadcasts.ts'

export function BroadcastsPage() {
  const { profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const isAdmin = profile?.role === 'admin'
  const [params] = useSearchParams()
  const [connection, setConnection] = useState<BroadcastConnection | null>(null)
  const [rows, setRows] = useState<BroadcastRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [filter, setFilter] = useState<BroadcastFilter>('upcoming')
  const [inflightId, setInflightId] = useState<string | null>(null)
  const [cardNotes, setCardNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lock = useRef<string | null>(null)
  const youtubeFlag = params.get('youtube')
  const queryNotice = youtubeFlag
    ? {
        ok: youtubeFlag === 'connected',
        text: youtubeFlag === 'connected' ? 'YouTube is connected.' : oauthFlagMessage(params.get('reason'), false),
      }
    : null

  async function reload() {
    setRefreshing(true)
    const loaded = await loadYouTubeBroadcasts()
    setConnection(loaded.connection)
    setRows(loaded.rows)
    setListError(loaded.error)
    setRefreshing(false)
    setNow(Date.now())
  }

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    void loadYouTubeBroadcasts().then((loaded) => {
      if (cancelled) return
      setConnection(loaded.connection)
      setRows(loaded.rows)
      setListError(loaded.error)
    })
    return () => {
      cancelled = true
    }
  }, [staff])

  async function connect() {
    const result = await startYouTubeConnect()
    if ('url' in result) {
      window.location.assign(result.url)
      return
    }
    setListError(result.error)
  }

  async function testConnection() {
    setTesting(true)
    setTestMessage(null)
    const result = await testYouTubeConnection()
    if (result.connection) setConnection(result.connection)
    setTestMessage(result.message)
    setTesting(false)
  }

  async function run(action: 'start' | 'end', row: BroadcastRow) {
    if (lock.current) return
    lock.current = row.id
    setInflightId(row.id)
    const result = await transitionYouTubeBroadcast(action, row.id)
    if (result.connection) setConnection(result.connection)
    setCardNotes((current) => ({ ...current, [row.id]: { ok: result.ok, text: result.message } }))
    setNotice({ ok: result.ok, text: result.message })
    lock.current = null
    setInflightId(null)
    if (result.ok) await reload()
  }

  if (!profileReady) return <p className="empty-copy">Checking your role…</p>
  if (!staff) {
    return (
      <div className="page">
        <header className="page-intro">
          <p className="kicker">YouTube</p>
          <h1>Streams</h1>
        </header>
        <p className="fine-print">Captains and admins manage YouTube broadcasts.</p>
      </div>
    )
  }

  return (
    <BroadcastsBoard
      now={now}
      isAdmin={isAdmin}
      connection={connection}
      rows={rows}
      listError={listError}
      notice={notice ?? queryNotice}
      filter={filter}
      onFilter={setFilter}
      inflightId={inflightId}
      cardNotes={cardNotes}
      refreshing={refreshing}
      testing={testing}
      testMessage={testMessage}
      onConnect={() => void connect()}
      onTest={() => void testConnection()}
      onRefresh={() => void reload()}
      onStart={(row) => void run('start', row)}
      onEnd={(row) => void run('end', row)}
    />
  )
}
