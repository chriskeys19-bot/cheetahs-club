import { useEffect, useId, useRef, useState } from 'react'
import { parseVideoUrl } from '../lib/games.ts'
import {
  STREAM_STATUSES,
  parseHttpsUrl,
  parseStreamScorecardUrl,
  preferredOverlayUrl,
  streamStatusLabel,
  type GameStream,
  type StreamKey,
  type StreamLive,
  type StreamStatus,
} from '../lib/streamStatus.ts'
import type { StreamTextField } from '../lib/streams.ts'

type FieldKey = StreamTextField | 'scorecard_url'

export function StreamDialog({
  title,
  when,
  stream,
  keys,
  live,
  loading,
  canEditText,
  canEditStatus,
  requestError,
  pending,
  pasteOpen = false,
  onClose,
  onCreate,
  onScorecard,
  onRetry,
  onCheckAgain,
  onPaste,
  onSave,
}: {
  title: string
  when: string
  stream: GameStream | null
  keys: StreamKey[]
  live: StreamLive
  loading: boolean
  canEditText: boolean
  canEditStatus: boolean
  requestError: string | null
  pending: boolean
  pasteOpen?: boolean
  onClose: () => void
  onCreate: (streamKeyName: string) => void
  onScorecard: (url: string) => void
  onRetry: () => void
  onCheckAgain: () => void
  onPaste: (youtubeUrl: string) => void
  onSave: (field: StreamTextField, value: string) => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const keyName = pickedKey && keys.some((key) => key.name === pickedKey) ? pickedKey : (keys[0]?.name ?? '')
  const [scorecard, setScorecard] = useState('')
  const [pasting, setPasting] = useState(pasteOpen)
  const [youtubeDraft, setYoutubeDraft] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      window.setTimeout(() => {
        setCopied((current) => (current === id ? null : current))
      }, 2000)
    } catch {
      setFormError('Copy failed. Select the text and copy it manually.')
    }
  }

  function submitCreate() {
    if (!keyName) {
      setFormError('Choose a stream key.')
      return
    }
    setFormError(null)
    onCreate(keyName)
  }

  function submitScorecard(value: string): string | null {
    const parsed = parseStreamScorecardUrl(value)
    if (parsed === null || parsed === 'invalid') return 'Enter a cricclubs.com scorecard link.'
    setFormError(null)
    onScorecard(parsed)
    return null
  }

  function commitField(field: FieldKey, value: string): string | null {
    if (field === 'scorecard_url') {
      const message = submitScorecard(value)
      setFormError(message)
      return message
    }
    if (field === 'status') {
      if (!STREAM_STATUSES.includes(value as StreamStatus)) {
        const message = 'Choose a setup status.'
        setFormError(message)
        return message
      }
      setFormError(null)
      onSave('status', value)
      return null
    }
    if (field === 'stream_key_name') {
      const name = value.trim()
      if (!keys.some((key) => key.name === name)) {
        const message = 'Choose a stream key from the list.'
        setFormError(message)
        return message
      }
      setFormError(null)
      onSave('stream_key_name', name)
      return null
    }
    if (field === 'whatsapp_message') {
      if (value.trim().length > 2000) {
        const message = 'That WhatsApp message is too long.'
        setFormError(message)
        return message
      }
      setFormError(null)
      onSave('whatsapp_message', value)
      return null
    }
    const parsed = parseHttpsUrl(value)
    if (parsed === 'invalid') {
      const message = 'Enter an https link.'
      setFormError(message)
      return message
    }
    setFormError(null)
    onSave(field, parsed ?? '')
    return null
  }

  const showSetup = !loading && (live.phase === 'create' || live.phase === 'check_failed')
  const showScorecard = !loading && live.phase === 'scorecard'
  const showRetry = !loading && (live.phase === 'failed' || live.phase === 'check_failed')
  const overlayHref = preferredOverlayUrl(stream)
  const fields =
    stream && live.phase !== 'create' && live.phase !== 'checking' && live.phase !== 'check_failed'
      ? visibleFields(stream)
      : []

  function submitPaste() {
    const parsed = parseVideoUrl(youtubeDraft)
    if (parsed === null || parsed === 'invalid') {
      setFormError('Paste a YouTube link (youtube.com or youtu.be).')
      return
    }
    setFormError(null)
    onPaste(parsed.replace(/^http:\/\//i, 'https://'))
  }

  return (
    <div
      className="stream-backdrop"
      onClick={() => {
        if (!pending) onClose()
      }}
    >
      <div
        className="stream-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stream-grab" aria-hidden="true" />
        <div className="stream-sheet-bar">
          <div>
            <p className="kicker">Live stream</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="button button-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="fine-print">{when}</p>
        {overlayHref ? (
          <div className="stream-overlay-panel">
            <p className="stream-field-label">Overlay</p>
            <a href={overlayHref} target="_blank" rel="noreferrer">
              {overlayHref}
            </a>
            <button
              type="button"
              className="button button-gold button-block"
              onClick={() => void copy('overlay-prominent', overlayHref)}
            >
              {copied === 'overlay-prominent' ? 'Copied' : 'Copy overlay'}
            </button>
          </div>
        ) : null}
        {loading ? <p className="empty-copy">Loading the stream…</p> : null}
        {!loading ? (
          <p className={live.busy ? 'stream-status is-busy' : 'stream-status'} role="status" aria-live="polite">
            {live.busy ? <span className="stream-spinner" aria-hidden="true" /> : null}
            <span>{live.label}</span>
          </p>
        ) : null}
        {requestError ? (
          <p className="banner banner-error" role="alert">
            {requestError}
          </p>
        ) : null}
        {formError ? (
          <p className="banner banner-error" role="alert">
            {formError}
          </p>
        ) : null}
        {showRetry ? (
          <button type="button" className="button button-navy" onClick={onRetry} disabled={pending}>
            {pending ? 'Queuing…' : 'Retry'}
          </button>
        ) : null}
        {showSetup ? (
          <div className="form-grid">
            {live.phase === 'check_failed' ? <p>Or create a new stream.</p> : null}
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault()
                submitCreate()
              }}
            >
              <label>
                Stream key
                <select value={keyName} onChange={(event) => setPickedKey(event.target.value)} disabled={pending}>
                  {keys.length === 0 ? <option value="">No keys yet</option> : null}
                  {keys.map((key) => (
                    <option key={key.id} value={key.name}>
                      {key.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="fine-print">The list shows the key name only. The key itself stays on the device.</p>
              <button type="submit" className="button button-gold" disabled={pending || keys.length === 0}>
                {pending ? 'Queuing…' : 'Create stream'}
              </button>
            </form>
            <button type="button" className="text-button" onClick={() => setPasting((open) => !open)}>
              Already have a stream? Paste YouTube link
            </button>
            {pasting ? (
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitPaste()
                }}
              >
                <label>
                  YouTube link
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://youtu.be/…"
                    value={youtubeDraft}
                    onChange={(event) => setYoutubeDraft(event.target.value)}
                    disabled={pending}
                  />
                </label>
                <button type="submit" className="button button-navy" disabled={pending}>
                  {pending ? 'Saving…' : 'Save link'}
                </button>
              </form>
            ) : null}
            {stream?.checked_at ? (
              <button type="button" className="text-button" onClick={onCheckAgain} disabled={pending}>
                Check again
              </button>
            ) : null}
          </div>
        ) : null}
        {showScorecard ? (
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault()
              setFormError(submitScorecard(scorecard))
            }}
          >
            <label>
              CricClubs scorecard
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://cricclubs.com/…"
                value={scorecard}
                onChange={(event) => setScorecard(event.target.value)}
                disabled={pending}
              />
            </label>
            <button type="submit" className="button button-gold" disabled={pending}>
              {pending ? 'Queuing…' : 'Add scorecard'}
            </button>
          </form>
        ) : null}
        {stream?.whatsapp_message ? (
          <button
            type="button"
            className="button button-gold button-block"
            onClick={() => void copy('whatsapp-prominent', stream.whatsapp_message ?? '')}
          >
            {copied === 'whatsapp-prominent' ? 'Copied' : 'Copy WhatsApp message'}
          </button>
        ) : null}
        {fields.length > 0 ? (
          <div className="stream-fields">
            {fields.map((field) => (
              <StreamField
                key={field.key}
                fieldKey={field.key}
                label={field.label}
                value={field.value}
                editValue={field.editValue}
                href={field.href}
                canEdit={field.key === 'status' ? canEditStatus : canEditText}
                keys={keys}
                copied={copied === field.key}
                disabled={pending || live.busy}
                onCopy={() => void copy(field.key, field.value)}
                onSave={(value) => commitField(field.key, value)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function visibleFields(stream: GameStream): Array<{
  key: FieldKey
  label: string
  value: string
  editValue: string
  href: string | null
}> {
  const rows: Array<{ key: FieldKey; label: string; value: string; editValue: string; href: string | null }> = []
  if (stream.stream_key_name) {
    rows.push({
      key: 'stream_key_name',
      label: 'Stream key',
      value: stream.stream_key_name,
      editValue: stream.stream_key_name,
      href: null,
    })
  }
  if (stream.status !== 'none') {
    rows.push({
      key: 'status',
      label: 'Setup status',
      value: streamStatusLabel(stream.status),
      editValue: stream.status,
      href: null,
    })
  }
  if (stream.youtube_url) {
    rows.push({
      key: 'youtube_url',
      label: 'YouTube stream',
      value: stream.youtube_url,
      editValue: stream.youtube_url,
      href: stream.youtube_url,
    })
  }
  if (stream.scorecard_url) {
    rows.push({
      key: 'scorecard_url',
      label: 'Scorecard',
      value: stream.scorecard_url,
      editValue: stream.scorecard_url,
      href: stream.scorecard_url,
    })
  }
  if (stream.overlay_short_url) {
    rows.push({
      key: 'overlay_short_url',
      label: 'Overlay short link',
      value: stream.overlay_short_url,
      editValue: stream.overlay_short_url,
      href: stream.overlay_short_url,
    })
  }
  if (stream.overlay_url) {
    rows.push({
      key: 'overlay_url',
      label: 'Overlay URL',
      value: stream.overlay_url,
      editValue: stream.overlay_url,
      href: stream.overlay_url,
    })
  }
  if (stream.whatsapp_message) {
    rows.push({
      key: 'whatsapp_message',
      label: 'WhatsApp message',
      value: stream.whatsapp_message,
      editValue: stream.whatsapp_message,
      href: null,
    })
  }
  return rows
}

function StreamField({
  fieldKey,
  label,
  value,
  editValue,
  href,
  canEdit,
  keys,
  copied,
  disabled,
  onCopy,
  onSave,
}: {
  fieldKey: FieldKey
  label: string
  value: string
  editValue: string
  href: string | null
  canEdit: boolean
  keys: StreamKey[]
  copied: boolean
  disabled: boolean
  onCopy: () => void
  onSave: (value: string) => string | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(editValue)

  return (
    <div className="stream-field">
      <p className="stream-field-label">{label}</p>
      {editing ? (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            const message = onSave(draft)
            if (message) return
            setEditing(false)
          }}
        >
          {fieldKey === 'status' ? (
            <select value={draft} onChange={(event) => setDraft(event.target.value)}>
              {STREAM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {streamStatusLabel(status)}
                </option>
              ))}
            </select>
          ) : null}
          {fieldKey === 'stream_key_name' ? (
            <select value={draft} onChange={(event) => setDraft(event.target.value)}>
              {keys.some((key) => key.name === draft) ? null : <option value={draft}>{draft}</option>}
              {keys.map((key) => (
                <option key={key.id} value={key.name}>
                  {key.name}
                </option>
              ))}
            </select>
          ) : null}
          {fieldKey === 'whatsapp_message' ? (
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} />
          ) : null}
          {fieldKey !== 'status' && fieldKey !== 'stream_key_name' && fieldKey !== 'whatsapp_message' ? (
            <input type="url" value={draft} onChange={(event) => setDraft(event.target.value)} />
          ) : null}
          <div className="stream-field-actions">
            <button type="submit" className="button button-navy" disabled={disabled}>
              {fieldKey === 'scorecard_url' ? 'Update scorecard' : 'Save'}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setDraft(editValue)
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {value}
            </a>
          ) : (
            <p className={fieldKey === 'whatsapp_message' ? 'stream-message' : 'stream-value'}>{value}</p>
          )}
          <div className="stream-field-actions">
            {fieldKey === 'whatsapp_message' ? null : (
              <button type="button" className="button button-quiet" onClick={onCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            {canEdit ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  setDraft(editValue)
                  setEditing(true)
                }}
                disabled={disabled}
              >
                Edit
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
