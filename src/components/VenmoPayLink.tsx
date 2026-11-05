import { formatCents } from '../lib/money.ts'
import { venmoPayUrl } from '../lib/venmo.ts'

export function VenmoPayLink({
  username,
  amountCents,
  note,
}: {
  username: string
  amountCents: number
  note: string
}) {
  const href = venmoPayUrl(username, amountCents, note)
  if (!href) return null
  return (
    <a className="button button-gold" href={href} target="_blank" rel="noopener noreferrer">
      Pay {formatCents(amountCents)} with Venmo
    </a>
  )
}
