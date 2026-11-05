import { useId, useRef, useState, type FormEvent } from 'react'
import { saveExpense } from '../lib/dues.ts'
import { pacificDateInput } from '../lib/format.ts'
import { centsToDollarInput, parseDollarsToCents } from '../lib/money.ts'
import type { Expense, Team } from '../lib/types.ts'

const CATEGORIES = ['Ground', 'Balls', 'Kit', 'Umpires', 'League fees', 'Food', 'Other']

export function ExpenseForm({
  teams,
  initial,
  onSaved,
  onCancel,
}: {
  teams: Team[]
  initial: Expense | null
  onSaved: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const sending = useRef(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [amount, setAmount] = useState(initial ? centsToDollarInput(initial.amount) : '')
  const [expenseDate, setExpenseDate] = useState(initial?.expense_date.slice(0, 10) ?? pacificDateInput())
  const [category, setCategory] = useState(initial?.category ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [teamId, setTeamId] = useState(initial?.team_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextTitle = title.trim()
    if (nextTitle.length < 1 || nextTitle.length > 140) {
      setError('Give the expense a title up to 140 characters.')
      return
    }
    const cents = parseDollarsToCents(amount)
    if (cents === null) {
      setError('Enter an amount in dollars and cents, like 12.50, up to $1,000,000.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setError('Choose the date the club paid this.')
      return
    }
    const nextCategory = category.trim()
    const nextNotes = notes.trim()
    if (nextCategory.length > 40 || nextNotes.length > 500) {
      setError('Shorten the category or the notes.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveExpense({
      id: initial?.id,
      title: nextTitle,
      amount: cents,
      expenseDate,
      category: nextCategory.length > 0 ? nextCategory : null,
      notes: nextNotes.length > 0 ? nextNotes : null,
      teamId: teamId || null,
    })
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    onSaved()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">{initial ? 'Edit' : 'New'}</p>
        <h2>{initial ? 'Update this expense' : 'Log an expense'}</h2>
      </div>
      <p className="lede">Amounts are US dollars. This ledger does not pay anyone.</p>
      <label htmlFor={titleId}>Title</label>
      <input
        id={titleId}
        name="title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={140}
        required
      />
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-amount`}>Amount (USD)</label>
          <input
            id={`${titleId}-amount`}
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="12.50"
            required
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-date`}>Date</label>
          <input
            id={`${titleId}-date`}
            name="expenseDate"
            type="date"
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
            required
          />
        </div>
      </div>
      <label htmlFor={`${titleId}-category`}>Category</label>
      <input
        id={`${titleId}-category`}
        name="category"
        list={`${titleId}-categories`}
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        maxLength={40}
      />
      <datalist id={`${titleId}-categories`}>
        {CATEGORIES.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <label htmlFor={`${titleId}-notes`}>Notes</label>
      <textarea
        id={`${titleId}-notes`}
        name="notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={500}
        rows={3}
      />
      <label htmlFor={`${titleId}-side`}>Side</label>
      <select id={`${titleId}-side`} name="team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
        <option value="">Club-wide</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <div className="composer-row">
        {initial ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save expense' : 'Add expense'}
        </button>
      </div>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
