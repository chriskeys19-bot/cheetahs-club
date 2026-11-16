import {
  interpretFinanceSheet,
  linkNames,
  type NameMap,
  type ParsedAccount,
  type ParsedCharge,
  type ParsedLedgerRow,
  type RosterPerson,
} from '../../../src/lib/sheetLedger.ts'

export type FinanceSource = 'scheduled' | 'manual'

export type FinanceRequest = {
  rematch: boolean
}

type LinkedAccount = ParsedAccount & { profileId: string | null }
type LinkedCharge = ParsedCharge & { profileId: string | null }

export function readFinanceRequest(body: unknown): FinanceRequest | string {
  if (body == null) return { rematch: false }
  if (typeof body !== 'object' || Array.isArray(body)) return 'Send JSON.'
  const record = body as Record<string, unknown>
  if (record.rematch !== undefined && typeof record.rematch !== 'boolean') return 'rematch must be true or false.'
  return { rematch: record.rematch === true }
}

function profileFor(key: string, linked: Map<string, string>): string | null {
  return linked.get(key) ?? null
}

export function linkLedger(
  accounts: ParsedAccount[],
  charges: ParsedCharge[],
  names: string[],
  roster: RosterPerson[],
  maps: NameMap[],
): { accounts: LinkedAccount[]; charges: LinkedCharge[]; unmatched: string[]; profileIdByKey: Map<string, string> } {
  const pool = names.length > 0 ? names : [...accounts.map((row) => row.sheetName), ...charges.map((row) => row.sheetName)]
  const linked = linkNames(pool, roster, maps)
  return {
    accounts: accounts.map((account) => ({
      ...account,
      profileId: profileFor(account.sheetKey, linked.profileIdByKey),
    })),
    charges: charges.map((charge) => ({
      ...charge,
      profileId: profileFor(charge.sheetKey, linked.profileIdByKey),
    })),
    unmatched: linked.unmatched,
    profileIdByKey: linked.profileIdByKey,
  }
}

export function replacePayload(
  accounts: ParsedAccount[],
  charges: ParsedCharge[],
  names: string[],
  roster: RosterPerson[],
  maps: NameMap[],
  syncedAt: string,
  source: FinanceSource,
  ledger: ParsedLedgerRow[] | null = null,
): Record<string, unknown> {
  const ledgerNames = ledger ? ledger.map((row) => row.sheetName) : []
  const linked = linkLedger(accounts, charges, [...names, ...ledgerNames], roster, maps)
  const payload: Record<string, unknown> = {
    mode: 'replace',
    synced_at: syncedAt,
    sync_source: source,
    unmatched_names: linked.unmatched,
    accounts: linked.accounts.map((account) => ({
      sheet_key: account.sheetKey,
      sheet_name: account.sheetName,
      profile_id: account.profileId,
      club_status: account.clubStatus,
      club_fee_cents: account.clubFeeCents,
      club_fee_status: account.clubFeeStatus,
      umpiring_fee_cents: account.umpiringFeeCents,
      umpiring_status: account.umpiringStatus,
      received_saro_cents: account.receivedSaroCents,
      received_ben_cents: account.receivedBenCents,
      received_total_cents: account.receivedTotalCents,
      game_charges_total_cents: account.gameChargesTotalCents,
      balance_due_cents: account.balanceDueCents,
      payment_notes: account.paymentNotes,
      sheet_credit_cents: account.sheetCreditCents,
      manual_credit_cents: account.manualCreditCents,
    })),
    charges: linked.charges.map((charge) => ({
      sheet_key: charge.sheetKey,
      sheet_name: charge.sheetName,
      profile_id: charge.profileId,
      sheet_row: charge.sheetRow,
      charge_date: charge.chargeDate,
      charge_type: charge.chargeType,
      game_label: charge.gameLabel,
      charge_kind: charge.chargeKind,
      team: charge.team,
      ground: charge.ground,
      amount_cents: charge.amountCents,
      recon_status: charge.reconStatus,
    })),
  }
  if (ledger) {
    payload.ledger = ledger.map((row) => ({
      sheet_key: row.sheetKey,
      sheet_name: row.sheetName,
      profile_id: profileFor(row.sheetKey, linked.profileIdByKey),
      sheet_row: row.sheetRow,
      game_date: row.gameDate,
      team: row.team,
      game_no: row.gameNo,
      ground: row.ground,
      dues_cents: row.duesCents,
      paid_cents: row.paidCents,
      unsettled_cents: row.unsettledCents,
      status: row.status,
      memo: row.memo,
      source: row.source,
    }))
  }
  return payload
}

export type StoredName = {
  sheetKey: string
  sheetName: string
}

export function relinkPayload(
  accounts: StoredName[],
  charges: StoredName[],
  roster: RosterPerson[],
  maps: NameMap[],
  ledger: StoredName[] | null = null,
): Record<string, unknown> {
  const ledgerNames = ledger ? ledger.map((row) => row.sheetName) : []
  const names = [...accounts.map((row) => row.sheetName), ...charges.map((row) => row.sheetName), ...ledgerNames]
  const linked = linkNames(names, roster, maps)
  const once = (rows: StoredName[]) => {
    const seen = new Set<string>()
    const links: { sheet_key: string; profile_id: string | null }[] = []
    for (const row of rows) {
      if (seen.has(row.sheetKey)) continue
      seen.add(row.sheetKey)
      links.push({
        sheet_key: row.sheetKey,
        profile_id: linked.profileIdByKey.get(row.sheetKey) ?? null,
      })
    }
    return links
  }
  const payload: Record<string, unknown> = {
    accounts: once(accounts),
    charges: once(charges),
    unmatched_names: linked.unmatched,
  }
  if (ledger) payload.ledger = once(ledger)
  return payload
}

export function sheetReadBody(secret: string): string {
  return JSON.stringify({ secret, action: 'read' })
}

export { interpretFinanceSheet }
