import { useEffect, useState } from 'react'
import { FeedbackComposer } from '../components/FeedbackComposer.tsx'
import { FeedbackList } from '../components/FeedbackList.tsx'
import { loadFeedback } from '../lib/feedback.ts'
import type { FeedbackRow } from '../lib/types.ts'

export function FeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadFeedback(50).then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  function refresh() {
    setRows(null)
    setError(null)
    setToken((value) => value + 1)
  }

  return (
    <div className="page narrow">
      <header className="page-intro">
        <p className="kicker">Every role</p>
        <h1>Feedback</h1>
        <p className="lede">
          Send a suggestion to the club. It is saved in Supabase, and you can read the ones you
          have already sent.
        </p>
      </header>
      <FeedbackComposer onSubmitted={refresh} />
      <section className="panel recent" aria-labelledby="history-heading">
        <div className="section-heading">
          <p className="kicker">History</p>
          <h2 id="history-heading">Your suggestions</h2>
        </div>
        {rows === null && !error ? <p className="empty-copy">Loading suggestions…</p> : null}
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {rows && !error ? (
          <FeedbackList
            rows={rows}
            empty="Nothing in the box yet. The first note sets the tone."
            showSubmitter={false}
          />
        ) : null}
      </section>
    </div>
  )
}
