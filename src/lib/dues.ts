import { actionError } from './errors.ts'
import { loadTeams } from './teams.ts'
import { supabase } from './supabase.ts'
import {
  isClaimStatus,
  isClubRole,
  isDueStatus,
  type ClaimStatus,
  type DuesAssessment,
  type DuesPayment,
  type DueStatus,
  type Expense,
  type RosterMember,
  type Team,
  type TeamMembership,
} from './types.ts'

export type DuesDesk = {
  teams: Team[]
  assessments: DuesAssessment[]
  payments: DuesPayment[]
  expenses: Expense[]
  roster: RosterMember[]
  memberships: TeamMembership[]
}

const emptyDesk: DuesDesk = {
  teams: [],
  assessments: [],
  payments: [],
  expenses: [],
  roster: [],
  memberships: [],
}

const expenseColumns =
  'id, title, amount, currency, expense_date, category, notes, team_id, created_by, created_at, updated_at, archived_at'

const assessmentColumns =
  'id, title, description, amount, due_date, period_label, team_id, member_id, expense_id, status, created_by, created_at, updated_at'

const paymentColumns =
  'id, assessment_id, amount, paid_at, method_note, recorded_by, claim_status, payer_user_id, notes, created_at'

export function duesActionError(message: string): string {
  const lower = message.toLowerCase()
  const missingRelation =
    lower.includes('schema cache') ||
    lower.includes('could not find the table') ||
    lower.includes('could not find the function')
  if (missingRelation && (lower.includes('expense') || lower.includes('dues_'))) {
    return 'Dues are not on the database yet. Apply supabase/migrations/20261106010000_phase3_dues.sql, then reload.'
  }
  if (lower.includes('payment exceeds')) return 'That amount is more than the balance still open.'
  if (lower.includes('assessment is closed')) return 'That due is no longer open.'
  if (lower.includes('not your assessment')) return 'You can only record a payment on your own dues.'
  if (lower.includes('member cannot change')) return 'That due stays with the member it was assessed to.'
  if (lower.includes('amount_positive') || lower.includes('amount must be positive')) {
    return 'Enter an amount greater than zero.'
  }
  if (lower.includes('_length')) return 'Shorten one of the text fields and try again.'
  if (
    (lower.includes('dues_') || lower.includes('expenses') || lower.includes('expense')) &&
    (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('staff role'))
  ) {
    return 'That dues change was not allowed.'
  }
  return actionError(message)
}

function parseCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(amount)) return null
  return amount
}

function parseExpenses(value: unknown): Expense[] {
  if (!Array.isArray(value)) return []
  const rows: Expense[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const amount = parseCents(row.amount)
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      amount === null ||
      typeof row.currency !== 'string' ||
      typeof row.expense_date !== 'string' ||
      typeof row.created_at !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      continue
    }
    rows.push({
      id: row.id,
      title: row.title,
      amount,
      currency: row.currency,
      expense_date: row.expense_date,
      category: typeof row.category === 'string' ? row.category : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      team_id: typeof row.team_id === 'string' ? row.team_id : null,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_at: typeof row.archived_at === 'string' ? row.archived_at : null,
    })
  }
  return rows
}

function parseAssessments(value: unknown): DuesAssessment[] {
  if (!Array.isArray(value)) return []
  const rows: DuesAssessment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const amount = parseCents(row.amount)
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      amount === null ||
      typeof row.due_date !== 'string' ||
      typeof row.period_label !== 'string' ||
      typeof row.member_id !== 'string' ||
      !isDueStatus(row.status) ||
      typeof row.created_at !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      continue
    }
    rows.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : null,
      amount,
      due_date: row.due_date,
      period_label: row.period_label,
      team_id: typeof row.team_id === 'string' ? row.team_id : null,
      member_id: row.member_id,
      expense_id: typeof row.expense_id === 'string' ? row.expense_id : null,
      status: row.status,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  }
  return rows
}

