import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { formatFixture } from '../lib/format.ts'
import { isLeagueCompleted, parseVideoUrl } from '../lib/games.ts'
import { eventTitle, isCheetahsLeagueGame, isCompletedLeagueListing, saveGameVideo } from '../lib/schedules.ts'
import {
  CHECKING_LABEL,
  canEditStreamField,
  canManuallyEndStream,
  failedStreamChipHidden,
  latestJobFor,
  liveStreamMessage,
  openJobFor,
  overlayUrlFromScorecard,
  retryAction,
  shouldAutoCheck,
  shouldAutoEnd,
  streamControlVisible,
  streamWithEarlyOverlay,
  type StreamAction,
  type StreamLive,
} from '../lib/streamStatus.ts'
import { linkExistingStream, requestStreamJob, updateStreamField, type StreamTextField } from '../lib/streams.ts'
import { canManageClub, isClubRole, type ScheduleEvent } from '../lib/types.ts'
import { StreamDialog } from './StreamDialog.tsx'
import { StreamMark } from './streamIcons.tsx'
import { useStreams } from './streams-context.ts'

export function GameStreamControls({
  event,
  teamName,
  teamSlug,
  onVideoReady,
  startOpen = false,
}: {
  event: ScheduleEvent
  teamName: string | null
  teamSlug: string | null
  onVideoReady?: (videoUrl: string | null) => void
  startOpen?: boolean
}) {
  const { session, profile, accountProfile } = useAuth()
  const board = useStreams()
  const [open, setOpen] = useState(startOpen)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const autoEnd = useRef(false)
  const autoCheck = useRef(false)
  const [forcingCheck, setForcingCheck] = useState(false)
  const [earlyOverlay, setEarlyOverlay] = useState<string | null>(null)
  const cheetahs = isCheetahsLeagueGame(event, teamSlug)
  const completed = isCompletedLeagueListing(event, teamSlug)
  const stream = board.streams.find((row) => row.schedule_event_id === event.id) ?? null
  const shownStream = streamWithEarlyOverlay(stream, earlyOverlay)
  const openJob = stream ? openJobFor(board.jobs, stream.id) : null
  const latestJob = stream ? latestJobFor(board.jobs, stream.id) : null
  const live = liveStreamMessage(shownStream, openJob ?? latestJob)
  const staff = isClubRole(profile?.role) && canManageClub(profile?.role)
  const matchOver = isLeagueCompleted(event, Date.now()) || event.result !== null
  const canEditVideo = staff && matchOver
  const staleFailure = failedStreamChipHidden({
    status: stream?.status ?? null,
    completed,
    gameDate: event.game_date,
    asOf: Date.now(),
  })

  useEffect(() => {
    if (!earlyOverlay || !stream) return
    if (streamWithEarlyOverlay(stream, earlyOverlay) === stream) setEarlyOverlay(null)
  }, [earlyOverlay, stream])
  const showStream =
    streamControlVisible({
      cheetahsLeague: cheetahs,
      completed,
      status: stream?.status ?? null,
      role: profile?.role,
    }) && !(staleFailure && !staff)

  async function saveMatchVideo(url: string | null) {
    setPending(true)
    setRequestError(null)
    const message = await saveGameVideo(event.id, url)
    setPending(false)
    setRequestError(message)
    if (!message) onVideoReady?.(url)
  }

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
    return message
  }

  useEffect(() => {
    if (!open) {
      autoEnd.current = false
      autoCheck.current = false
      return
    }
    if (!board.ready) return
    if (!autoCheck.current && shouldAutoCheck(stream, Boolean(openJob), Date.now())) {
      autoCheck.current = true
      setForcingCheck(true)
      void run('check').finally(() => setForcingCheck(false))
      return
    }
    if (autoEnd.current) return
    if (!shouldAutoEnd(completed, stream, Boolean(openJob))) return
    autoEnd.current = true
    void run('end')
    // run is recreated each render. The refs make each automatic job happen once per open.
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

  const displayLive =
    forcingCheck && live.phase === 'create' ? { phase: 'checking' as const, label: CHECKING_LABEL, busy: true } : live

  if (!showStream && !open) return null

  const when = formatFixture(event.game_date, event.start_time, event.end_time)
  const title = eventTitle(event, teamName)
  const cardLive: StreamLive = staleFailure ? { phase: 'ready', label: `Live stream for ${title}`, busy: false } : displayLive
  const canEditText = canEditStreamField(profile?.role, session?.user.id, stream?.requested_by, 'text')
  const canEditStatus = canEditStreamField(profile?.role, session?.user.id, stream?.requested_by, 'status')
  // End follows the saved profile role. "View as" only changes profile.role, and the
  // database still treats that account as admin or captain.
  const canEndStream = canManuallyEndStream(accountProfile?.role ?? profile?.role, shownStream, Boolean(openJob))

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
        <StreamCardControl
          live={cardLive}
          title={title}
          onOpen={() => {
            setRequestError(null)
            if (board.ready && shouldAutoCheck(stream, Boolean(openJob), Date.now())) setForcingCheck(true)
            setOpen(true)
          }}
        />
      ) : null}
      {open ? (
        <StreamDialog
          title={title}
          when={`${when.date} · ${when.time} Pacific`}
          stream={shownStream}
          keys={board.keys}
          live={board.ready ? displayLive : { phase: 'checking', label: 'Loading the stream…', busy: true }}
          loading={!board.ready}
          canEditText={canEditText}
          canEditStatus={canEditStatus}
          canEndStream={canEndStream}
          videoUrl={event.video_url}
          canEditVideo={canEditVideo}
          onSaveVideo={(url) => void saveMatchVideo(url)}
          requestError={requestError ?? board.error}
          pending={pending}
          onClose={() => setOpen(false)}
          onCreate={(streamKeyName) => void run('create', { streamKeyName })}
          onScorecard={(url) => {
            const overlay = overlayUrlFromScorecard(url)
            if (overlay) setEarlyOverlay(overlay)
            void run('add_scorecard', { scorecardUrl: url }).then((message) => {
              if (message) setEarlyOverlay(null)
            })
          }}
          onRetry={() => {
            if (!stream) {
              void run('check')
              return
            }
            const action = retryAction(stream, latestJob)
            if (action === 'check') {
              setForcingCheck(true)
              void run('check').finally(() => setForcingCheck(false))
              return
            }
            void run(action, {
              streamKeyName: stream.stream_key_name ?? board.keys[0]?.name,
              scorecardUrl: stream.scorecard_url ?? undefined,
            })
          }}
          onCheckAgain={() => {
            setForcingCheck(true)
            void run('check').finally(() => setForcingCheck(false))
          }}
          onPaste={(youtubeUrl) => {
            setPending(true)
            setRequestError(null)
            void linkExistingStream(event.id, youtubeUrl).then(async (message) => {
              setPending(false)
              setRequestError(message)
              await board.reload()
            })
          }}
          onSave={(field, value) => void save(field, value)}
          onEnd={() => void run('end')}
        />
      ) : null}
    </>
  )
}

export function StreamCardControl({
  live,
  title,
  onOpen,
}: {
  live: StreamLive
  title: string
  onOpen: () => void
}) {
  const iconText =
    live.phase === 'failed' || live.phase === 'check_failed'
      ? 'Setup failed'
      : live.phase === 'checking'
        ? 'Checking…'
        : live.label
  const iconLabel =
    live.phase === 'failed' || live.phase === 'check_failed' || live.busy
      ? live.label
      : `Live stream for ${title}`
  return (
    <div className="stream-card-controls">
      <button
        type="button"
        className={
          live.phase === 'failed' || live.phase === 'check_failed'
            ? 'stream-icon-button is-failed'
            : live.busy
              ? 'stream-icon-button is-busy'
              : 'stream-icon-button'
        }
        aria-label={iconLabel}
        title={iconLabel}
        onClick={onOpen}
      >
        {live.busy ? <span className="stream-spinner" aria-hidden="true" /> : <StreamMark />}
        {live.busy || live.phase === 'failed' || live.phase === 'check_failed' ? (
          <span className="stream-icon-label">{iconText}</span>
        ) : null}
      </button>
    </div>
  )
}
