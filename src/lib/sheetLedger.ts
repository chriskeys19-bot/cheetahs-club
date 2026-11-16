// Winter club dues from the Google Sheet "Cheetah CC Finance_2026".
// The edge function sync-finance-sheet imports this file. Keep it free of
// browser and Deno APIs.
//
// Paid / Unpaid on each line follows recorded payments (column K): membership,
// then the umpiring fee, then game charges oldest first. A line is Paid only
// when that pool covers it. A blank sheet status stays Unpaid. The headline
// balance is column M (negative means the player owes the club).

import { formatCents } from './money.ts'

export const DEFAULT_ZELLE_EMAIL = 'treasurercheetahscricket@gmail.com'
export const DEFAULT_REMINDER_MMDD = '1114'
export const MEMO_PREFIX = 'CHW26'
export const HELPER_SPLIT_ROW = 510
export const MAX_SHEET_CENTS = 100_000_000

export const DUES_NAME_COL = 1
export const DUES_STATUS_COL = 2
export const DUES_FEE_COL = 3
export const DUES_FEE_STATUS_COL = 4
export const DUES_UMPIRING_COL = 6
export const DUES_UMPIRING_STATUS_COL = 7
export const DUES_SARO_COL = 8
export const DUES_BEN_COL = 9
export const DUES_RECEIVED_COL = 10
export const DUES_GAMES_COL = 11
export const DUES_BALANCE_COL = 12
export const DUES_NOTES_COL = 13
/** Club Dues column O. Automatic credit, including a credit that still shows when column M is negative. */
export const DUES_CREDIT_COL = 14
/** Club Dues column P. Manual credit added to column O. */
export const DUES_MANUAL_CREDIT_COL = 15

export const LEDGER_DATE_COL = 0
export const LEDGER_TEAM_COL = 1
export const LEDGER_GAME_COL = 2
export const LEDGER_GROUND_COL = 3
export const LEDGER_PLAYER_COL = 4
export const LEDGER_DUES_COL = 5
export const LEDGER_PAID_COL = 6
export const LEDGER_UNSETTLED_COL = 7
export const LEDGER_STATUS_COL = 8
export const LEDGER_MEMO_COL = 9
export const LEDGER_SOURCE_COL = 10

export const LEDGER_EXPENSE_LABEL = 'Game dues'

export const SPLIT_DATE_COL = 0
export const SPLIT_TYPE_COL = 1
export const SPLIT_TEAM_COL = 2
export const SPLIT_GROUND_COL = 3
export const SPLIT_NAME_START = 7
export const SPLIT_NAME_END = 44
export const SPLIT_RECON_COL = 47

const HEADER_NAMES = new Set([
  'name',
  'player',
  'player name',
  'member',
  'member name',
  'full name',
  'club status',
  'total',
  'amount',
])