function parsePayments(value: unknown): DuesPayment[] {
  if (!Array.isArray(value)) return []
  const rows: DuesPayment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const amount = parseCents(row.amount)
    if (
      typeof row.id !== 'string' ||
      typeof row.assessment_id !== 'string' ||
      amount === null ||
      typeof row.paid_at !== 'string' ||
      !isClaimStatus(row.claim_status) ||
      typeof row.created_at !== 'string'
    ) {
      continue
    }
    rows.push({
      id: row.id,
      assessment_id: row.assessment_id,
      amount,
      paid_at: row.paid_at,
      method_note: typeof row.method_note === 'string' ? row.method_note : null,
      recorded_by: typeof row.recorded_by === 'string' ? row.recorded_by : null,
      claim_status: row.claim_status,
      payer_user_id: typeof row.payer_user_id === 'string' ? row.payer_user_id : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      created_at: row.created_at,
    })
  }
  return rows
}

function parseRoster(value: unknown): RosterMember[] {
  if (!Array.isArray(value)) return []
  const rows: RosterMember[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !isClubRole(row.role)) continue
    if (row.full_name !== null && typeof row.full_name !== 'string') continue
    rows.push({ id: row.id, full_name: row.full_name, role: row.role })
  }
  rows.sort((a, b) => memberLabel(a, a.id).localeCompare(memberLabel(b, b.id)))
  return rows
}

function parseMemberships(value: unknown): TeamMembership[] {
  if (!Array.isArray(value)) return []
  const rows: TeamMembership[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.team_id !== 'string' || typeof row.profile_id !== 'string') continue
    rows.push({ team_id: row.team_id, profile_id: row.profile_id })
  }
  return rows
}

export function memberLabel(member: { full_name: string | null } | undefined, id: string): string {
  const name = member?.full_name?.trim()
  if (name) return name
  return `Member ${id.slice(0, 8)}`
}

function firstError(messages: (string | null | undefined)[]): string | null {
  for (const message of messages) {
    if (message) return duesActionError(message)
  }
  return null
}

export async function loadDuesDesk(input: {
  userId: string
  staff: boolean
}): Promise<{ desk: DuesDesk; error: string | null }> {
  if (!supabase) return { desk: emptyDesk, error: 'Supabase is not configured.' }
  const client = supabase

  let assessmentsQuery = client
    .from('dues_assessments')
    .select(assessmentColumns)
    .order('due_date', { ascending: true })
    .limit(500)
  let paymentsQuery = client
    .from('dues_payments')
    .select(paymentColumns)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (!input.staff) {
    assessmentsQuery = assessmentsQuery.eq('member_id', input.userId)
    paymentsQuery = paymentsQuery.eq('payer_user_id', input.userId)
  }

  const [teamsResult, assessmentsResult, paymentsResult, rosterResult, membershipResult, expensesResult] =
    await Promise.all([
      loadTeams(),
      assessmentsQuery,
      paymentsQuery,
      input.staff ? client.rpc('dues_roster') : Promise.resolve({ data: [], error: null }),
      input.staff
        ? client.from('team_members').select('team_id, profile_id').limit(2000)
        : Promise.resolve({ data: [], error: null }),
      input.staff
        ? client.from('expenses').select(expenseColumns).order('expense_date', { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null }),
    ])

  const assessments = parseAssessments(assessmentsResult.data)
  let expenses = parseExpenses(expensesResult.data)
  let expenseError: string | null = expensesResult.error?.message ?? null

  if (!input.staff && !assessmentsResult.error) {
    const ids = [...new Set(assessments.flatMap((row) => (row.expense_id ? [row.expense_id] : [])))]
    if (ids.length > 0) {
      const linked = await client.from('expenses').select(expenseColumns).in('id', ids)
      expenses = parseExpenses(linked.data)
      expenseError = linked.error?.message ?? null
    }
  }

  const desk: DuesDesk = {
    teams: teamsResult.teams,
    assessments,
    payments: parsePayments(paymentsResult.data),
    expenses,
    roster: parseRoster(rosterResult.data),
    memberships: parseMemberships(membershipResult.data),
  }
  const error = firstError([
    teamsResult.error,
    assessmentsResult.error?.message,
    paymentsResult.error?.message,
    rosterResult.error?.message,
    membershipResult.error?.message,
    expenseError,
  ])
  return { desk, error }
}

