import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { formatFixture } from '../lib/format.ts'
import { parseVideoUrl } from '../lib/games.ts'
import { eventTitle, isCheetahsLeagueGame, isCompletedLeagueListing } from '../lib/schedules.ts'
import {
  canEditStreamField,
  latestJobFor,
  liveStreamMessage,
  openJobFor,
  retryAction,
  shouldAutoEnd,
  streamControlVisible,
  type StreamAction,
} from '../lib/streamStatus.ts'
import { requestStreamJob, updateStreamField, type StreamTextField } from '../lib/streams.ts'
import type { ScheduleEvent } from '../lib/types.ts'
import { StreamDialog } from './StreamDialog.tsx'
import { StreamMark } from './streamIcons.tsx'
import { useStreams } from './streams-context.ts'

export function GameStreamControls({
  event,
  teamName,
  teamSlug,
  onVideoReady,
}: {
  event: ScheduleEvent
  teamName: string | null
  teamSlug: string | null
  onVideoReady?: (videoUrl: string | null) => void
}) {
  const { session, profile } = useAuth()
  const board = useStreams()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const autoEnd = useRef(false)
  const cheetahs = isCheetahsLeagueGame(event, teamSlug)
  const completed = isCompletedLeagueListing(event, teamSlug)
  const stream = board.streams.find((row) => row.schedule_event_id === event.id) ?? null
  const openJob = stream ? openJobFor(board.jobs, stream.id) : null
  const latestJob = stream ? latestJobFor(board.jobs, stream.id) : null
  const live = liveStreamMessage(stream, openJob ?? latestJob)
  const showStream = streamControlVisible({
    cheetahsLeague: cheetahs,
    completed,
    status: stream?.status ?? null,
    role: profile?.role,
  })

  async function run(action: StreamAction, extra?: { streamKeyName?: string; scorecardUrl?: string }) {
    setPending(true)
    setRequestError(null)
    const message = await requestStreamJob({
      scheduleEventId: event.id,
      action,
      streamKeyName: extra?.streamKeyName,
      scorecardUrl: extra?.scorecardUrl,
    })
    setPending(false)
    setRequestError(message)
    await board.reload()
  }

  useEffect(() => {
    if (!open) {
      autoEnd.current = false
      return
    }
    if (autoEnd.current || !board.ready) return
    if (!shouldAutoEnd(completed, stream, Boolean(openJob))) return
    autoEnd.current = true
    void run('end')
    // run is recreated each render. The ref makes the end request happen once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board.ready, completed, stream, openJob])

  const reportedVideo = useRef<string | null>(null)
  useEffect(() => {
    if (!onVideoReady || event.video_url) return
    if (!stream || stream.status !== 'ended' || !stream.youtube_url) return
    const parsed = parseVideoUrl(stream.youtube_url)
    if (!parsed || parsed === 'invalid' || reportedVideo.current === parsed) return
    reportedVideo.current = parsed
    onVideoReady(parsed)
  }, [event.video_url, onVideoReady, stream])

  if (!showStream && !open) return null

  const when = formatFixture(event.game_date, event.start_time, event.end_time)
  const title = eventTitle(event, teamName)
  const iconText = live.phase === 'failed' ? 'Setup failed' : live.label
  const iconLabel = live.phase === 'failed' || live.busy ? live.label : `Live stream for ${title}`
  const canEditText = canEditStreamField(profile?.role, session?.user.id, stream?.requested_by, 'text')
  const canEditStatus = canEditStreamField(profile?.role, session?.user.id, stream?.requested_by, 'status')

  async function save(field: StreamTextField, value: string) {
    if (!stream) return
    setPending(true)
    setRequestError(null)
    const message = await updateStreamField(stream.id, field, value, board.keys)
    setPending(false)
    setRequestError(message)
    await board.reload()
  }

  return (
    <>
      {showStream ? (
        <button
          type="button"
          className={
            live.phase === 'failed'
              ? 'stream-icon-button is-failed'
              : live.busy
                ? 'stream-icon-button is-busy'
                : 'stream-icon-button'
          }
          aria-label={iconLabel}
          title={iconLabel}
          onClick={() => {
            setRequestError(null)
            setOpen(true)
          }}
        >
          {live.busy ? <span className="stream-spinner" aria-hidden="true" /> : <StreamMark />}
          {live.busy || live.phase === 'failed' ? <span className="stream-icon-label">{iconText}</span> : null}
        </button>
      ) : null}
      {open ? (
        <StreamDialog
          title={title}
          when={`${when.date} · ${when.time} Pacific`}
          stream={stream}
          keys={board.keys}
          live={board.ready ? live : { phase: 'create', label: 'Loading the stream…', busy: true }}
          loading={!board.ready}
          canEditText={canEditText}
          canEditStatus={canEditStatus}
          requestError={requestError ?? board.error}
          pending={pending}
          onClose={() => setOpen(false)}
          onCreate={(streamKeyName) => void run('create', { streamKeyName })}
          onScorecard={(url) => void run('add_scorecard', { scorecardUrl: url })}
          onRetry={() => {
            if (!stream) return
            void run(retryAction(stream, latestJob), {
              streamKeyName: stream.stream_key_name ?? board.keys[0]?.name,
              scorecardUrl: stream.scorecard_url ?? undefined,
            })
          }}
          onSave={(field, value) => void save(field, value)}
        />
      ) : null}
    </>
  )
}
