import { createContext, useContext } from 'react'
import type { GameStream, StreamJob, StreamKey } from '../lib/streamStatus.ts'

export type StreamsValue = {
  ready: boolean
  streams: GameStream[]
  jobs: StreamJob[]
  keys: StreamKey[]
  error: string | null
  reload: () => Promise<void>
}

export const StreamsContext = createContext<StreamsValue | null>(null)

export function useStreams(): StreamsValue {
  const value = useContext(StreamsContext)
  if (!value) throw new Error('useStreams must be used inside StreamsProvider')
  return value
}