async function changed(result: {
  data: unknown
  error: { message: string } | null
}, emptyMessage: string): Promise<string | null> {
  if (result.error) return duesActionError(result.error.message)
  if (!Array.isArray(result.data) || result.data.length === 0) return emptyMessage
  return null
}

export async function saveExpense(input: {
  id?: string
  title: string
  amount: number
  expenseDate: string
  category: string | null
  notes: string | null
  teamId: string | null
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const payload = {
    title: input.title.trim(),
    amount: input.amount,
    currency: 'USD',
    expense_date: input.expenseDate,
    category: input.category,
    notes: input.notes,
    team_id: input.teamId,
  }
  const query = input.id
    ? supabase.from('expenses').update(payload).eq('id', input.id)
    : supabase.from('expenses').insert(payload)
  const { data, error } = await query.select('id')
  return changed({ data, error }, 'That expense could not be saved.')
}

export async function setExpenseArchived(id: string, archived: boolean): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const stamp = archived ? new Date().toISOString() : null
  let query = supabase.from('expenses').update({ archived_at: stamp }).eq('id', id)
  query = archived ? query.is('archived_at', null) : query.not('archived_at', 'is', null)
  const { data, error } = await query.select('id')
  return changed({ data, error }, archived ? 'That expense is already archived.' : 'That expense is already active.')
}

export async function assessDues(
  rows: {
    title: string
    description: string | null
    amount: number
    dueDate: string
    periodLabel: string
    teamId: string | null
    memberId: string
    expenseId: string | null
  }[],
): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  if (rows.length === 0) return 'Choose at least one member.'
  const payload = rows.map((row) => ({
    title: row.title.trim(),
    description: row.description,
    amount: row.amount,
    due_date: row.dueDate,
    period_label: row.periodLabel.trim(),
    team_id: row.teamId,
    member_id: row.memberId,
    expense_id: row.expenseId,
    status: 'open' satisfies DueStatus,
  }))
  const { data, error } = await supabase.from('dues_assessments').insert(payload).select('id')
  if (error) return duesActionError(error.message)
  if (!Array.isArray(data) || data.length !== payload.length) return 'Those dues could not be assessed.'
  return null
}

export async function setAssessmentStatus(id: string, status: 'waived' | 'cancelled'): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('dues_assessments')
    .update({ status })
    .eq('id', id)
    .eq('status', 'open')
    .select('id')
  return changed({ data, error }, 'That due is no longer open.')
}

export async function recordPayment(input: {
  assessmentId: string
  amount: number
  methodNote: string
  notes: string | null
  claimStatus: ClaimStatus
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('dues_payments')
    .insert({
      assessment_id: input.assessmentId,
      amount: input.amount,
      paid_at: new Date().toISOString(),
      method_note: input.methodNote.trim(),
      notes: input.notes,
      claim_status: input.claimStatus,
    })
    .select('id')
  return changed({ data, error }, 'That payment could not be recorded.')
}

export async function confirmClaim(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('dues_payments')
    .update({ claim_status: 'confirmed' })
    .eq('id', id)
    .eq('claim_status', 'pending_claim')
    .select('id')
  return changed({ data, error }, 'That claim is no longer waiting.')
}

export async function removePayment(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase.from('dues_payments').delete().eq('id', id).select('id')
  return changed({ data, error }, 'That payment could not be removed.')
}
