import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { FeedbackList } from '../components/FeedbackList.tsx'
import { loadFeedback } from '../lib/feedback.ts'
import type { FeedbackRow } from '../lib/types.ts'

export function AdminPage() {
  const { profile, profileReady, profileError } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    loadFeedback(50).then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  return (
    <div className="page narrow">
      <header className="page-intro">
        <p className="kicker">Club office</p>
        <h1>Admin</h1>
        <p className="lede">
          Announcements, activities, schedules, and polls live on their own boards. This desk still
          holds every suggestion for admins.
        </p>
      </header>
      <section className="panel">
        {!profileReady ? <p className="empty-copy">Checking your role…</p> : null}
        {profileError ? (
          <p className="banner banner-error" role="alert">
            {profileError}
          </p>
        ) : null}
        {profileReady && !isAdmin ? (
          <div>
            <p className="lede">
              Captains and players send notes from Feedback. Reading every suggestion is reserved
              for admins.
            </p>
            <p className="fine-print">
              <Link to="/feedback">Go to the suggestion box</Link>
            </p>
          </div>
        ) : null}
        {isAdmin ? (
          <div>
            <div className="section-heading">
              <p className="kicker">Inbox</p>
              <h2>All suggestions</h2>
            </div>
            <p className="lede">You can read every note the club has stored.</p>
            {rows === null && !error ? <p className="empty-copy">Loading suggestions…</p> : null}
            {error ? (
              <p className="banner banner-error" role="alert">
                {error}
              </p>
            ) : null}
            {rows && !error ? (
              <FeedbackList rows={rows} empty="No suggestions yet." showSubmitter />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
