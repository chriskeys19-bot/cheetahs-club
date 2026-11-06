import { useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import {
  consumeFreshLogin,
  dismissQuote,
  greetingFirstName,
  localDayKey,
  readQuoteMemory,
  resolveQuoteView,
  shuffleQuote,
  writeQuoteMemory,
  type QuoteView,
} from '../lib/dailyQuote.ts'
import { CLUB_QUOTES } from '../lib/quotes.ts'

function openWelcome(): QuoteView {
  const today = localDayKey(new Date())
  const freshLogin = consumeFreshLogin(sessionStorage)
  const view = resolveQuoteView({
    quotes: CLUB_QUOTES,
    stored: readQuoteMemory(localStorage),
    today,
    freshLogin,
  })
  writeQuoteMemory(localStorage, view.memory)
  return view
}

export function WelcomeQuote() {
  const { session, profile } = useAuth()
  const name = greetingFirstName(profile?.full_name, session?.user.email)
  const [view, setView] = useState(openWelcome)
  const [notice, setNotice] = useState('')

  if (!view.visible) return null

  function onShuffle() {
    const next = shuffleQuote(view.memory, CLUB_QUOTES)
    writeQuoteMemory(localStorage, next.memory)
    setView(next)
    setNotice(`${next.quote.text} — ${next.quote.attribution}`)
  }

  function onClose() {
    const memory = dismissQuote(view.memory)
    writeQuoteMemory(localStorage, memory)
    setView({ ...view, memory, visible: false })
    const heading = document.getElementById('home-heading')
    if (heading instanceof HTMLElement) heading.focus()
  }

  return (
    <section className="welcome-quote" aria-labelledby="welcome-quote-heading">
      <p className="welcome-quote-kicker">A word for the day</p>
      <h2 id="welcome-quote-heading">Hello, {name}</h2>
      <blockquote className="welcome-quote-body">
        <p className="welcome-quote-text">
          <span className="welcome-mark" aria-hidden="true">
            “
          </span>
          {view.quote.text}
        </p>
        <footer className="welcome-quote-by">— {view.quote.attribution}</footer>
      </blockquote>
      <div className="welcome-quote-actions">
        <button type="button" className="welcome-quote-new" onClick={onShuffle}>
          New quote
        </button>
        <button type="button" className="welcome-quote-close" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </section>
  )
}
