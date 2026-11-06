const RICH_HTML = /^<(p|h2|ul|ol)\b/i

/** Saved rich text from the editor starts with a block tag. Older notes are plain text. */
export function isRichHtml(value: string): boolean {
  return RICH_HTML.test(value.trim())
}

/** Visible characters, close to what the editor counts. Used for the same limits as plain notes. */
export function visibleText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || !isRichHtml(trimmed)) return trimmed
  const withoutTags = trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return withoutTags.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function visibleTextLength(value: string): number {
  return visibleText(value).length
}

/** Load a stored note into the editor without turning untouched plain text into HTML. */
export function toEditorHtml(value: string): string {
  if (!value.trim()) return ''
  if (isRichHtml(value)) return value
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`
}
