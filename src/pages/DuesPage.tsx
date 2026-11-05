import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { AssessDuesForm } from '../components/AssessDuesForm.tsx'
import { ExpenseForm } from '../components/ExpenseForm.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import {
  confirmClaim,
  loadDuesDesk,
  memberLabel,
  recordPayment,
  removePayment,
  setAssessmentStatus,
  setExpenseArchived,
  type DuesDesk,
} from '../lib/dues.ts'
import { formatDateOnly, formatPacific, pacificDateInput } from '../lib/format.ts'
import {
  amountStillOpen,
  amountUnclaimed,
  centsToDollarInput,
  formatCents,
  parseDollarsToCents,
  tallyPayments,
} from '../lib/money.ts'
import {
  canManageClub,
  type ClaimStatus,
  type DuesAssessment,
  type DuesPayment,
  type DueStatus,
  type Expense,
  type RosterMember,
  type Team,
} from '../lib/types.ts'

type DuesView = 'mine' | 'expenses' | 'assess' | 'balances'

function teamLabel(teams: Team[], teamId: string | null): string {
  if (!teamId) return 'Club-wide'
  return teams.find((team) => team.id === teamId)?.name ?? 'Side'
}

function statusTag(status: DueStatus, overdue: boolean, pending: number): { label: string; className: string } {
  if (status === 'paid') return { label: 'Paid', className: 'tag tag-navy' }
  if (status === 'waived') return { label: 'Waived', className: 'tag' }
  if (status === 'cancelled') return { label: 'Cancelled', className: 'tag' }
  if (pending > 0) return { label: 'Pending claim', className: 'tag tag-gold' }
  if (overdue) return { label: 'Overdue', className: 'tag tag-gold' }
  return { label: 'Owed', className: 'tag tag-gold' }
}

function sortMine(rows: DuesAssessment[]): DuesAssessment[] {
  const rank: Record<DueStatus, number> = { open: 0, paid: 1, waived: 2, cancelled: 3 }
  return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || a.due_date.localeCompare(b.due_date))
}