/** Sheet spelling, after trim, rewritten before name scoring. */
export const BUILTIN_ALIASES: Record<string, string> = {
  anamol: 'anmol',
  anirdh: 'anirudh',
  chris: 'christopher selvaraj',
  saro: 'saravanan manickavasagam',
  sankar: 'shankar',
  'sai saketh': 'sai',
  nalan: 'nalan karuppaiah',
  anuk: 'anuj',
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export type ChargeKind = 'dues' | 'water' | 'umpire' | 'other'
export type LineStatus = 'Paid' | 'Unpaid'
export type LedgerState = 'absent' | 'empty' | 'paid' | 'owed'
export type LedgerRowStatus = 'Paid' | 'Partial' | 'Open'

export type RosterPerson = {
  id: string
  fullName: string | null
}

export type NameMap = {
  sheetKey: string
  profileId: string
}

export type ParsedAccount = {
  sheetKey: string
  sheetName: string
  clubStatus: string | null
  clubFeeCents: number
  clubFeeStatus: string | null
  umpiringFeeCents: number
  umpiringStatus: string | null
  receivedSaroCents: number
  receivedBenCents: number
  receivedTotalCents: number
  gameChargesTotalCents: number | null
  balanceDueCents: number | null
  paymentNotes: string | null
  /** Club Dues column O, in cents. Zero when the cell is blank. */
  sheetCreditCents: number
  /** Club Dues column P, in cents. Zero when the cell is blank. */
  manualCreditCents: number
}

export type ParsedLedgerRow = {
  sheetKey: string
  sheetName: string
  sheetRow: number
  gameDate: string | null
  team: string | null
  gameNo: number | null
  ground: string | null
  duesCents: number
  paidCents: number
  unsettledCents: number
  status: LedgerRowStatus
  memo: string | null
  source: string | null
}

/** One game-dues row on My dues. Payment status uses paidCents and unsettledCents as stored. */
export type LedgerExpense = {
  key: string
  sheetRow: number
  gameDate: string | null
  team: string | null
  gameNo: number | null
  ground: string | null
  duesCents: number
  paidCents: number
  unsettledCents: number
  memo: string | null
}

export type ParsedCharge = {
  sheetKey: string
  sheetName: string
  sheetRow: number
  chargeDate: string | null
  chargeType: string
  gameLabel: string | null
  chargeKind: ChargeKind
  team: string | null
  ground: string | null
  amountCents: number
  reconStatus: string | null
}

export type SheetAccount = ParsedAccount & {
  id: string
  profileId: string | null
}

export type SheetCharge = ParsedCharge & {
  id: string
  profileId: string | null
}

export type LedgerLine = {
  key: string
  kind: 'membership' | 'umpiring' | 'game'
  title: string
  amountCents: number
  appliedCents: number
  status: LineStatus
  sheetRow: number | null
  gameLabel: string | null
  chargeDate: string | null
  team: string | null
  ground: string | null
}

export type ChargeGroup = {
  key: string
  gameLabel: string | null
  chargeDate: string | null
  team: string | null
  ground: string | null
  lines: LedgerLine[]
}

export type PaymentTone = 'paid' | 'pending' | 'neutral'

export type DuesPaymentStanding = {
  sheetKey: string
  sheetName: string
  label: string | null
  detail: string | null
  tone: PaymentTone
  balanceLine: string | null
  notes: string | null
}

export type PlayerLedger = {
  state: LedgerState
  totalPaidCents: number
  totalUnpaidCents: number
  balanceDueCents: number
  owedCents: number
  creditCents: number
  lines: LedgerLine[]
  groups: ChargeGroup[]
  paymentNotes: string | null
  clubStatus: string | null
  standings: DuesPaymentStanding[]
  /** Column O plus column P across the dues-tab rows. Omit on the page when this is not positive. */
  combinedCreditCents: number
  /** Line remainder minus the sheet's unpaid amount. Zero when they agree. */
  gapCents: number
}

export type DuesStatusLine = {
  badge: string | null
  tone: PaymentTone
  remainingLabel: string | null
  creditLabel: string | null
  text: string
}

export function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function sheetText(value: unknown, max = 200): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function parseSheetMoney(value: unknown): number | null {
  if (typeof value === 'number') return finiteCents(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /^(?:[-–—]|n\/a|na|#n\/a|#ref!|#value!|#div\/0!)$/i.test(trimmed)) return null
  const negative = trimmed.startsWith('-') || /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[$,\s]/g, '').replace(/^\(/, '').replace(/\)$/, '').replace(/^-/, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const cents = finiteCents(Number(cleaned))
  if (cents == null) return null
  return negative ? -cents : cents
}

function finiteCents(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_SHEET_CENTS) return null
  return cents
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function sheetSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null
  const utc = new Date(Math.round((serial - 25569) * 86400 * 1000))
  if (Number.isNaN(utc.getTime())) return null
  return isoDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

export function parseSheetDate(value: unknown): string | null {
  if (typeof value === 'number') return sheetSerialToIso(value)
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text)
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return isoDate(year, Number(match[1]), Number(match[2]))
  }
  match = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text)
  if (match) {
    const month = MONTHS[match[1].toLowerCase()]
    if (!month) return null
    return isoDate(Number(match[3]), month, Number(match[2]))
  }
  match = /^(\d{1,2})[-\s]([A-Za-z]+)[-\s](\d{4})$/.exec(text)
  if (match) {
    const month = MONTHS[match[2].toLowerCase()]
    if (!month) return null
    return isoDate(Number(match[3]), month, Number(match[1]))
  }
  return null
}

export function describeCharge(type: string): { gameLabel: string | null; chargeKind: ChargeKind; title: string } {
  const cleaned = type.replace(/\s+/g, ' ').trim()
  const game = /game\s*#?\s*(\d+)/i.exec(cleaned)
  const gameLabel = game ? `Game #${Number(game[1])}` : null
  const lower = cleaned.toLowerCase()
  if (/\bwaters?\b/.test(lower)) return { gameLabel, chargeKind: 'water', title: 'Water' }
  if (/\bumpir/.test(lower)) return { gameLabel, chargeKind: 'umpire', title: 'Umpire share' }
  if (/\bdues?\b|\bfees?\b/.test(lower) || gameLabel) return { gameLabel, chargeKind: 'dues', title: 'Game dues' }
  return { gameLabel, chargeKind: 'other', title: cleaned.slice(0, 80) || 'Game charge' }
}

function cell(row: unknown, index: number): unknown {
  if (!Array.isArray(row) || index < 0 || index >= row.length) return null
  return row[index]
}

function isHeaderName(name: string): boolean {
  return HEADER_NAMES.has(normalizeName(name))
}

/** A zeroed Club Dues row kept so later rows do not shift, e.g. "Srihari (merged – see row 13)". */
function isMergedSheetName(name: string): boolean {
  return name.toLowerCase().includes('(merged')
}

function isTotalLabel(value: string | null): boolean {
  if (!value) return false
  return /^(total|totals|grand total|helper|sum|subtotal)\b/i.test(value.trim())
}

