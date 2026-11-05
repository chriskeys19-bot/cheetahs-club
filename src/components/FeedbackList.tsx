import { formatWhen } from '../lib/format.ts'
import { isClubRole, roleLabel, type FeedbackRow } from '../lib/types.ts'

function filedAs(role: string | null): string {
  if (isClubRole(role)) return roleLabel(role)
  return 'Member'
}

export function FeedbackList({
  rows,
  empty,
  showSubmitter,
}: {
  rows: FeedbackRow[]
  empty: string
  showSubmitter: boolean
}) {
  if (rows.length === 0) {
    return <p className="empty-copy">{empty}</p>
  }

  return (
    <ol className="feedback-list">
      {rows.map((row) => (
        <li key={row.id}>
          <article className="feedback-card">
            <header>
              {showSubmitter ? (
                <p className="feedback-who">
                  <strong>{row.submitter_name ?? 'Member'}</strong>
                  {row.submitter_email ? <span>{row.submitter_email}</span> : null}
                </p>
              ) : null}
              <p className="feedback-meta">
                <span>{formatWhen(row.created_at)}</span>
                <span>Filed as {filedAs(row.role)}</span>
              </p>
            </header>
            <p className="feedback-body">{row.body}</p>
          </article>
        </li>
      ))}
    </ol>
  )
}
