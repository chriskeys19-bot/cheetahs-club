import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  loadStreamBoard,
  parseGameStream,
  parseStreamJob,
  removeById,
  upsertById,
} from '../lib/streams.ts'
import { supabase } from '../lib/supabase.ts'
import { streamNeedsLiveRefresh, type GameStream, type StreamJob, type StreamKey } from '../lib/streamStatus.ts'
import { StreamsContext } from './streams-context.ts'

export function StreamsProvider({ children }: { children: ReactNode }) {
  const [streams, setStreams] = useState<GameStream[]>([])
  const [jobs, setJobs] = useState<StreamJob[]>([])
  const [keys, setKeys] = useState<StreamKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    const next = await loadStreamBoard()
    setStreams(next.streams)
    setJobs(next.jobs)
    setKeys(next.keys)
    setError(next.error)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!streamNeedsLiveRefresh(streams, jobs)) return
    const timer = window.setInterval(() => {
      void reload()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [streams, jobs, reload])

  useEffect(() => {
    let cancelled = false
    loadStreamBoard().then((next) => {
      if (cancelled) return
      setStreams(next.streams)
      setJobs(next.jobs)
      setKeys(next.keys)
      setError(next.error)
      setReady(true)
    })
    if (!supabase) return () => {
      cancelled = true
    }

    const channel = supabase
      .channel('game-streams')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_streams' }, (payload) => {
        const eventType = payload.eventType
        if (eventType === 'DELETE') {
          const id = payload.old && typeof payload.old === 'object' && 'id' in payload.old ? String(payload.old.id) : ''
          if (id) setStreams((current) => removeById(current, id))
          return
        }
        const parsed = parseGameStream(payload.new)
        if (parsed) setStreams((current) => upsertById(current, parsed))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stream_jobs' }, (payload) => {
        const eventType = payload.eventType
        if (eventType === 'DELETE') {
          const id = payload.old && typeof payload.old === 'object' && 'id' in payload.old ? String(payload.old.id) : ''
          if (id) setJobs((current) => removeById(current, id))
          return
        }
        const parsed = parseStreamJob(payload.new)
        if (parsed) setJobs((current) => upsertById(current, parsed))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void reload()
      })

    return () => {
      cancelled = true
      void supabase?.removeChannel(channel)
    }
  }, [reload])

  const value = useMemo(
    () => ({ ready, streams, jobs, keys, error, reload }),
    [ready, streams, jobs, keys, error, reload],
  )

  return <StreamsContext.Provider value={value}>{children}</StreamsContext.Provider>
}
