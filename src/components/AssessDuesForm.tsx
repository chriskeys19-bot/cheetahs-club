import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { SearchField } from './SearchField.tsx'
import { assessDues, memberLabel } from '../lib/dues.ts'
import { filterByQuery } from '../lib/search.ts'
import { centsToDollarInput, formatCents, parseDollarsToCents, splitCents } from '../lib/money.ts'
import type { DuesRosterMember, Expense, Team, TeamMembership } from '../lib/types.ts'

export function AssessDuesForm({
  teams,
  roster,
  memberships,
  expenses,
  onSaved,
}: {
  teams: Team[]
  roster: DuesRosterMember[]
  memberships: TeamMembership[]
  expenses: Expense[]
  onSaved: () => void
}) {
  const titleId = useId()
  const sending = useRef(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [periodLabel, setPeriodLabel] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [teamId, setTeamId] = useState('')
  const [expenseId, setExpenseId] = useState('')
  const [mode, setMode] = useState<'split' | 'custom'>('split')
  const [total, setTotal] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const activeExpenses = expenses.filter((row) => !row.archived_at)
  const onSide = useMemo(() => {
    const ids = new Set<string>()
    if (!teamId) return ids
    for (const row of memberships) {
      if (row.team_id === teamId) ids.add(row.profile_id)
    }
    return ids
  }, [memberships, teamId])

  const visible = filterByQuery(
    roster.filter((member) => !teamId || onSide.has(member.id)),
    query,
    (member) => [memberLabel(member, member.id)],
  )
  const bulkMembers = teamId ? roster.filter((member) => onSide.has(member.id)) : visible

  const ordered = roster.filter((member) => selected.includes(member.id))
  const splitTotal = parseDollarsToCents(total)
  const shares = mode === 'split' && splitTotal ? splitCents(splitTotal, ordered.length) : []
  const uneven = shares.length > 1 && shares.some((share) => share !== shares[0])

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function onTeam(next: string) {
    setTeamId(next)
    setSelected([])
  }

  function onExpense(next: string) {
    setExpenseId(next)
    const expense = activeExpenses.find((row) => row.id === next)
    if (!expense) return
    setTitle((current) => (current.trim() ? current : expense.title))
    setTotal((current) => (current.trim() ? current : centsToDollarInput(expense.amount)))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextTitle = title.trim()
    const nextPeriod = periodLabel.trim()
    const nextDescription = description.trim()
    if (nextTitle.length < 1 || nextTitle.length > 140) {
      setError('Give the due a title up to 140 characters.')
      return
    }
    if (nextPeriod.length < 1 || nextPeriod.length > 40) {
      setError('Add a period such as Winter 2026, up to 40 characters.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError('Choose a due date.')
      return
    }
    if (nextDescription.length > 2000) {
      setError('Shorten the description.')
      return
    }
    if (ordered.length === 0) {
      setError('Choose at least one member.')
      return
    }

    let amounts: number[] = []
    if (mode === 'split') {
      if (!splitTotal) {
        setError('Enter the total to split, in dollars and cents.')
        return
      }
      amounts = splitCents(splitTotal, ordered.length)
      if (amounts.some((amount) => amount <= 0)) {
        setError('The total has to be at least one cent for each selected member.')
        return
      }
    } else {
      amounts = []
      for (const member of ordered) {
        const cents = parseDollarsToCents(custom[member.id] ?? '')
        if (cents === null) {
          setError(`Enter an amount for ${memberLabel(member, member.id)}.`)
          return
        }
        amounts.push(cents)
      }
    }

    sending.current = true
    setBusy(true)
    setError(null)
    const message = await assessDues(
      ordered.map((member, index) => ({
        title: nextTitle,
        description: nextDescription.length > 0 ? nextDescription : null,
        amount: amounts[index] ?? 0,
        dueDate,
        periodLabel: nextPeriod,
        teamId: teamId || null,
        memberId: member.id,
        expenseId: expenseId || null,
      })),
    )
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    onSaved()
  }

  return (
    <form className="composer span-all" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">Assess</p>
        <h2>Charge dues</h2>
      </div>
      <p className="lede">
        One member, a few people, or a whole side. An even split gives the extra cents to the first names in the list.
        Linking an expense records where the charge came from. Later edits to that expense do not change dues already
        assessed.
      </p>
      <label htmlFor={titleId}>Title</label>
      <input
        id={titleId}
        name="title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={140}
        required
      />
      <label htmlFor={`${titleId}-detail`}>Description</label>
      <textarea
        id={`${titleId}-detail`}
        name="description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={2000}
        rows={3}
      />
      <div className="form-grid two">
        <div>
          <label htmlFor={`${titleId}-period`}>Period</label>
          <input
            id={`${titleId}-period`}
            name="period"
            value={periodLabel}
            onChange={(event) => setPeriodLabel(event.target.value)}
            placeholder="Winter 2026"
            maxLength={40}
            required
          />
        </div>
        <div>
          <label htmlFor={`${titleId}-due`}>Due date</label>
          <input
            id={`${titleId}-due`}
            name="due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
        </div>
      </div>
      <label htmlFor={`${titleId}-side`}>Side</label>
      <select id={`${titleId}-side`} name="team" value={teamId} onChange={(event) => onTeam(event.target.value)}>
        <option value="">Club-wide</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${titleId}-expense`}>Linked expense</label>
      <select
        id={`${titleId}-expense`}
        name="expense"
        value={expenseId}
        onChange={(event) => onExpense(event.target.value)}
      >
        <option value="">None</option>
        {activeExpenses.map((expense) => (
          <option key={expense.id} value={expense.id}>
            {expense.title} · {formatCents(expense.amount)}
          </option>
        ))}
      </select>
      <fieldset className="option-set">
        <legend>Amounts</legend>
        <label className="choice">
          <input
            type="radio"
            name="amount-mode"
            checked={mode === 'split'}
            onChange={() => setMode('split')}
          />
          Split a total evenly
        </label>
        <label className="choice">
          <input
            type="radio"
            name="amount-mode"
            checked={mode === 'custom'}
            onChange={() => setMode('custom')}
          />
          Enter each amount
        </label>
      </fieldset>
      {mode === 'split' ? (
        <div>
          <label htmlFor={`${titleId}-total`}>Total to split (USD)</label>
          <input
            id={`${titleId}-total`}
            name="total"
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            placeholder="120.00"
            required
          />
          {shares.length > 0 ? (
            <p className="fine-print">
              {ordered.length} {ordered.length === 1 ? 'member' : 'members'} · {formatCents(shares[0] ?? 0)}
              {uneven && shares.length > 0 ? ` to ${formatCents(shares[shares.length - 1] ?? 0)}` : ''} each. The shares
              add up to {formatCents(splitTotal ?? 0)}.
            </p>
          ) : null}
        </div>
      ) : null}
      <SearchField
        id={`${titleId}-find`}
        label="Find a member"
        value={query}
        onChange={setQuery}
        placeholder="Name"
      />
      <div className="filter-bar">
        <button
          type="button"
          className="filter-chip"
          onClick={() => setSelected(bulkMembers.map((member) => member.id))}
          disabled={bulkMembers.length === 0}
        >
          {teamId ? 'Select the whole side' : 'Select everyone shown'}
        </button>
        <button type="button" className="filter-chip" onClick={() => setSelected([])} disabled={selected.length === 0}>
          Clear
        </button>
        <span className="count">{selected.length} selected</span>
      </div>
      {roster.length === 0 ? <p className="empty-copy">No members are on the roster yet.</p> : null}
      {roster.length > 0 && visible.length === 0 ? (
        <p className="empty-copy">{teamId ? 'No one on this side matches.' : 'No one matches that name.'}</p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="pick-list">
          {visible.map((member) => {
            const sides = memberships
              .filter((row) => row.profile_id === member.id)
              .map((row) => teams.find((team) => team.id === row.team_id)?.name)
              .filter((name): name is string => Boolean(name))
            const checked = selected.includes(member.id)
            return (
              <li key={member.id} className="pick-row">
                <label className="choice">
                  <input type="checkbox" checked={checked} onChange={() => toggle(member.id)} />
                  <span>
                    {memberLabel(member, member.id)}
                    <span className="fine-print">
                      {' '}
                      · {sides.length > 0 ? sides.join(', ') : 'No side'}
                    </span>
                  </span>
                </label>
                {mode === 'custom' && checked ? (
                  <input
                    className="amount-input"
                    aria-label={`Amount for ${memberLabel(member, member.id)}`}
                    inputMode="decimal"
                    value={custom[member.id] ?? ''}
                    onChange={(event) => setCustom((current) => ({ ...current, [member.id]: event.target.value }))}
                    placeholder="0.00"
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="composer-row">
        <span />
        <button type="submit" className="button button-gold" disabled={busy}>
          {busy ? 'Assessing…' : 'Assess dues'}
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
