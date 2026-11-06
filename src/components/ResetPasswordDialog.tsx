import { useEffect, useId, useRef, useState } from 'react'
import { requestPasswordReset } from '../lib/passwordReset.ts'

export type ResetMember = {
  id: string
  name: string
  email: string
}

type Toast = {
  tone: 'success' | 'error'
  message: string
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function ResetPasswordDialog({
  member,
  onClose,
  onToast,
}: {
  member: ResetMember
  onClose: () => void
  onToast: (toast: Toast) => void
}) {
  const titleId = useId()
  const linkId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [link, setLink] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<'email' | 'copy' | null>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (busy) return
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function onSend() {
    if (busy) return
    setBusy('email')
    setNote(null)
    const result = await requestPasswordReset({ userId: member.id, sendEmail: true })
    setBusy(null)
    if (result.link) setLink(result.link)
    if (result.error) {
      setNote(result.error)
      onToast({ tone: 'error', message: result.error })
      return
    }
    onToast({ tone: 'success', message: `Reset email sent to ${member.email}.` })
    onClose()
  }

  async function onCopy() {
    if (busy) return
    setBusy('copy')
    setNote(null)
    let next = link
    if (!next) {
      const result = await requestPasswordReset({ userId: member.id, sendEmail: false })
      if (result.error || !result.link) {
        const message = result.error ?? 'The reset link could not be created. Try again.'
        setBusy(null)
        setNote(message)
        onToast({ tone: 'error', message })
        return
      }
      next = result.link
      setLink(next)
    }
    const copied = await copyText(next)
    setBusy(null)
    if (!copied) {
      const message = 'Select the reset link and copy it from there.'
      setNote(message)
      onToast({ tone: 'error', message })
      return
    }
    onToast({ tone: 'success', message: `Reset link copied. Send it to ${member.name} on WhatsApp.` })
    onClose()
  }

  return (
    <div
      className="reset-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <p className="kicker">Admin</p>
        <h2 id={titleId}>Reset password</h2>
        <p>
          Create a recovery link for {member.name} ({member.email}). Their password stays the same until they open
          the link and choose a new one.
        </p>
        <p className="fine-print">
          Send the link to the member. Opening it in this browser signs this browser in as them.
        </p>
        {link ? (
          <div className="join-link">
            <label htmlFor={linkId}>Reset link</label>
            <input id={linkId} readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
        {note ? (
          <p className="banner banner-error" role="alert">
            {note}
          </p>
        ) : null}
        <div className="reset-actions">
          <button type="button" className="button button-gold" onClick={() => void onSend()} disabled={busy !== null}>
            {busy === 'email' ? 'Sending…' : 'Send reset email'}
          </button>
          <button type="button" className="button-quiet" onClick={() => void onCopy()} disabled={busy !== null}>
            {busy === 'copy' ? 'Copying…' : 'Copy reset link'}
          </button>
          <button type="button" className="button-quiet reset-cancel" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
