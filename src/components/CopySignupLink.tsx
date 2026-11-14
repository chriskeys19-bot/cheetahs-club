import { useState } from 'react'
import { signupLink } from '../lib/access.ts'

export function CopySignupLink({ prominent = false }: { prominent?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const url = signupLink()

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select the link' : 'Copy sign-up link'

  if (!prominent) {
    return (
      <button type="button" className="nav-copy" onClick={() => void onCopy()}>
        {label}
      </button>
    )
  }

  return (
    <div className="join-link">
      <label className="sr-only" htmlFor="public-signup-url">
        Public sign-up link
      </label>
      <input id="public-signup-url" readOnly value={url} spellCheck={false} />
      <button type="button" className="button button-gold" onClick={() => void onCopy()}>
        {label}
      </button>
    </div>
  )
}