export function parseDuesGrid(values: unknown[][], startRow = 1): ParsedAccount[] {
  if (!Number.isInteger(startRow) || startRow < 1) return []
  const byKey = new Map<string, ParsedAccount>()
  values.forEach((row) => {
    const sheetName = sheetText(cell(row, DUES_NAME_COL), 120)
    if (!sheetName || isHeaderName(sheetName) || isMergedSheetName(sheetName)) return
    const sheetKey = normalizeName(sheetName)
    if (!sheetKey) return
    const next: ParsedAccount = {
      sheetKey,
      sheetName,
      clubStatus: sheetText(cell(row, DUES_STATUS_COL), 80),
      clubFeeCents: parseSheetMoney(cell(row, DUES_FEE_COL)) ?? 0,
      clubFeeStatus: sheetText(cell(row, DUES_FEE_STATUS_COL), 40),
      umpiringFeeCents: parseSheetMoney(cell(row, DUES_UMPIRING_COL)) ?? 0,
      umpiringStatus: sheetText(cell(row, DUES_UMPIRING_STATUS_COL), 40),
      receivedSaroCents: parseSheetMoney(cell(row, DUES_SARO_COL)) ?? 0,
      receivedBenCents: parseSheetMoney(cell(row, DUES_BEN_COL)) ?? 0,
      receivedTotalCents: parseSheetMoney(cell(row, DUES_RECEIVED_COL)) ?? 0,
      gameChargesTotalCents: parseSheetMoney(cell(row, DUES_GAMES_COL)),
      balanceDueCents: parseSheetMoney(cell(row, DUES_BALANCE_COL)),
      paymentNotes: sheetText(cell(row, DUES_NOTES_COL), 500),
      sheetCreditCents: parseSheetMoney(cell(row, DUES_CREDIT_COL)) ?? 0,
      manualCreditCents: parseSheetMoney(cell(row, DUES_MANUAL_CREDIT_COL)) ?? 0,
    }
    const prev = byKey.get(sheetKey)
    if (!prev) {
      byKey.set(sheetKey, next)
      return
    }
    byKey.set(sheetKey, {
      ...prev,
      clubStatus: prev.clubStatus ?? next.clubStatus,
      clubFeeCents: prev.clubFeeCents + next.clubFeeCents,
      clubFeeStatus: prev.clubFeeStatus ?? next.clubFeeStatus,
      umpiringFeeCents: prev.umpiringFeeCents + next.umpiringFeeCents,
      umpiringStatus: prev.umpiringStatus ?? next.umpiringStatus,
      receivedSaroCents: prev.receivedSaroCents + next.receivedSaroCents,
      receivedBenCents: prev.receivedBenCents + next.receivedBenCents,
      receivedTotalCents: prev.receivedTotalCents + next.receivedTotalCents,
      gameChargesTotalCents: sumNullable(prev.gameChargesTotalCents, next.gameChargesTotalCents),
      balanceDueCents: sumNullable(prev.balanceDueCents, next.balanceDueCents),
      paymentNotes: joinNotes(prev.paymentNotes, next.paymentNotes),
      sheetCreditCents: prev.sheetCreditCents + next.sheetCreditCents,
      manualCreditCents: prev.manualCreditCents + next.manualCreditCents,
    })
  })
  return [...byKey.values()]
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left == null && right == null) return null
  return (left ?? 0) + (right ?? 0)
}

function joinNotes(left: string | null, right: string | null): string | null {
  const parts = [left, right].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return null
  return [...new Set(parts)].join(' · ').slice(0, 500)
}

export function splitHeaderNames(values: unknown[][], startRow = 2): string[] {
  const nameIndex = 2 - startRow
  const nameRow = nameIndex >= 0 && nameIndex < values.length ? values[nameIndex] : null
  if (!nameRow) return []
  const names: string[] = []
  for (let index = SPLIT_NAME_START; index <= SPLIT_NAME_END; index += 1) {
    const sheetName = sheetText(cell(nameRow, index), 120)
    if (!sheetName || isHeaderName(sheetName)) continue
    names.push(sheetName)
  }
  return names
}

export function parseSplitsGrid(values: unknown[][], startRow = 2): ParsedCharge[] {
  const nameIndex = 2 - startRow
  const nameRow = nameIndex >= 0 && nameIndex < values.length ? values[nameIndex] : null
  if (!nameRow) return []
  const columns: { index: number; sheetName: string; sheetKey: string }[] = []
  for (let index = SPLIT_NAME_START; index <= SPLIT_NAME_END; index += 1) {
    const sheetName = sheetText(cell(nameRow, index), 120)
    if (!sheetName || isHeaderName(sheetName)) continue
    const sheetKey = normalizeName(sheetName)
    if (!sheetKey) continue
    columns.push({ index, sheetName, sheetKey })
  }
  const charges: ParsedCharge[] = []
  values.forEach((row, index) => {
    const sheetRow = startRow + index
    if (sheetRow < 4 || sheetRow === HELPER_SPLIT_ROW) return
    const dateText = sheetText(cell(row, SPLIT_DATE_COL), 80)
    const typeText = sheetText(cell(row, SPLIT_TYPE_COL), 160)
    if (isTotalLabel(dateText) || isTotalLabel(typeText)) return
    if (!dateText && !typeText) return
    const described = describeCharge(typeText ?? 'Game charge')
    const chargeDate = parseSheetDate(dateText)
    const team = sheetText(cell(row, SPLIT_TEAM_COL), 80)
    const ground = sheetText(cell(row, SPLIT_GROUND_COL), 160)
    const reconStatus = sheetText(cell(row, SPLIT_RECON_COL), 40)
    for (const column of columns) {
      const amountCents = parseSheetMoney(cell(row, column.index))
      if (amountCents == null || amountCents <= 0) continue
      charges.push({
        sheetKey: column.sheetKey,
        sheetName: column.sheetName,
        sheetRow,
        chargeDate,
        chargeType: typeText ?? described.title,
        gameLabel: described.gameLabel,
        chargeKind: described.chargeKind,
        team,
        ground,
        amountCents,
        reconStatus,
      })
    }
  })
  return charges
}

function nonNegativeCents(value: number | null): number {
  if (value == null || value < 0) return 0
  return value
}

export function parseGameNo(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const game = Math.trunc(value)
    if (game < 0 || game > 10000 || Math.abs(value - game) > 1e-6) return null
    return game
  }
  if (typeof value !== 'string') return null
  const match = /^(?:game\s*#?\s*)?(\d+)(?:\.0+)?$/i.exec(value.trim())
  if (!match) return null
  const game = Number(match[1])
  if (!Number.isInteger(game) || game > 10000) return null
  return game
}

