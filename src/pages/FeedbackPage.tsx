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
        <p className="kicker">App</p>
        <h1>Feedback</h1>
        <p className="lede">Feature request / feedback on the app.</p>
      </header>
      <section className="panel feedback-desk">
        <FeedbackComposer onSubmitted={refresh} />
        <div className="feedback-history" aria-labelledby="history-heading">
          <h2 id="history-heading">Your requests</h2>
          {rows === null && !error ? <p className="empty-copy">Loading feedback…</p> : null}
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
          {rows && !error ? <FeedbackList rows={rows} empty="No feedback yet." showSubmitter={false} /> : null}
        </div>
      </section>
    </div>
  )
}
