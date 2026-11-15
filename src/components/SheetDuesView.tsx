import { useState } from 'react'
import { formatDateOnly } from '../lib/format.ts'
import { formatCents } from '../lib/money.ts'
import { sheetSyncedLabel, type SheetSyncSource } from '../lib/sheetDues.ts'
import { splitwiseSyncSourceLabel } from '../lib/splitwiseSyncLabel.ts'
import {
  chargeGroupHeading,
  duesBalanceStat,
  type ChargeGroup,
  type DuesPaymentStanding,
  type LedgerLine,
  type PaymentTone,
  type PlayerLedger,
} from '../lib/sheetLedger.ts'

function useCopy(value: string): { label: string; onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  return {
    label: copied ? 'Copied' : 'Copy',
    onCopy: () => {
      void navigator.clipboard.writeText(value).then(
        () => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        },
        () => setCopied(false),
      )
    },
  }
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const copy = useCopy(value)
  return (
    <div className="zelle-line">
      <p>
        <span className="fine-print">{label}</span>
        <code>{value}</code>
      </p>
      <button type="button" className="button button-quiet" onClick={copy.onCopy}>
        {copy.label}
      </button>
    </div>
  )
}

function standingClass(tone: PaymentTone): string {
  if (tone === 'pending') return 'tag tag-gold tag-sentence'
  if (tone === 'paid') return 'tag tag-navy tag-sentence'
  return 'tag tag-sentence'
}

function PaymentStanding({ standing, showName }: { standing: DuesPaymentStanding; showName: boolean }) {
  return (
    <article className="info-card">
      {showName ? <h3>{standing.sheetName}</h3> : null}
      {standing.label ? (
        <p className="tag-row">
          <span className={standingClass(standing.tone)}>{standing.label}</span>
          {standing.detail ? <span>{standing.detail}</span> : null}
        </p>
      ) : null}
      {standing.balanceLine ? <p>{standing.balanceLine}</p> : null}
      {standing.notes ? <p>Payment notes: {standing.notes}</p> : null}
    </article>
  )
}

function LineRow({ line }: { line: LedgerLine }) {
  return (
    <li className="dues-line">
      <span className={line.status === 'Paid' ? 'tag tag-navy' : 'tag tag-gold'}>{line.status}</span>
      <span>
        {line.title} · {formatCents(line.amountCents)}
      </span>
    </li>
  )
}

function GroupCard({ group }: { group: ChargeGroup }) {
  return (
    <article className="info-card">
      <h3>{chargeGroupHeading(group)}</h3>
      {group.chargeDate ? <p className="fine-print">{formatDateOnly(group.chargeDate)}</p> : null}
      <ul className="dues-lines">
        {group.lines.map((line) => (
          <LineRow key={line.key} line={line} />
        ))}
      </ul>
    </article>
  )
}