export function ledgerRowStatus(raw: string | null, paidCents: number, unsettledCents: number): LedgerRowStatus {
  const compact = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (compact === 'paid') return 'Paid'
  if (compact === 'partial') return 'Partial'
  if (compact === 'open') return 'Open'
  if (unsettledCents === 0) return 'Paid'
  if (paidCents > 0) return 'Partial'
  return 'Open'
}

function rowIsBlank(row: unknown): boolean {
  if (!Array.isArray(row) || row.length === 0) return true
  return row.every((value) => sheetText(value, 500) == null)
}

/**
 * Game Dues Ledger. Row 3 is the header when startRow is 3, and data starts
 * on row 4. Blank rows are skipped. Money cells may be numbers or formatted
 * strings. Paid and unsettled are stored as written; nothing is allocated here.
 */
export function parseLedgerGrid(values: unknown[][], startRow = 3): ParsedLedgerRow[] {
  if (!Number.isInteger(startRow) || startRow < 1) return []
  const rows: ParsedLedgerRow[] = []
  const seenRows = new Set<number>()
  values.forEach((row, index) => {
    const sheetRow = startRow + index
    if (sheetRow < 4 || seenRows.has(sheetRow) || rowIsBlank(row)) return
    const dateText = sheetText(cell(row, LEDGER_DATE_COL), 80)
    if (dateText && normalizeName(dateText) === 'date') return
    const sheetName = sheetText(cell(row, LEDGER_PLAYER_COL), 120)
    if (!sheetName || isHeaderName(sheetName) || isTotalLabel(sheetName) || isTotalLabel(dateText)) return
    const sheetKey = normalizeName(sheetName)
    if (!sheetKey) return
    const dues = parseSheetMoney(cell(row, LEDGER_DUES_COL))
    const paid = parseSheetMoney(cell(row, LEDGER_PAID_COL))
    const unsettled = parseSheetMoney(cell(row, LEDGER_UNSETTLED_COL))
    const gameNo = parseGameNo(cell(row, LEDGER_GAME_COL))
    const gameDate = parseSheetDate(dateText)
    if (dues == null && paid == null && unsettled == null && !gameDate && gameNo == null) return
    const duesCents = nonNegativeCents(dues)
    const paidCents = nonNegativeCents(paid)
    const unsettledCents = nonNegativeCents(unsettled)
    if (duesCents === 0 && paidCents === 0 && unsettledCents === 0 && !gameDate && gameNo == null) return
    seenRows.add(sheetRow)
    rows.push({
      sheetKey,
      sheetName,
      sheetRow,
      gameDate,
      team: sheetText(cell(row, LEDGER_TEAM_COL), 80),
      gameNo,
      ground: sheetText(cell(row, LEDGER_GROUND_COL), 160),
      duesCents,
      paidCents,
      unsettledCents,
      status: ledgerRowStatus(sheetText(cell(row, LEDGER_STATUS_COL), 40), paidCents, unsettledCents),
      memo: sheetText(cell(row, LEDGER_MEMO_COL), 500),
      source: sheetText(cell(row, LEDGER_SOURCE_COL), 120),
    })
  })
  return rows
}

/** Paid when nothing is unsettled. Otherwise the sheet's allocated paid and unsettled, not a new split. */
export function ledgerPaymentStatusText(paidCents: number, unsettledCents: number): string {
  const paid = Number.isFinite(paidCents) ? Math.max(0, Math.round(paidCents)) : 0
  const unsettled = Number.isFinite(unsettledCents) ? Math.max(0, Math.round(unsettledCents)) : 0
  if (unsettled === 0) return 'Paid'
  if (paid === 0) return `${formatCents(unsettled)} unsettled`
  return `${formatCents(paid)} paid, ${formatCents(unsettled)} unsettled`
}

const LEDGER_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

export function ledgerDateLabel(isoDate: string | null): string {
  if (!isoDate) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!match) return isoDate
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(utc.getTime())) return isoDate
  return LEDGER_DATE.format(utc)
}

export function ledgerGameLabel(gameNo: number | null, ground: string | null): string {
  const game = gameNo != null ? `Game #${gameNo}` : ''
  const place = ground?.trim() ?? ''
  if (game && place) return `${game}, ${place}`
  return game || place
}

export function compareLedgerExpenses(
  left: Pick<LedgerExpense, 'gameDate' | 'sheetRow'>,
  right: Pick<LedgerExpense, 'gameDate' | 'sheetRow'>,
): number {
  const leftDate = left.gameDate ?? '9999-99-99'
  const rightDate = right.gameDate ?? '9999-99-99'
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
  return left.sheetRow - right.sheetRow
}

export function shellAccount(sheetKey: string, sheetName: string): ParsedAccount {
  return {
    sheetKey,
    sheetName,
    clubStatus: null,
    clubFeeCents: 0,
    clubFeeStatus: null,
    umpiringFeeCents: 0,
    umpiringStatus: null,
    receivedSaroCents: 0,
    receivedBenCents: 0,
    receivedTotalCents: 0,
    gameChargesTotalCents: null,
    balanceDueCents: null,
    paymentNotes: null,
    sheetCreditCents: 0,
    manualCreditCents: 0,
  }
}

export function withComputedBalance(account: ParsedAccount, charges: ParsedCharge[]): ParsedAccount {
  if (account.balanceDueCents != null) return account
  const fromLines = charges
    .filter((charge) => charge.sheetKey === account.sheetKey && charge.amountCents > 0)
    .reduce((sum, charge) => sum + charge.amountCents, 0)
  const games = account.gameChargesTotalCents ?? fromLines
  return {
    ...account,
    balanceDueCents: account.receivedTotalCents - account.clubFeeCents - account.umpiringFeeCents - games,
  }
}

