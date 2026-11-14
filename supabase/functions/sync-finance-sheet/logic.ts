import {
  interpretFinanceSheet,
  linkNames,
  type NameMap,
  type ParsedAccount,
  type ParsedCharge,
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
): { accounts: LinkedAccount[]; charges: LinkedCharge[]; unmatched: string[] } {
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
): Record<string, unknown> {
  const linked = linkLedger(accounts, charges, names, roster, maps)
  return {
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
): Record<string, unknown> {
  const names = [...accounts.map((row) => row.sheetName), ...charges.map((row) => row.sheetName)]
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
  return {
    accounts: once(accounts),
    charges: once(charges),
    unmatched_names: linked.unmatched,
  }
}

export function sheetReadBody(secret: string): string {
  return JSON.stringify({ secret, action: 'read' })
}

export { interpretFinanceSheet }
