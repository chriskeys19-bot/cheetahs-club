import { VenmoPayLink } from './VenmoPayLink.tsx'
import { formatPacific } from '../lib/format.ts'
import { formatCents } from '../lib/money.ts'
import {
  netBalance,
  type SplitwiseBalance,
  type SplitwiseMeta,
  type SplitwiseSnapshot,
} from '../lib/splitwise.ts'
import { splitwiseSyncLabel, splitwiseSyncSourceLabel } from '../lib/splitwiseSyncLabel.ts'
import type { SplitwiseAddSummary } from '../lib/splitwiseMembership.ts'
import { duesVenmoNote, resolveVenmoUsername, venmoFeatureEnabled, venmoPayHandle } from '../lib/venmo.ts'

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

function syncedLine(meta: SplitwiseMeta | null, withGroup: boolean): string {
  return splitwiseSyncLabel({
    syncedAt: meta?.syncedAt ?? null,
    lastAttemptFailed: meta?.lastAttemptFailed ?? false,
    lastAttemptAt: meta?.lastAttemptAt ?? null,
    groupName: withGroup ? meta?.groupName : null,
  })
}

function addSummaryText(summary: SplitwiseAddSummary): string {
  const parts = [
    `Added ${summary.added}.`,
    `Already in the group ${summary.alreadyMember}.`,
    `Already recorded ${summary.alreadyRecorded}.`,
    `Failed ${summary.failed}.`,
    `Skipped ${summary.skipped}.`,
  ]
  if (summary.rateLimited) parts.push('Splitwise rate limit stopped the run.')
  if (summary.remaining > 0) parts.push(`${summary.remaining} were not tried.`)
  if (summary.synced) parts.push('The balance copy was refreshed.')
  else if (summary.added > 0 || summary.alreadyMember > 0) {
    parts.push('The balance copy was not refreshed. Use Refresh from Splitwise.')
  }
  return parts.join(' ')
}

export function SplitwiseStaffSummary({
  snapshot,
  refreshing,
  refreshError,
  onRefresh,
  isAdmin,
  addingMembers,
  addError,
  addSummary,
  onAddAll,
}: {
  snapshot: SplitwiseSnapshot
  refreshing: boolean
  refreshError: string | null
  onRefresh: () => void
  isAdmin: boolean
  addingMembers: boolean
  addError: string | null
  addSummary: SplitwiseAddSummary | null
  onAddAll: () => void
}) {
  const status = snapshot.status
  const sourceLabel = splitwiseSyncSourceLabel(snapshot.meta?.syncSource ?? null)
  const venmoHandle = resolveVenmoUsername(snapshot.meta)
  const showVenmoSetup = venmoFeatureEnabled() && !venmoHandle
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
        {syncedLine(snapshot.meta, true)}
        {status?.accountLabel ? ` Token account: ${status.accountLabel}.` : ''}
      </p>
      {snapshot.meta?.syncedAt && sourceLabel ? <p className="fine-print">{sourceLabel}</p> : null}
      <p className="fine-print">
        These totals are the Splitwise group. The in-app ledger below them is a scratch pad and does not change
        Splitwise.
      </p>
      {showVenmoSetup ? (
        <p className="banner banner-note">
          Venmo pay links are on, but no club handle is set. Set the VENMO_USERNAME secret to the real handle, then
          refresh. The old placeholder is not used. The handle is public. The Splitwise key is not.
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
      {addSummary ? (
        <div className="banner banner-note" role="status">
          <p>{addSummaryText(addSummary)}</p>
          {addSummary.failures.length > 0 ? (
            <ul>
              {addSummary.failures.map((failure) => (
                <li key={failure.profileId}>
                  {failure.displayName}
                  {failure.email ? ` (${failure.email})` : ''}: {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {addError ? (
        <p className="banner banner-error" role="alert">
          {addError}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" className="button button-gold" onClick={onRefresh} disabled={refreshing || addingMembers}>
          {refreshing ? 'Refreshing…' : 'Refresh from Splitwise'}
        </button>
        {isAdmin ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={onAddAll}
            disabled={addingMembers || refreshing}
          >
            {addingMembers ? 'Adding members…' : 'Add all members to Splitwise'}
          </button>
        ) : null}
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
      {isAdmin ? (
        <p className="fine-print">
          Add all members invites any club sign-in email that is not already recorded. Splitwise emails an address
          that does not have an account. It does not create expenses. Members already recorded are skipped.
        </p>
      ) : null}
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
  const username = venmoPayHandle(snapshot.meta)
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
      {!loading && !error ? <p className="fine-print">{syncedLine(snapshot.meta, false)}</p> : null}
      {loading ? <p className="empty-copy">Loading the Splitwise copy…</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !snapshot.meta?.syncedAt ? (
        <p className="empty-copy">The club group has not been copied yet.</p>
      ) : null}
      {!loading && !error && snapshot.meta?.syncedAt && mine.length === 0 ? (
        <p>
          Your sign-in email is not on the latest Splitwise list. Signing in adds that email to the Cheetahs group
          when Splitwise accepts it. This page reloads the balance after that succeeds.
        </p>
      ) : null}
      {!loading && !error && mine.length > 0 ? (
        <>
          <p className="money-line">
            <span>{balanceWords(net)}</span>
          </p>
          <p className="fine-print">A negative Splitwise balance is what you owe the group.</p>
          {owes > 0 && username ? (
            <>
              <p className="fine-print">{PAY_NOTE}</p>
              <div className="card-actions">
                <VenmoPayLink username={username} amountCents={owes} note={note} />
              </div>
            </>
          ) : null}
          {owes === 0 ? <p className="fine-print">Nothing to pay the club from this balance.</p> : null}
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
  const payHandle = venmoPayHandle(snapshot.meta)
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
        <p className="fine-print">{syncedLine(snapshot.meta, false)}</p>
        <p className="fine-print">
          Each row is that member&apos;s Splitwise balance. Negative means they owe the group.{' '}
          {payHandle ? 'Record a Venmo payment in Splitwise, then refresh.' : 'Record a payment in Splitwise, then refresh.'}{' '}
          There is no &ldquo;I paid&rdquo; button on these rows.
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
                  {owes > 0 && payHandle ? (
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
          Add them to the Splitwise group with the same email they use here. An admin can add every missing club
          email with Add all members to Splitwise. A dummy Splitwise user with no email cannot be matched.
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
          Splitwise&apos;s simplified USD debts.
          {payHandle
            ? " The Venmo button still pays the club handle for the member's net balance, not a personal Venmo."
            : ''}
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
