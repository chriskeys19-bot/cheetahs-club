export const MAX_CENTS = 100_000_000

export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null
  return cents
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`
}

export function centsToDollarInput(cents: number): string {
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  if (remainder === 0) return String(dollars)
  return `${dollars}.${String(remainder).padStart(2, '0')}`
}

export function splitCents(total: number, count: number): number[] {
  if (count <= 0 || !Number.isInteger(total) || total <= 0) return []
  const base = Math.floor(total / count)
  const extra = total % count
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0))
}

export function tallyPayments(
  payments: { assessment_id: string; amount: number; claim_status: string }[],
  assessmentId: string,
): { confirmed: number; pending: number } {
  let confirmed = 0
  let pending = 0
  for (const payment of payments) {
    if (payment.assessment_id !== assessmentId) continue
    if (payment.claim_status === 'confirmed') confirmed += payment.amount
    else if (payment.claim_status === 'pending_claim') pending += payment.amount
  }
  return { confirmed, pending }
}

export function amountStillOpen(amount: number, confirmed: number): number {
  return Math.max(0, amount - confirmed)
}

export function amountUnclaimed(amount: number, confirmed: number, pending: number): number {
  return Math.max(0, amount - confirmed - pending)
}
