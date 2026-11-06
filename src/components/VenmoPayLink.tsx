import { formatCents } from '../lib/money.ts'
import { venmoFeatureEnabled, venmoPayUrl, VENMO_PLACEHOLDER } from '../lib/venmo.ts'

export function VenmoPayLink({
  username,
  amountCents,
  note,
}: {
  username: string | null
  amountCents: number
  note: string
}) {
  if (!venmoFeatureEnabled() || !username || username === VENMO_PLACEHOLDER) return null
  const href = venmoPayUrl(username, amountCents, note)
  if (!href) return null
  return (
    <a className="button button-gold" href={href} target="_blank" rel="noopener noreferrer">
      Pay {formatCents(amountCents)} with Venmo
    </a>
  )
}