export function assembleLedger(
  dues: ParsedAccount[],
  charges: ParsedCharge[],
): { accounts: ParsedAccount[]; charges: ParsedCharge[] } {
  const accounts = [...dues]
  const seen = new Set(accounts.map((account) => account.sheetKey))
  for (const charge of charges) {
    if (seen.has(charge.sheetKey)) continue
    seen.add(charge.sheetKey)
    accounts.push(shellAccount(charge.sheetKey, charge.sheetName))
  }
  return {
    accounts: accounts.map((account) => withComputedBalance(account, charges)),
    charges,
  }
}

export type FinanceGrid = {
  duesValues: unknown[][]
  duesStartRow?: number
  splitsValues: unknown[][]
  splitsStartRow?: number
}

export function parseFinanceGrid(grid: FinanceGrid): {
  accounts: ParsedAccount[]
  charges: ParsedCharge[]
  names: string[]
} {
  const duesStart = grid.duesStartRow ?? 1
  const splitsStart = grid.splitsStartRow ?? 2
  const dues = parseDuesGrid(grid.duesValues, duesStart)
  const charges = parseSplitsGrid(grid.splitsValues, splitsStart)
  const names = [...dues.map((account) => account.sheetName), ...splitHeaderNames(grid.splitsValues, splitsStart)]
  return { ...assembleLedger(dues, charges), names }
}

