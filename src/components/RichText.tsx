import DOMPurify from 'dompurify'
import { isRichHtml } from '../lib/richText.ts'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'ul', 'ol', 'li', 'h2', 'span']

function sanitize(value: string): string {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['data-size'],
  })
  return clean.replace(/data-size="(?!small"|large")[^"]*"/g, '')
}

export function RichText({
  value,
  className,
  as = 'p',
}: {
  value: string
  className?: string
  as?: 'p' | 'h3'
}) {
  if (!isRichHtml(value)) {
    if (as === 'h3') return <h3 className={className}>{value}</h3>
    const plainClass = className ? `feedback-body ${className}` : 'feedback-body'
    return <p className={plainClass}>{value}</p>
  }
  const richClass = ['rich-text', as === 'h3' ? 'rich-title' : '', className].filter(Boolean).join(' ')
  return (
    <div
      className={richClass}
      role={as === 'h3' ? 'heading' : undefined}
      aria-level={as === 'h3' ? 3 : undefined}
      dangerouslySetInnerHTML={{ __html: sanitize(value) }}
    />
  )
}
