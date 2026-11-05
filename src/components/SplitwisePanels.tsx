import { VenmoPayLink } from './VenmoPayLink.tsx'
import { formatPacific } from '../lib/format.ts'
import { formatCents } from '../lib/money.ts'
import {
  netBalance,
  type SplitwiseBalance,
  type SplitwiseSnapshot,
} from '../lib/splitwise.ts'
import { duesVenmoNote, resolveVenmoUsername, VENMO_PLACEHOLDER } from '../lib/venmo.ts'

const PAY_NOTE =
  'Pay the club on Venmo. A captain then records that payment in the Splitwise group. This page does not mark the Splitwise balance paid, and Venmo does not tell the app when you finish.'

function balanceWords(cents: number): string {
  if (cents < 0) return `${formatCents(-cents)} owed`
  if (cents > 0) return `${formatCents(cents)} owed to you`
  return 'Settled'
}

function nameFor(balances: SplitwiseBalance[], id: number): string {
  return balances.find((row) => row.splitwiseUserId === id)?.displayName ?? 'Splitwise member'
}

export function SplitwiseStaffSummary({
  snapshot,
  refreshing,
  refreshError,
  onRefresh,
}: {
  snapshot: SplitwiseSnapshot
  refreshing: boolean
  refreshError: string | null
  onRefresh: () => void
}) {
  const status = snapshot.status
  const syncedAt = snapshot.meta?.syncedAt ?? null
  const placeholder = status?.detail.venmoPlaceholder || resolveVenmoUsername(snapshot.meta) === VENMO_PLACEHOLDER
  return (
    <section className="panel" aria-labelledby="splitwise-rollup-heading">
      <div className="section-heading">
        <p className="kicker">Ledger</p>
        <h2 id="splitwise-rollup-heading">Splitwise</h2>
      </div>
      <ul className="stat-grid">
        <li>
          <span>Members owe</span>
          <strong>{status ? formatCents(status.owedByMembersCents) : '—'}</strong>
        </li>
        <li>
          <span>Members are owed</span>
          <strong>{status ? formatCents(status.owedToMembersCents) : '—'}</strong>
        </li>
        <li>
          <span>In the group</span>
          <strong>{status ? status.memberCount : '—'}</strong>
        </li>
      </ul>
      <p className="fine-print">
        {syncedAt
          ? `Last copy ${formatPacific(syncedAt)}${snapshot.meta?.groupName ? ` · ${snapshot.meta.groupName}` : ''}.`
          : 'No copy yet. Refresh pulls the Cheetahs group.'}
        {status?.accountLabel ? ` Token account: ${status.accountLabel}.` : ''}
      </p>
      <p className="fine-print">
        These totals are the Splitwise group. The in-app ledger below them is a scratch pad and does not change
        Splitwise.
      </p>
      {placeholder ? (
        <p className="banner banner-note">
          Pay links use @{resolveVenmoUsername(snapshot.meta)}. Set the VENMO_USERNAME secret if that is not the club
          account. The handle is public. The Splitwise key is not.
        </p>
      ) : null}
      {status?.detail.nonUsd.length ? (
        <p className="banner banner-note">
          This copy uses USD only. The group also has {status.detail.nonUsd.join(', ')}.
        </p>
      ) : null}
      {status?.syncError ? (
        <p className="banner banner-error" role="alert">
          {status.syncError}
        </p>
      ) : null}
      {refreshError ? (
        <p className="banner banner-error" role="alert">
          {refreshError}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" className="button button-gold" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh from Splitwise'}
        </button>
        {snapshot.meta?.groupId ? (
          <a
            className="button button-quiet"
            href={`https://secure.splitwise.com/groups/${snapshot.meta.groupId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the group
          </a>
        ) : null}
      </div>
    </section>
  )
}

export function SplitwiseMine({
  userId,
  snapshot,
  loading,
  error,
}: {
  userId: string | null
  snapshot: SplitwiseSnapshot
  loading: boolean
  error: string | null
}) {
  const username = resolveVenmoUsername(snapshot.meta)
  const mine = snapshot.balances.filter((row) => row.profileId === userId)
  const net = netBalance(mine)
  const owes = net < 0 ? -net : 0
  const note = duesVenmoNote(snapshot.meta?.groupName ?? 'Splitwise')
  const myExpenseIds = new Set(
    snapshot.shares.filter((share) => share.profileId === userId).map((share) => share.expenseId),
  )
  const recent = snapshot.expenses
    .filter((expense) => myExpenseIds.has(expense.id))
    .sort((a, b) => b.expenseAt.localeCompare(a.expenseAt))
    .slice(0, 8)

  return (
    <section className="panel" aria-labelledby="splitwise-mine-heading">
      <div className="section-heading">
        <p className="kicker">From Splitwise</p>
        <h2 id="splitwise-mine-heading">My balance</h2>
      </div>
      {loading ? <p className="empty-copy">Loading the Splitwise copy…</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !snapshot.meta?.syncedAt ? (
        <p className="empty-copy">A captain has not loaded the Splitwise group yet.</p>
      ) : null}
      {!loading && !error && snapshot.meta?.syncedAt && mine.length === 0 ? (
        <p>
          The last refresh did not match your sign-in email to a Splitwise member. Use the same email in the Cheetahs
          group, then ask a captain to refresh.
        </p>
      ) : null}
      {!loading && !error && mine.length > 0 ? (
        <>
          <p className="money-line">
            <span>{balanceWords(net)}</span>
          </p>
          <p className="fine-print">
            {snapshot.meta?.syncedAt ? `Copied ${formatPacific(snapshot.meta.syncedAt)}. ` : ''}
            A negative Splitwise balance is what you owe the group.
          </p>
          {owes > 0 ? (
            <>
              <p className="fine-print">{PAY_NOTE}</p>
              <div className="card-actions">
                <VenmoPayLink username={username} amountCents={owes} note={note} />
              </div>
            </>
          ) : (
            <p className="fine-print">Nothing to pay the club from this balance.</p>
          )}
        </>
      ) : null}
      {recent.length > 0 ? (
        <>
          <h3>Recent in the group</h3>
          <ul className="card-list tiles">
            {recent.map((expense) => {
              const share = snapshot.shares.find((item) => item.expenseId === expense.id && item.profileId === userId)
              return (
                <li key={expense.id} className="info-card">
                  <div className="tag-row">
                    <span className="tag">{expense.isPayment ? 'Settlement' : 'Expense'}</span>
                    <span className="fine-print">{formatPacific(expense.expenseAt)}</span>
                  </div>
                  <p>
                    <strong>{expense.description}</strong>
                  </p>
                  <p className="money-line">
                    <span>Total {formatCents(expense.costCents)}</span>
                    {share ? <span>Your share {formatCents(share.owedCents)}</span> : null}
                    {share && share.paidCents > 0 ? <span>You paid {formatCents(share.paidCents)}</span> : null}
                  </p>
                </li>
              )
            })}
          </ul>
          <p className="fine-print">This list is a copy. Add and edit costs in Splitwise.</p>
        </>
      ) : null}
    </section>
  )
}

export function SplitwiseBalances({ snapshot }: { snapshot: SplitwiseSnapshot }) {
  const balances = [...snapshot.balances].sort(
    (a, b) => a.balanceCents - b.balanceCents || a.displayName.localeCompare(b.displayName),
  )
  const unmatched = snapshot.status?.detail.unmatchedProfiles ?? []
  return (
    <div className="page">
      <section className="panel" aria-labelledby="splitwise-balances-heading">
        <div className="section-heading">
          <p className="kicker">Group</p>
          <h2 id="splitwise-balances-heading">Balances</h2>
        </div>
        <p className="fine-print">
          Each row is that member&apos;s Splitwise balance. Negative means they owe the group. Record a Venmo payment in
          Splitwise, then refresh. There is no &ldquo;I paid&rdquo; button on these rows.
        </p>
        {balances.length === 0 ? <p className="empty-copy">No Splitwise members in the latest copy.</p> : null}
        {balances.length > 0 ? (
          <ul className="card-list tiles">
            {balances.map((row) => {
              const owes = row.balanceCents < 0 ? -row.balanceCents : 0
              return (
                <li key={row.splitwiseUserId} className="info-card">
                  <div className="tag-row">
                    {row.profileId ? <span className="tag tag-navy">Matched</span> : <span className="tag tag-gold">Unmapped</span>}
                  </div>
                  <h3>{row.displayName}</h3>
                  <p className="money-line">
                    <span>{balanceWords(row.balanceCents)}</span>
                  </p>
                  {row.email ? <p className="fine-print">{row.email}</p> : <p className="fine-print">No email on the Splitwise member.</p>}
                  {!row.profileId ? (
                    <p className="fine-print">This email does not match a Cheetahs sign-in. They will not see this row.</p>
                  ) : null}
                  {owes > 0 ? (
                    <p className="fine-print">They pay from My balance. Opening Venmo here would pay from your account.</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="splitwise-gaps-heading">
        <div className="section-heading">
          <p className="kicker">Match</p>
          <h2 id="splitwise-gaps-heading">Club members not in the copy</h2>
        </div>
        <p className="fine-print">
          Add them to the Splitwise group with the same email they use here. A dummy Splitwise user with no email
          cannot be matched.
        </p>
        {!snapshot.meta?.syncedAt ? <p className="empty-copy">Refresh to compare the roster with the group.</p> : null}
        {snapshot.meta?.syncedAt && unmatched.length === 0 ? (
          <p className="empty-copy">Every club profile with an email is on a Splitwise row.</p>
        ) : null}
        {unmatched.length > 0 ? (
          <ul className="card-list tiles">
            {unmatched.map((profile) => (
              <li key={profile.profileId} className="info-card">
                <h3>{profile.displayName}</h3>
                <p className="fine-print">{profile.email ?? 'No club email'}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {snapshot.status?.detail.unmatchedTruncated ? (
          <p className="fine-print">The list is shortened. Refresh after the group matches the roster.</p>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="splitwise-debts-heading">
        <div className="section-heading">
          <p className="kicker">Simplify</p>
          <h2 id="splitwise-debts-heading">Suggested payments</h2>
        </div>
        <p className="fine-print">
          Splitwise&apos;s simplified USD debts. The Venmo button still pays the club handle for the member&apos;s net
          balance, not a personal Venmo.
        </p>
        {snapshot.debts.length === 0 ? <p className="empty-copy">No simplified USD debts in this copy.</p> : null}
        {snapshot.debts.length > 0 ? (
          <ul className="card-list tiles">
            {snapshot.debts.slice(0, 40).map((debt) => (
              <li key={debt.id}>
                <p>
                  {nameFor(balances, debt.fromSplitwiseUserId)} owes {nameFor(balances, debt.toSplitwiseUserId)}{' '}
                  {formatCents(debt.amountCents)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
