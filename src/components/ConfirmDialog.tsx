import { useEffect, useId, useRef } from 'react'

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  extra,
  busy,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  extra?: { label: string; onClick: () => void }
  busy?: boolean
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(onCancel)

  useEffect(() => {
    cancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    dialogRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="confirm-backdrop"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {extra ? (
            <button type="button" className="button button-quiet" onClick={extra.onClick} disabled={busy}>
              {extra.label}
            </button>
          ) : null}
          <button type="button" className="button button-navy" onClick={onConfirm} disabled={busy}>
            {busy ? 'Removing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
