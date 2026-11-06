/** Case-insensitive substring match. An empty query matches everything. */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = fields
    .filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => Array<string | null | undefined>,
): T[] {
  return items.filter((item) => matchesQuery(query, fields(item)))
}