export function SheetDuesView({
  loading,
  error,
  notice,
  memberName,
  ledger,
  syncedAt,
  lastAttemptFailed,
  lastAttemptAt,
  syncSource,
  syncError,
  zelleEmail,
  memo,
  showSync,
  refreshing,
  refreshError,
  onRefresh,
  duesLink,
  wrongLink,
  invalidLink,
  absentLabel = 'Your name is not on the latest club sheet. A captain can link the sheet name to you.',
  headingId = 'sheet-dues-heading',
}: {
  loading: boolean
  error: string | null
  notice: string | null
  memberName: string | null
  ledger: PlayerLedger | null
  syncedAt: string | null
  lastAttemptFailed: boolean
  lastAttemptAt: string | null
  syncSource: SheetSyncSource | null
  syncError: string | null
  zelleEmail: string
  memo: string
  showSync: boolean
  refreshing: boolean
  refreshError: string | null
  onRefresh: (() => void) | null
  duesLink: string | null
  wrongLink: boolean
  invalidLink: boolean
  absentLabel?: string
  headingId?: string
}) {
  const linkCopy = useCopy(duesLink ?? '')
  const sourceLabel = splitwiseSyncSourceLabel(syncSource)
  const clubLines = (ledger?.lines ?? []).filter((line) => line.kind !== 'game')
  const synced = sheetSyncedLabel({ syncedAt, lastAttemptFailed, lastAttemptAt })
  const owed = ledger?.state === 'owed'
  return (
    <section className="panel span-all" aria-labelledby={headingId}>
      <div className="section-heading">
        <p className="kicker">Winter sheet</p>
        <h2 id={headingId}>{memberName ? `${memberName}'s dues` : 'My dues'}</h2>
      </div>
      {wrongLink ? (
        <p className="banner banner-note">This link is for another member. You are seeing your own dues.</p>
      ) : null}
      {invalidLink ? <p className="banner banner-note">That dues link is not a member id.</p> : null}
      {!loading && !error ? <p className="fine-print">{synced}</p> : null}
      {syncedAt && sourceLabel ? <p className="fine-print">{sourceLabel}</p> : null}
      {loading ? <p className="empty-copy">Loading club dues…</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="banner banner-note">{notice}</p> : null}
      {syncError ? (
        <p className="banner banner-error" role="alert">
          {syncError}
        </p>
      ) : null}
      {refreshError ? (
        <p className="banner banner-error" role="alert">
          {refreshError}
        </p>
      ) : null}
      {showSync && onRefresh ? (
        <div className="card-actions">
          <button type="button" className="button button-gold" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      ) : null}
      {!loading && !error && !syncedAt && !ledger?.lines.length ? (
        <p className="empty-copy">Club dues have not been copied from the sheet yet.</p>
      ) : null}
      {ledger && syncedAt && ledger.state === 'absent' ? (
        <p className="empty-copy">{absentLabel}</p>
      ) : null}
      {ledger && ledger.state === 'empty' ? (
        <p className="empty-copy">
          No club charges yet. When the winter sheet has a membership fee or a game for you, it will show up here.
        </p>
      ) : null}
      {ledger && (ledger.state === 'paid' || ledger.state === 'owed') ? (
        <>
          {ledger.clubStatus ? (
            <p className="tag-row">
              <span className="tag tag-navy">{ledger.clubStatus}</span>
            </p>
          ) : null}
          <ul className="stat-grid">
            <li>
              <span>Total paid</span>
              <strong>{formatCents(ledger.totalPaidCents)}</strong>
            </li>
            <li>
              <span>Total unpaid</span>
              <strong>{formatCents(ledger.totalUnpaidCents)}</strong>
            </li>
            <li>
              <span>{duesBalanceStat(ledger.balanceDueCents).label}</span>
              <strong>{duesBalanceStat(ledger.balanceDueCents).value}</strong>
            </li>
          </ul>
          <p className="fine-print">
            This is the sheet total. A negative number is what you owe the club. A positive number is a credit.
          </p>
          {ledger.standings.length > 0 ? (
            <div className="card-list">
              {ledger.standings.map((standing) => (
                <PaymentStanding
                  key={standing.sheetKey}
                  standing={standing}
                  showName={ledger.standings.length > 1}
                />
              ))}
            </div>
          ) : ledger.paymentNotes ? (
            <p>Payment notes: {ledger.paymentNotes}</p>
          ) : null}
          {ledger.gapCents !== 0 ? (
            <p className="fine-print">
              The lines below and the sheet balance differ by {formatCents(Math.abs(ledger.gapCents))}. The balance due
              above is the sheet total.
            </p>
          ) : null}
          {ledger.state === 'paid' ? (
            <p className="banner banner-success">
              All paid, thank you.
              {ledger.creditCents > 0 ? ` You have a credit of ${formatCents(ledger.creditCents)}.` : ''}
            </p>
          ) : null}
          {owed ? (
            <div className="zelle-box">
              <h3>Pay by Zelle</h3>
              <p>Send {formatCents(ledger.owedCents)}. Put the memo on the payment so it matches your dues.</p>
              <CopyLine label="Send to" value={zelleEmail} />
              <CopyLine label="Memo" value={memo} />
            </div>
          ) : null}
          {clubLines.length > 0 ? (
            <article className="info-card">
              <h3>Club fees</h3>
              <ul className="dues-lines">
                {clubLines.map((line) => (
                  <LineRow key={line.key} line={line} />
                ))}
              </ul>
            </article>
          ) : null}
          {ledger.groups.length > 0 ? (
            <div className="card-list">
              {ledger.groups.map((group) => (
                <GroupCard key={group.key} group={group} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {duesLink ? (
        <div className="zelle-line">
          <p>
            <span className="fine-print">Dues link</span>
            <code>{duesLink}</code>
          </p>
          <button type="button" className="button button-quiet" onClick={linkCopy.onCopy}>
            {linkCopy.label}
          </button>
        </div>
      ) : null}
    </section>
  )
}