export function DuesPage() {
  const { session, profile, profileReady, profileError } = useAuth()
  const staff = canManageClub(profile?.role)
  const userId = session?.user.id ?? null
  const [view, setView] = useState<DuesView>('mine')
  const [desk, setDesk] = useState<DuesDesk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const running = useRef(false)
  const activeView: DuesView = staff ? view : 'mine'
  const today = pacificDateInput()

  useEffect(() => {
    if (!profileReady || !userId) return
    const gate = { current: false }
    loadDuesDesk({ userId, staff }).then((result) => {
      if (gate.current) return
      setDesk((current) => (result.error && current ? current : result.desk))
      setError(result.error)
    })
    return () => {
      gate.current = true
    }
  }, [profileReady, userId, staff, token])

  function refresh() {
    setError(null)
    setEditing(null)
    setPayingId(null)
    setToken((value) => value + 1)
  }

  async function run(id: string, action: () => Promise<string | null>) {
    if (running.current) return
    running.current = true
    setPendingId(id)
    setError(null)
    try {
      const message = await action()
      if (message) {
        setError(message)
        return
      }
      refresh()
    } finally {
      running.current = false
      setPendingId(null)
    }
  }

  const payments = desk?.payments ?? []
  const mine = sortMine((desk?.assessments ?? []).filter((row) => row.member_id === userId))
  const myOpen = mine.reduce((sum, row) => {
    if (row.status !== 'open') return sum
    return sum + amountStillOpen(row.amount, tallyPayments(payments, row.id).confirmed)
  }, 0)
  const collected = payments.reduce((sum, row) => sum + (row.claim_status === 'confirmed' ? row.amount : 0), 0)
  const outstanding = (desk?.assessments ?? []).reduce((sum, row) => {
    if (row.status !== 'open') return sum
    return sum + amountStillOpen(row.amount, tallyPayments(payments, row.id).confirmed)
  }, 0)
  const expenseTotal = (desk?.expenses ?? []).reduce((sum, row) => sum + (row.archived_at ? 0 : row.amount), 0)

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Club ledger</p>
        <h1>Dues</h1>
        <p className="lede">
          {staff
            ? 'Log expenses, assess dues, and confirm payments. A method note is just a reminder, such as Venmo @cheetahs. Nothing here checks out through Venmo, PayPal, or a card.'
            : 'What you owe the club, and a way to say you have paid. A captain confirms the claim. The club does not take payment inside the app.'}
        </p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins log expenses and assess dues. You can see your own rows and file a payment claim.
      </RoleNote>
      {profileError ? (
        <p className="banner banner-error" role="alert">
          {profileError}
        </p>
      ) : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {staff && desk ? (
        <section className="panel" aria-labelledby="ledger-heading">
          <div className="section-heading">
            <p className="kicker">Rollup</p>
            <h2 id="ledger-heading">Club totals</h2>
          </div>
          <ul className="stat-grid">
            <li>
              <span>Collected</span>
              <strong>{formatCents(collected)}</strong>
            </li>
            <li>
              <span>Outstanding</span>
              <strong>{formatCents(outstanding)}</strong>
            </li>
            <li>
              <span>Expenses</span>
              <strong>{formatCents(expenseTotal)}</strong>
            </li>
          </ul>
          <p className="fine-print">
            Collected is confirmed payments. Outstanding is still open, including amounts waiting on a claim. Expenses
            leave out archived rows.
          </p>
        </section>
      ) : null}
      {staff ? (
        <div className="filter-bar" role="group" aria-label="Dues sections">
          <button type="button" className="filter-chip" aria-pressed={activeView === 'mine'} onClick={() => setView('mine')}>
            My dues
          </button>
          <button
            type="button"
            className="filter-chip"
            aria-pressed={activeView === 'expenses'}
            onClick={() => setView('expenses')}
          >
            Expenses
          </button>
          <button
            type="button"
            className="filter-chip"
            aria-pressed={activeView === 'assess'}
            onClick={() => setView('assess')}
          >
            Assess
          </button>
          <button
            type="button"
            className="filter-chip"
            aria-pressed={activeView === 'balances'}
            onClick={() => setView('balances')}
          >
            Balances
          </button>
        </div>
      ) : null}
      {!profileReady || (desk === null && !error) ? <p className="empty-copy">Loading dues…</p> : null}
      {desk && activeView === 'mine' ? (
        <MyDues
          rows={mine}
          payments={payments}
          expenses={desk.expenses}
          teams={desk.teams}
          today={today}
          openTotal={myOpen}
          staff={staff}
          userId={userId}
          payingId={payingId}
          pendingId={pendingId}
          onPayStart={setPayingId}
          onPayCancel={() => setPayingId(null)}
          onPay={(assessmentId, amount, methodNote, notes, claimStatus) =>
            run(assessmentId, () => recordPayment({ assessmentId, amount, methodNote, notes, claimStatus }))
          }
          onWithdraw={(payment) => {
            if (!window.confirm('Withdraw this payment claim?')) return
            void run(payment.id, () => removePayment(payment.id))
          }}
          onRemove={(payment) => {
            if (!window.confirm('Remove this payment?')) return
            void run(payment.id, () => removePayment(payment.id))
          }}
        />
      ) : null}
      {desk && staff && activeView === 'expenses' ? (
        <ExpenseForm
          key={editing?.id ?? 'new-expense'}
          teams={desk.teams}
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {desk && staff && activeView === 'expenses' ? (
        <section className="panel" aria-labelledby="expenses-heading">
          <div className="section-heading">
            <p className="kicker">Costs</p>
            <h2 id="expenses-heading">Expenses</h2>
          </div>
          <div className="filter-bar">
            <button
              type="button"
              className="filter-chip"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          </div>
          <ExpenseList
            rows={desk.expenses.filter((row) => showArchived || !row.archived_at)}
            teams={desk.teams}
            showArchived={showArchived}
            pendingId={pendingId}
            onEdit={setEditing}
            onArchive={(row) => {
              const archived = !row.archived_at
              const question = archived
                ? 'Archive this expense? It stays on record but drops out of the total.'
                : 'Restore this expense to the active total?'
              if (!window.confirm(question)) return
              void run(row.id, () => setExpenseArchived(row.id, archived))
            }}
          />
        </section>
      ) : null}
      {desk && staff && activeView === 'assess' ? (
        <AssessDuesForm
          key={token}
          teams={desk.teams}
          roster={desk.roster}
          memberships={desk.memberships}
          expenses={desk.expenses}
          onSaved={refresh}
        />
      ) : null}
      {desk && staff && activeView === 'balances' ? (
        <Balances
          assessments={desk.assessments}
          payments={payments}
          roster={desk.roster}
          teams={desk.teams}
          today={today}
          payingId={payingId}
          pendingId={pendingId}
          onPayStart={setPayingId}
          onPayCancel={() => setPayingId(null)}
          onPay={(assessmentId, amount, methodNote, notes) =>
            run(assessmentId, () =>
              recordPayment({ assessmentId, amount, methodNote, notes, claimStatus: 'confirmed' }),
            )
          }
          onConfirm={(payment) => run(payment.id, () => confirmClaim(payment.id))}
          onReject={(payment) => {
            if (!window.confirm('Reject this payment claim?')) return
            void run(payment.id, () => removePayment(payment.id))
          }}
          onRemove={(payment) => {
            if (!window.confirm('Remove this payment?')) return
            void run(payment.id, () => removePayment(payment.id))
          }}
          onStatus={(row, status) => {
            const question =
              status === 'waived' ? 'Waive this due? The member will not owe it.' : 'Cancel this due?'
            if (!window.confirm(question)) return
            void run(row.id, () => setAssessmentStatus(row.id, status))
          }}
        />
      ) : null}
    </div>
  )
}

function PaymentNoteForm({
  defaultCents,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  defaultCents: number
  submitLabel: string
  busy: boolean
  onCancel: () => void
  onSubmit: (amount: number, methodNote: string, notes: string | null) => void
}) {
  const fieldId = useId()
  const [amount, setAmount] = useState(centsToDollarInput(defaultCents))
  const [methodNote, setMethodNote] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = parseDollarsToCents(amount)
    if (cents === null) {
      setError('Use dollars and cents, like 12.50.')
      return
    }
    if (cents > defaultCents) {
      setError(`The most you can record right now is ${formatCents(defaultCents)}.`)
      return
    }
    const method = methodNote.trim()
    if (method.length < 1 || method.length > 160) {
      setError('Add how it was paid, up to 160 characters. Example: Venmo @cheetahs.')
      return
    }
    const detail = notes.trim()
    if (detail.length > 500) {
      setError('Keep the extra note under 500 characters.')
      return
    }
    setError(null)
    onSubmit(cents, method, detail.length > 0 ? detail : null)
  }

  return (
    <form className="composer" onSubmit={onSubmitForm}>
      <label htmlFor={`${fieldId}-amount`}>Amount (USD)</label>
      <input
        id={`${fieldId}-amount`}
        name="amount"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
      />
      <label htmlFor={`${fieldId}-method`}>How it was paid</label>
      <input
        id={`${fieldId}-method`}
        name="method"
        value={methodNote}
        onChange={(event) => setMethodNote(event.target.value)}
        maxLength={160}
        placeholder="Venmo @cheetahs"
        required
      />
      <label htmlFor={`${fieldId}-notes`}>Note</label>
      <textarea
        id={`${fieldId}-notes`}
        className="note-field"
        name="notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={500}
        rows={2}
      />
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-row">
        <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function PaymentLines({
  rows,
  staff,
  userId,
  pendingId,
  onWithdraw,
  onRemove,
}: {
  rows: DuesPayment[]
  staff: boolean
  userId: string | null
  pendingId: string | null
  onWithdraw: (payment: DuesPayment) => void
  onRemove: (payment: DuesPayment) => void
}) {
  if (rows.length === 0) return null
  return (
    <ul className="choice-list">
      {rows.map((payment) => (
        <li key={payment.id} className="fine-print">
          {formatCents(payment.amount)} · {payment.claim_status === 'pending_claim' ? 'Pending claim' : 'Confirmed'}
          {payment.method_note ? ` · ${payment.method_note}` : ''} · {formatPacific(payment.paid_at)}
          {payment.notes ? ` · ${payment.notes}` : ''}
          <span className="card-actions">
            {payment.claim_status === 'pending_claim' && payment.payer_user_id === userId ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => onWithdraw(payment)}
                disabled={pendingId === payment.id}
              >
                Withdraw claim
              </button>
            ) : null}
            {staff && payment.claim_status === 'confirmed' ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => onRemove(payment)}
                disabled={pendingId === payment.id}
              >
                Remove
              </button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function MyDues({
  rows,
  payments,
  expenses,
  teams,
  today,
  openTotal,
  staff,
  userId,
  payingId,
  pendingId,
  onPayStart,
  onPayCancel,
  onPay,
  onWithdraw,
  onRemove,
}: {
  rows: DuesAssessment[]
  payments: DuesPayment[]
  expenses: Expense[]
  teams: Team[]
  today: string
  openTotal: number
  staff: boolean
  userId: string | null
  payingId: string | null
  pendingId: string | null
  onPayStart: (id: string) => void
  onPayCancel: () => void
  onPay: (assessmentId: string, amount: number, methodNote: string, notes: string | null, claimStatus: ClaimStatus) => void
  onWithdraw: (payment: DuesPayment) => void
  onRemove: (payment: DuesPayment) => void
}) {
  return (
    <section className="panel" aria-labelledby="mine-heading">
      <div className="section-heading">
        <p className="kicker">Yours</p>
        <h2 id="mine-heading">My dues</h2>
      </div>
      <p className="fine-print">
        {openTotal > 0 ? `${formatCents(openTotal)} still open.` : 'Nothing open on your account.'}
      </p>
      {rows.length === 0 ? (
        <p className="empty-copy">You have no dues right now. When a captain assesses a charge, it shows up here.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="card-list">
          {rows.map((row) => {
            const tally = tallyPayments(payments, row.id)
            const unclaimed = amountUnclaimed(row.amount, tally.confirmed, tally.pending)
            const tag = statusTag(row.status, row.due_date < today, tally.pending)
            const expense = row.expense_id ? expenses.find((item) => item.id === row.expense_id) : undefined
            const rowPayments = payments.filter((payment) => payment.assessment_id === row.id)
            return (
              <li key={row.id} className="info-card">
                <div className="tag-row">
                  <span className={tag.className}>{tag.label}</span>
                  <span className="tag">{row.period_label}</span>
                  <span className="tag tag-navy">{teamLabel(teams, row.team_id)}</span>
                </div>
                <h3>{row.title}</h3>
                <p className="fine-print">Due {formatDateOnly(row.due_date)}</p>
                {row.description ? <p>{row.description}</p> : null}
                <p className="money-line">
                  <span>Due {formatCents(row.amount)}</span>
                  <span>Paid {formatCents(tally.confirmed)}</span>
                  {tally.pending > 0 ? <span>Claimed {formatCents(tally.pending)}</span> : null}
                  <span>Left {formatCents(amountStillOpen(row.amount, tally.confirmed))}</span>
                </p>
                {row.expense_id ? (
                  <p className="fine-print">
                    {expense
                      ? `Expense: ${expense.title}${expense.category ? ` · ${expense.category}` : ''} · ${formatCents(expense.amount)} · ${formatDateOnly(expense.expense_date)}`
                      : 'Linked expense is not available.'}
                  </p>
                ) : null}
                <PaymentLines
                  rows={rowPayments}
                  staff={staff}
                  userId={userId}
                  pendingId={pendingId}
                  onWithdraw={onWithdraw}
                  onRemove={onRemove}
                />
                {row.status === 'open' && unclaimed > 0 && payingId !== row.id ? (
                  <div className="card-actions">
                    <button type="button" className="button button-gold" onClick={() => onPayStart(row.id)}>
                      {staff ? 'Record payment' : 'I paid'}
                    </button>
                  </div>
                ) : null}
                {payingId === row.id ? (
                  <PaymentNoteForm
                    defaultCents={unclaimed}
                    submitLabel={staff ? 'Save payment' : 'Submit claim'}
                    busy={pendingId === row.id}
                    onCancel={onPayCancel}
                    onSubmit={(amount, methodNote, notes) =>
                      onPay(row.id, amount, methodNote, notes, staff ? 'confirmed' : 'pending_claim')
                    }
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function ExpenseList({
  rows,
  teams,
  showArchived,
  pendingId,
  onEdit,
  onArchive,
}: {
  rows: Expense[]
  teams: Team[]
  showArchived: boolean
  pendingId: string | null
  onEdit: (row: Expense) => void
  onArchive: (row: Expense) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="empty-copy">
        {showArchived ? 'No expenses yet.' : 'No active expenses. Log ground fees, balls, and other club costs.'}
      </p>
    )
  }
  return (
    <ul className="card-list">
      {rows.map((row) => (
        <li key={row.id} className="info-card">
          <div className="tag-row">
            <span className="tag tag-navy">{teamLabel(teams, row.team_id)}</span>
            {row.category ? <span className="tag">{row.category}</span> : null}
            {row.archived_at ? <span className="tag">Archived</span> : null}
            <span className="fine-print">{formatDateOnly(row.expense_date)}</span>
          </div>
          <h3>{row.title}</h3>
          <p className="money-line">
            <span>{formatCents(row.amount)}</span>
          </p>
          {row.notes ? <p>{row.notes}</p> : null}
          <div className="card-actions">
            <button type="button" className="button button-quiet" onClick={() => onEdit(row)}>
              Edit
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => onArchive(row)}
              disabled={pendingId === row.id}
            >
              {row.archived_at ? 'Restore' : 'Archive'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Balances({
  assessments,
  payments,
  roster,
  teams,
  today,
  payingId,
  pendingId,
  onPayStart,
  onPayCancel,
  onPay,
  onConfirm,
  onReject,
  onRemove,
  onStatus,
}: {
  assessments: DuesAssessment[]
  payments: DuesPayment[]
  roster: RosterMember[]
  teams: Team[]
  today: string
  payingId: string | null
  pendingId: string | null
  onPayStart: (id: string) => void
  onPayCancel: () => void
  onPay: (assessmentId: string, amount: number, methodNote: string, notes: string | null) => void
  onConfirm: (payment: DuesPayment) => void
  onReject: (payment: DuesPayment) => void
  onRemove: (payment: DuesPayment) => void
  onStatus: (row: DuesAssessment, status: 'waived' | 'cancelled') => void
}) {
  const claims = payments.filter((payment) => payment.claim_status === 'pending_claim')
  const openRows = assessments.filter((row) => row.status === 'open')
  const byMember = new Map<string, DuesAssessment[]>()
  for (const row of openRows) {
    const list = byMember.get(row.member_id) ?? []
    list.push(row)
    byMember.set(row.member_id, list)
  }
  const memberIds = [...byMember.keys()].sort((a, b) => {
    const balance = (id: string) =>
      (byMember.get(id) ?? []).reduce(
        (sum, row) => sum + amountStillOpen(row.amount, tallyPayments(payments, row.id).confirmed),
        0,
      )
    return balance(b) - balance(a) || memberLabel(roster.find((member) => member.id === a), a).localeCompare(
      memberLabel(roster.find((member) => member.id === b), b),
    )
  })

  return (
    <div className="page">
      <section className="panel" aria-labelledby="claims-heading">
        <div className="section-heading">
          <p className="kicker">Waiting</p>
          <h2 id="claims-heading">Payment claims</h2>
        </div>
        {claims.length === 0 ? <p className="empty-copy">No one is waiting on a payment claim.</p> : null}
        {claims.length > 0 ? (
          <ul className="card-list">
            {claims.map((payment) => {
              const assessment = assessments.find((row) => row.id === payment.assessment_id)
              const member = roster.find((row) => row.id === (assessment?.member_id ?? payment.payer_user_id ?? ''))
              const name = memberLabel(member, assessment?.member_id ?? payment.payer_user_id ?? payment.id)
              return (
                <li key={payment.id} className="info-card">
                  <h3>{name}</h3>
                  <p>
                    {assessment?.title ?? 'Due'} · {formatCents(payment.amount)}
                    {payment.method_note ? ` · ${payment.method_note}` : ''}
                  </p>
                  <p className="fine-print">{formatPacific(payment.paid_at)}</p>
                  {payment.notes ? <p>{payment.notes}</p> : null}
                  <div className="card-actions">
                    <button
                      type="button"
                      className="button button-gold"
                      onClick={() => onConfirm(payment)}
                      disabled={pendingId === payment.id}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => onReject(payment)}
                      disabled={pendingId === payment.id}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="balances-heading">
        <div className="section-heading">
          <p className="kicker">Open</p>
          <h2 id="balances-heading">Outstanding dues</h2>
        </div>
        {memberIds.length === 0 ? <p className="empty-copy">Nothing outstanding.</p> : null}
        <div className="card-list">
        {memberIds.map((memberId) => {
          const member = roster.find((row) => row.id === memberId)
          const rows = byMember.get(memberId) ?? []
          const balance = rows.reduce(
            (sum, row) => sum + amountStillOpen(row.amount, tallyPayments(payments, row.id).confirmed),
            0,
          )
          return (
            <article key={memberId} className="info-card">
              <h3>{memberLabel(member, memberId)}</h3>
              <p className="money-line">
                <span>{formatCents(balance)} open</span>
              </p>
              <ul className="card-list">
                {rows.map((row) => {
                  const tally = tallyPayments(payments, row.id)
                  const unclaimed = amountUnclaimed(row.amount, tally.confirmed, tally.pending)
                  const confirmedPayments = payments.filter(
                    (payment) => payment.assessment_id === row.id && payment.claim_status === 'confirmed',
                  )
                  return (
                    <li key={row.id}>
                      <div className="tag-row">
                        <span className={statusTag(row.status, row.due_date < today, tally.pending).className}>
                          {statusTag(row.status, row.due_date < today, tally.pending).label}
                        </span>
                        <span className="tag">{row.period_label}</span>
                        <span className="tag tag-navy">{teamLabel(teams, row.team_id)}</span>
                      </div>
                      <p>
                        <strong>{row.title}</strong> · due {formatDateOnly(row.due_date)}
                      </p>
                      <p className="money-line">
                        <span>Due {formatCents(row.amount)}</span>
                        <span>Paid {formatCents(tally.confirmed)}</span>
                        {tally.pending > 0 ? <span>Claimed {formatCents(tally.pending)}</span> : null}
                        <span>Left {formatCents(amountStillOpen(row.amount, tally.confirmed))}</span>
                      </p>
                      <PaymentLines
                        rows={confirmedPayments}
                        staff
                        userId={null}
                        pendingId={pendingId}
                        onWithdraw={() => undefined}
                        onRemove={onRemove}
                      />
                      <div className="card-actions">
                        {unclaimed > 0 && payingId !== row.id ? (
                          <button type="button" className="button button-gold" onClick={() => onPayStart(row.id)}>
                            Mark paid
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => onStatus(row, 'waived')}
                          disabled={pendingId === row.id}
                        >
                          Waive
                        </button>
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => onStatus(row, 'cancelled')}
                          disabled={pendingId === row.id}
                        >
                          Cancel due
                        </button>
                      </div>
                      {payingId === row.id ? (
                        <PaymentNoteForm
                          defaultCents={unclaimed}
                          submitLabel="Save payment"
                          busy={pendingId === row.id}
                          onCancel={onPayCancel}
                          onSubmit={(amount, methodNote, notes) => onPay(row.id, amount, methodNote, notes)}
                        />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </article>
          )
        })}
        </div>
      </section>
    </div>
  )
}
