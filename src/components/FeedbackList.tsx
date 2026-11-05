import { formatWhen } from '../lib/format.ts'
import { feedbackCategoryLabel, splitFeedbackBody } from '../lib/feedback.ts'
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
    <ol className={showSubmitter ? 'feedback-list inbox' : 'feedback-list'}>
      {rows.map((row) => {
        const parsed = splitFeedbackBody(row.body)
        return (
          <li key={row.id}>
            <article className="feedback-item">
              <header>
                {showSubmitter ? (
                  <p className="feedback-who">
                    <strong>{row.submitter_name ?? 'Member'}</strong>
                    {row.submitter_email ? <span>{row.submitter_email}</span> : null}
                  </p>
                ) : null}
                <p className="feedback-meta">
                  {parsed.category ? <span className="tag">{feedbackCategoryLabel(parsed.category)}</span> : null}
                  <span>{formatWhen(row.created_at)}</span>
                  <span>Filed as {filedAs(row.role)}</span>
                </p>
              </header>
              <p className="feedback-body">{parsed.text}</p>
            </article>
          </li>
        )
      })}
    </ol>
  )
}