export function interpretFinanceSheet(
  status: number,
  body: unknown,
): { accounts: ParsedAccount[]; charges: ParsedCharge[]; names: string[]; ledgerRows: ParsedLedgerRow[] | null } | { error: string } {
  if (status < 200 || status >= 300) {
    const record = asRecord(body)
    const message = typeof record?.error === 'string' ? record.error : `The sheet returned ${status}.`
    return { error: message.slice(0, 300) }
  }
  const record = asRecord(body)
  if (!record || record.ok !== true) {
    const message = typeof record?.error === 'string' ? record.error : 'The sheet did not return the ledger.'
    return { error: message.slice(0, 300) }
  }
  const dues = asRecord(record.dues)
  const splits = asRecord(record.splits)
  const duesValues = asGrid(dues?.values)
  const splitsValues = asGrid(splits?.values)
  if (!duesValues || !splitsValues) return { error: 'The sheet response was missing a grid.' }
  if (duesValues.length === 0 && splitsValues.length === 0) {
    return { error: 'The sheet did not return any dues or game rows.' }
  }
  const duesStart = typeof dues?.startRow === 'number' ? dues.startRow : 1
  const splitsStart = typeof splits?.startRow === 'number' ? splits.startRow : 2
  const parsed = parseFinanceGrid({
    duesValues,
    duesStartRow: duesStart,
    splitsValues,
    splitsStartRow: splitsStart,
  })
  if (parsed.accounts.length === 0 && parsed.charges.length === 0) {
    return { error: 'The sheet did not include any player rows.' }
  }
  let ledgerRows: ParsedLedgerRow[] | null = null
  if ('ledger' in record && record.ledger != null) {
    const ledger = asRecord(record.ledger)
    const ledgerValues = asGrid(ledger?.values)
    if (ledgerValues) {
      const ledgerStart = typeof ledger?.startRow === 'number' ? ledger.startRow : 3
      ledgerRows = parseLedgerGrid(ledgerValues, ledgerStart)
      for (const row of ledgerRows) parsed.names.push(row.sheetName)
    }
  }
  return { ...parsed, ledgerRows }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asGrid(value: unknown): unknown[][] | null {
  if (!Array.isArray(value)) return null
  const rows: unknown[][] = []
  for (const row of value) {
    if (!Array.isArray(row)) return null
    rows.push(row)
  }
  return rows
}

function tokensOf(name: string): string[] {
  return normalizeName(name)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

function isClubLoginName(name: string | null | undefined): boolean {
  return normalizeName(name ?? '') === 'cheetahs club'
}

function compatibleToken(sheetToken: string, profileToken: string): boolean {
  if (sheetToken === profileToken) return true
  const shorter = sheetToken.length <= profileToken.length ? sheetToken : profileToken
  const longer = shorter === sheetToken ? profileToken : sheetToken
  return shorter.length >= 4 && longer.startsWith(shorter)
}

export function nameMatchScore(sheetName: string, profileName: string): number | null {
  const sheetNorm = normalizeName(sheetName)
  const profileNorm = normalizeName(profileName)
  if (!sheetNorm || !profileNorm) return null
  if (isClubLoginName(profileName)) return null
  if (sheetNorm === profileNorm) return 100
  const sheetTokens = tokensOf(sheetName)
  const profileTokens = tokensOf(profileName)
  const sheetFirst = sheetTokens[0]
  const profileFirst = profileTokens[0]
  if (!sheetFirst || !profileFirst || !compatibleToken(sheetFirst, profileFirst)) return null
  if (sheetTokens.length === 1) {
    if (sheetFirst.length < 3) return null
    return sheetFirst === profileFirst ? 60 : 55
  }
  if (sheetTokens.length > profileTokens.length) return null
  const used = new Set<number>([0])
  for (let index = 1; index < sheetTokens.length; index += 1) {
    const sheetToken = sheetTokens[index]
    if (!sheetToken) return null
    let found = -1
    for (let position = 0; position < profileTokens.length; position += 1) {
      if (used.has(position)) continue
      const profileToken = profileTokens[position]
      if (profileToken && compatibleToken(sheetToken, profileToken)) {
        found = position
        break
      }
    }
    if (found < 0) return null
    used.add(found)
  }
  return 90
}

function uniqueBest(scored: { id: string; score: number }[]): string | null {
  if (scored.length === 0) return null
  let best = scored[0]?.score ?? 0
  for (const row of scored) if (row.score > best) best = row.score
  const winners = new Set(scored.filter((row) => row.score === best).map((row) => row.id))
  if (winners.size !== 1) return null
  return [...winners][0] ?? null
}

function scoresFor(sheetName: string, roster: RosterPerson[]): { id: string; score: number }[] {
  const scored: { id: string; score: number }[] = []
  for (const person of roster) {
    if (!person.fullName || isClubLoginName(person.fullName)) continue
    const score = nameMatchScore(sheetName, person.fullName)
    if (score == null) continue
    scored.push({ id: person.id, score })
  }
  return scored
}

function uniqueAutoMatch(sheetName: string, roster: RosterPerson[]): string | null {
  const key = normalizeName(sheetName)
  const directId = uniqueBest(scoresFor(key, roster))
  if (directId) return directId
  const alias = BUILTIN_ALIASES[key]
  if (!alias) return null
  return uniqueBest(scoresFor(alias, roster))
}

function profileFromMaps(sheetName: string, maps: NameMap[]): string | null {
  const key = normalizeName(sheetName)
  if (!key) return null
  const mapped = maps.filter((entry) => normalizeName(entry.sheetKey) === key)
  const ids = new Set(mapped.map((entry) => entry.profileId).filter(Boolean))
  if (ids.size === 1) return [...ids][0] ?? null
  return null
}

export function matchSheetName(sheetName: string, roster: RosterPerson[], maps: NameMap[]): string | null {
  const key = normalizeName(sheetName)
  if (!key) return null
  const mapped = profileFromMaps(key, maps)
  if (mapped) return mapped
  if (maps.some((entry) => normalizeName(entry.sheetKey) === key)) return null
  return uniqueAutoMatch(sheetName, roster)
}

export function linkNames(
  names: string[],
  roster: RosterPerson[],
  maps: NameMap[],
): { profileIdByKey: Map<string, string>; unmatched: string[] } {
  const profileIdByKey = new Map<string, string>()
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const display = sheetText(name, 120)
    const key = display ? normalizeName(display) : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const profileId = matchSheetName(display ?? name, roster, maps)
    if (profileId) profileIdByKey.set(key, profileId)
    else unmatched.push(display ?? key)
  }
  unmatched.sort((left, right) => left.localeCompare(right))
  return { profileIdByKey, unmatched }
}

function compareCharges(left: Pick<ParsedCharge, 'chargeDate' | 'sheetRow'>, right: Pick<ParsedCharge, 'chargeDate' | 'sheetRow'>): number {
  const leftDate = left.chargeDate ?? '9999-99-99'
  const rightDate = right.chargeDate ?? '9999-99-99'
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
  return left.sheetRow - right.sheetRow
}

function chargeTitle(charge: ParsedCharge): string {
  if (charge.chargeKind === 'dues') return 'Game dues'
  if (charge.chargeKind === 'water') return 'Water'
  if (charge.chargeKind === 'umpire') return 'Umpire share'
  return charge.chargeType
}

/**
 * A splits-only shell is created for a GC Splits name that is not on the dues
 * tab. It has no club fee, payment, or expenses total. Its balance is just the
 * game charges. The dues tab already includes those charges in column L and in
 * the balance, so a linked shell must not be added again.
 */
export function isSplitsOnlyAccount(account: ParsedAccount): boolean {
  return (
    account.gameChargesTotalCents == null &&
    account.clubFeeCents === 0 &&
    account.umpiringFeeCents === 0 &&
    account.receivedSaroCents === 0 &&
    account.receivedBenCents === 0 &&
    account.receivedTotalCents === 0 &&
    account.clubStatus == null &&
    account.clubFeeStatus == null &&
    account.umpiringStatus == null &&
    account.paymentNotes == null &&
    account.sheetCreditCents === 0 &&
    account.manualCreditCents === 0
  )
}

function accountsForMoney<T extends ParsedAccount>(accounts: T[]): T[] {
  const dues = accounts.filter((account) => !isSplitsOnlyAccount(account))
  return dues.length > 0 ? dues : accounts
}

/** Club rollup balance. A dues-tab row wins over linked splits-only shells. */
export function memberBalanceCents(accounts: ParsedAccount[]): number {
  return accountsForMoney(accounts).reduce((sum, account) => sum + (account.balanceDueCents ?? 0), 0)
}

/** Headline and rollup label. A positive balance is a credit, not an amount due. */
export function duesBalanceStat(balanceCents: number): { label: string; value: string } {
  if (balanceCents > 0) return { label: 'Credit', value: formatCents(balanceCents) }
  return { label: 'Balance due', value: formatCents(balanceCents) }
}

export function duesMoneyLabel(balanceCents: number): string {
  const stat = duesBalanceStat(balanceCents)
  return `${stat.label} ${stat.value}`
}

function compactStatus(value: string): string {
  return value.replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase()
}

function dateDetail(text: string | null | undefined): string | null {
  if (!text) return null
  const zelle = /zelle\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/i.exec(text)
  if (zelle?.[0]) return zelle[0].replace(/\s+/g, ' ')
  const date = /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/.exec(text)
  return date?.[0] ?? null
}

/** Sheet fee status, rewritten for the dues page. Unknown text stays as written. */
export function feeStatusLabel(
  status: string | null | undefined,
): { label: string; detail: string | null; tone: PaymentTone } | null {
  const text = (status ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const compact = compactStatus(text)
  if (compact.includes('pending post')) {
    return { label: 'Paid (pending post)', detail: dateDetail(text), tone: 'pending' }
  }
  if (compact === 'paid to saro - needs validation') {
    return { label: 'Paid to Saro, needs validation', detail: null, tone: 'pending' }
  }
  if (compact === 'paid - validated') {
    return { label: 'Paid', detail: null, tone: 'paid' }
  }
  if (compact.includes('credit claim under review')) {
    return { label: 'Credit claim under review', detail: null, tone: 'pending' }
  }
  return { label: text, detail: null, tone: 'neutral' }
}

function knownFeeStatus(status: string | null | undefined): { label: string; detail: string | null; tone: PaymentTone } | null {
  const mapped = feeStatusLabel(status)
  if (!mapped || mapped.tone === 'neutral') return null
  return mapped
}

function duesBalanceLine(account: ParsedAccount): string | null {
  const balance = account.balanceDueCents ?? 0
  if (balance < 0 && account.receivedTotalCents > 0) {
    return `Partially paid, ${formatCents(-balance)} remaining`
  }
  if (balance > 0) return `${formatCents(balance)} credit`
  return null
}

export function duesPaymentStanding(account: ParsedAccount): DuesPaymentStanding | null {
  const fromFee = feeStatusLabel(account.clubFeeStatus)
  const fromNotes = fromFee ? null : knownFeeStatus(account.paymentNotes)
  const mapped = fromFee ?? fromNotes
  let detail = mapped?.detail ?? null
  if (mapped?.label === 'Paid (pending post)' && !detail) detail = dateDetail(account.paymentNotes)
  const balanceLine = duesBalanceLine(account)
  const notes = account.paymentNotes
  if (!mapped && !balanceLine && !notes) return null
  return {
    sheetKey: account.sheetKey,
    sheetName: account.sheetName,
    label: mapped?.label ?? null,
    detail,
    tone: mapped?.tone ?? 'neutral',
    balanceLine,
    notes,
  }
}

export function duesPaymentStandings(accounts: ParsedAccount[]): DuesPaymentStanding[] {
  return accounts.flatMap((account) => {
    if (isSplitsOnlyAccount(account)) return []
    const standing = duesPaymentStanding(account)
    return standing ? [standing] : []
  })
}

function absentLedger(): PlayerLedger {
  return {
    state: 'absent',
    totalPaidCents: 0,
    totalUnpaidCents: 0,
    balanceDueCents: 0,
    owedCents: 0,
    creditCents: 0,
    lines: [],
    groups: [],
    paymentNotes: null,
    clubStatus: null,
    standings: [],
    combinedCreditCents: 0,
    gapCents: 0,
  }
}

export function buildPlayerLedger(accounts: SheetAccount[], charges: SheetCharge[]): PlayerLedger {
  const playable = charges.filter((charge) => charge.amountCents > 0)
  if (accounts.length === 0 && playable.length === 0) return absentLedger()

  const money = accountsForMoney(accounts)
  const received = money.reduce((sum, account) => sum + account.receivedTotalCents, 0)
  const clubFee = money.reduce((sum, account) => sum + Math.max(0, account.clubFeeCents), 0)
  const umpiring = money.reduce((sum, account) => sum + Math.max(0, account.umpiringFeeCents), 0)
  const balanceDueCents = money.reduce((sum, account) => sum + (account.balanceDueCents ?? 0), 0)
  const notes = [...new Set(money.map((account) => account.paymentNotes).filter((note): note is string => Boolean(note)))]
  const clubStatus = money.find((account) => account.clubStatus)?.clubStatus ?? null

  const draft: Omit<LedgerLine, 'appliedCents' | 'status'>[] = []
  if (clubFee > 0) {
    draft.push({
      key: 'membership',
      kind: 'membership',
      title: 'Membership',
      amountCents: clubFee,
      sheetRow: null,
      gameLabel: null,
      chargeDate: null,
      team: null,
      ground: null,
    })
  }
  if (umpiring > 0) {
    draft.push({
      key: 'umpiring',
      kind: 'umpiring',
      title: 'Umpiring fee',
      amountCents: umpiring,
      sheetRow: null,
      gameLabel: null,
      chargeDate: null,
      team: null,
      ground: null,
    })
  }
  const ordered = [...playable].sort(compareCharges)
  for (const charge of ordered) {
    draft.push({
      key: `${charge.sheetKey}:${charge.sheetRow}:${charge.chargeType}:${charge.amountCents}`,
      kind: 'game',
      title: chargeTitle(charge),
      amountCents: charge.amountCents,
      sheetRow: charge.sheetRow,
      gameLabel: charge.gameLabel,
      chargeDate: charge.chargeDate,
      team: charge.team,
      ground: charge.ground,
    })
  }

  let pool = Math.max(0, received)
  const lines: LedgerLine[] = draft.map((line) => {
    const appliedCents = Math.min(pool, line.amountCents)
    pool -= appliedCents
    return {
      ...line,
      appliedCents,
      status: appliedCents >= line.amountCents ? 'Paid' : 'Unpaid',
    }
  })

  const groups = new Map<string, ChargeGroup>()
  for (const line of lines) {
    if (line.kind !== 'game') continue
    const key = [line.chargeDate ?? '', line.team ?? '', line.gameLabel ?? '', line.ground ?? ''].join('|')
    const existing = groups.get(key)
    if (existing) {
      existing.lines.push(line)
      continue
    }
    groups.set(key, {
      key,
      gameLabel: line.gameLabel,
      chargeDate: line.chargeDate,
      team: line.team,
      ground: line.ground,
      lines: [line],
    })
  }
  const grouped = [...groups.values()].sort((left, right) => {
    const leftDate = left.chargeDate ?? '9999-99-99'
    const rightDate = right.chargeDate ?? '9999-99-99'
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
    return (left.lines[0]?.sheetRow ?? 0) - (right.lines[0]?.sheetRow ?? 0)
  })

  const lineTotal = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const appliedTotal = lines.reduce((sum, line) => sum + line.appliedCents, 0)
  const owedCents = balanceDueCents < 0 ? -balanceDueCents : 0
  const creditCents = balanceDueCents > 0 ? balanceDueCents : 0
  const combinedCreditCents = money.reduce(
    (sum, account) => sum + account.sheetCreditCents + account.manualCreditCents,
    0,
  )
  const standings = duesPaymentStandings(money)
  const hasActivity =
    lines.length > 0 || received !== 0 || balanceDueCents !== 0 || standings.length > 0 || combinedCreditCents !== 0
  const state: LedgerState = !hasActivity ? 'empty' : balanceDueCents < 0 ? 'owed' : 'paid'

  return {
    state,
    totalPaidCents: received,
    totalUnpaidCents: owedCents,
    balanceDueCents,
    owedCents,
    creditCents,
    combinedCreditCents,
    lines,
    groups: grouped,
    paymentNotes: notes.length > 0 ? notes.join(' · ').slice(0, 500) : null,
    clubStatus,
    standings,
    gapCents: lineTotal - appliedTotal - owedCents,
  }
}

/** Status badge, amount still owed, and column O plus column P. Credit is omitted at zero. */
export function duesStatusLine(
  ledger: Pick<PlayerLedger, 'balanceDueCents' | 'totalPaidCents' | 'state' | 'combinedCreditCents'>,
): DuesStatusLine | null {
  const remainingCents = ledger.balanceDueCents < 0 ? -ledger.balanceDueCents : 0
  const creditCents = ledger.combinedCreditCents
  let badge: string | null = null
  let tone: PaymentTone = 'neutral'
  if (remainingCents > 0 && ledger.totalPaidCents > 0) {
    badge = 'Partially paid'
    tone = 'pending'
  } else if (remainingCents > 0) {
    badge = 'Unpaid'
    tone = 'pending'
  } else if (ledger.state === 'paid') {
    badge = 'Paid'
    tone = 'paid'
  }
  const remainingLabel = remainingCents > 0 ? `${formatCents(remainingCents)} remaining` : null
  const creditLabel = creditCents > 0 ? `Credit +${formatCents(creditCents)}` : null
  const text = [badge, remainingLabel, creditLabel].filter((part): part is string => Boolean(part)).join(' · ')
  if (!text) return null
  return { badge, tone, remainingLabel, creditLabel, text }
}

export function chargeGroupHeading(group: ChargeGroup): string {
  const parts = [group.gameLabel ?? 'Game charge', group.team, group.ground].filter((part): part is string => Boolean(part))
  return parts.join(' · ')
}

const MMDD = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/

export function reminderMmdd(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return MMDD.test(trimmed) ? trimmed : DEFAULT_REMINDER_MMDD
}

export function zelleEmailOrDefault(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return DEFAULT_ZELLE_EMAIL
  return trimmed
}

export function memoToken(fullName: string | null | undefined, override: string | null | undefined): string {
  let token = (override ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (token.startsWith(MEMO_PREFIX)) {
    token = token.slice(MEMO_PREFIX.length)
    if (token.length > 4 && MMDD.test(token.slice(-4))) token = token.slice(0, -4)
  }
  if (token) return token.slice(0, 24)
  const norm = normalizeName(fullName ?? '')
  if (norm.startsWith('srivatsan ') || norm === 'srivatsan srinivasan' || norm === 'srivatsan sundararajan') {
    if (norm.includes('srini')) return 'SRIVATSANSR'
    if (norm.includes('sundar')) return 'SRIVATSANSU'
  }
  const first = norm.split(' ')[0] ?? ''
  const letters = first.replace(/[^a-z0-9]/g, '').toUpperCase()
  return letters || 'MEMBER'
}

/** The stored per-member token, without CHW26 or the reminder date. Blank clears it. */
export function explicitMemoToken(value: string): string | null {
  let token = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!token) return null
  if (token.startsWith(MEMO_PREFIX)) {
    token = token.slice(MEMO_PREFIX.length)
    if (token.length > 4 && MMDD.test(token.slice(-4))) token = token.slice(0, -4)
  }
  if (!/^[A-Z0-9]{1,24}$/.test(token)) return null
  return token
}

export function zelleMemo(
  fullName: string | null | undefined,
  override: string | null | undefined,
  mmdd: string | null | undefined,
): string {
  return `${MEMO_PREFIX}${memoToken(fullName, override)}${reminderMmdd(mmdd)}`
}

const MEMBER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function memberIdFromParam(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return MEMBER_UUID.test(trimmed) ? trimmed : null
}

export function duesPath(memberId?: string | null): string {
  if (!memberId) return '/dues'
  return `/dues/${memberId}`
}

export function duesUrl(origin: string, memberId?: string | null): string {
  const base = origin.trim().replace(/\/+$/, '')
  return `${base}${duesPath(memberId)}`
}
