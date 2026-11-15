import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { MemberCombobox } from './MemberCombobox.tsx'
import { formatCents } from '../lib/money.ts'
import { loadMembers } from '../lib/members.ts'
import { duesPath, duesUrl, explicitMemoToken, memberBalanceCents, zelleMemo } from '../lib/sheetLedger.ts'
import {
  loadSheetClub,
  removeMemoOverride,
  removeSheetNameMap,
  saveDuesSettings,
  saveMemoOverride,
  saveSheetNameMap,
  sheetSyncedLabel,
  syncFinanceSheet,
  type SheetClubDesk,
} from '../lib/sheetDues.ts'
import type { ClubMember } from '../lib/types.ts'

const emptyDesk: SheetClubDesk = {
  settings: { zelleEmail: 'treasurercheetahscricket@gmail.com', reminderMmdd: '1114' },
  meta: null,
  status: null,
  accounts: [],
  maps: [],
  memos: [],
  roster: [],
}

function personName(members: ClubMember[], rosterName: string | null, id: string): string {
  const member = members.find((row) => row.id === id)
  const named = member?.full_name?.trim() || rosterName?.trim()
  return named || `Member ${id.slice(0, 8)}`
}

export function SheetClubDues({ isAdmin }: { isAdmin: boolean }) {
  const [desk, setDesk] = useState<SheetClubDesk>(emptyDesk)
  const [members, setMembers] = useState<ClubMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [mapMember, setMapMember] = useState('')
  const [memoMember, setMemoMember] = useState('')
  const [memoDraft, setMemoDraft] = useState('')
  const [email, setEmail] = useState(emptyDesk.settings.zelleEmail)
  const [mmdd, setMmdd] = useState(emptyDesk.settings.reminderMmdd)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    Promise.all([loadSheetClub(), isAdmin ? loadMembers() : Promise.resolve({ rows: [], error: null })]).then(
      ([club, memberList]) => {
        if (cancel) return
        setDesk(club.desk)
        setEmail(club.desk.settings.zelleEmail)
        setMmdd(club.desk.settings.reminderMmdd)
        setMembers(
          memberList.rows.length > 0
            ? memberList.rows
            : club.desk.roster.map((row) => ({
                id: row.id,
                full_name: row.fullName,
                email: null,
                role: row.role,
              })),
        )
        setError(club.error ?? memberList.error)
        setLoading(false)
      },
    )
    return () => {
      cancel = true
    }
  }, [isAdmin, token])

  const origin = typeof window === 'undefined' ? 'https://cheetahs-club.pages.dev' : window.location.origin
  const rosterName = new Map(desk.roster.map((row) => [row.id, row.fullName]))
  const byMember = new Map<string, { name: string; accounts: typeof desk.accounts; sheetNames: string[] }>()
  const unlinked: { sheetName: string; balance: number }[] = []
  for (const account of desk.accounts) {
    if (!account.profileId) {
      unlinked.push({ sheetName: account.sheetName, balance: account.balanceDueCents ?? 0 })
      continue
    }
    const current = byMember.get(account.profileId) ?? {
      name: personName(members, rosterName.get(account.profileId) ?? null, account.profileId),
      accounts: [],
      sheetNames: [],
    }
    current.accounts.push(account)
    current.sheetNames.push(account.sheetName)
    byMember.set(account.profileId, current)
  }
  const rows = [...byMember.entries()]
    .map(([id, row]) => ({
      id,
      name: row.name,
      balance: memberBalanceCents(row.accounts),
      sheetNames: row.sheetNames,
    }))
    .sort((left, right) => left.balance - right.balance || left.name.localeCompare(right.name))
  const unmatched = [
    ...new Set([
      ...(desk.status?.unmatchedNames ?? []),
      ...unlinked.map((row) => row.sheetName),
    ]),
  ].sort((left, right) => left.localeCompare(right))
  const memoPreview = zelleMemo(
    personName(members, rosterName.get(memoMember) ?? null, memoMember || 'member'),
    explicitMemoToken(memoDraft),
    mmdd,
  )

  async function run(action: () => Promise<string | null>) {
    if (pending) return
    setPending(true)
    setFormError(null)
    const message = await action()
    setPending(false)
    if (message) {
      setFormError(message)
      return
    }
    setToken((value) => value + 1)
  }

  async function onSync() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    setNotice(null)
    const result = await syncFinanceSheet(false)
    setRefreshing(false)
    if (result.error) setRefreshError(result.error)
    else setNotice(result.notice)
    setToken((value) => value + 1)
  }

  function onSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(() => saveDuesSettings(email, mmdd))
  }

  function onSaveMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      const message = await saveSheetNameMap(sheetName, mapMember)
      if (!message) {
        setSheetName('')
        setMapMember('')
      }
      return message
    })
  }

  function onSaveMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      const message = await saveMemoOverride(memoMember, memoDraft)
      if (!message) setMemoDraft('')
      return message
    })
  }

  return (
    <section className="panel span-all" aria-labelledby="club-sheet-heading">
      <div className="section-heading">
        <p className="kicker">Winter sheet</p>
        <h2 id="club-sheet-heading">Club dues</h2>
      </div>
      <p className="fine-print">
        {sheetSyncedLabel({
          syncedAt: desk.meta?.syncedAt ?? null,
          lastAttemptFailed: desk.meta?.lastAttemptFailed ?? false,
          lastAttemptAt: desk.meta?.lastAttemptAt ?? null,
        })}
      </p>
      <p className="fine-print">
        Each link needs the player to be signed in. A player only sees their own dues. Captains and admins can open
        another member&apos;s link.
      </p>
      {loading ? <p className="empty-copy">Loading the club sheet…</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {desk.status?.syncError ? (
        <p className="banner banner-error" role="alert">
          {desk.status.syncError}
        </p>
      ) : null}
      {refreshError ? (
        <p className="banner banner-error" role="alert">
          {refreshError}
        </p>
      ) : null}
      {notice ? <p className="banner banner-note">{notice}</p> : null}
      {formError ? (
        <p className="banner banner-error" role="alert">
          {formError}
        </p>
      ) : null}
      {isAdmin ? (
        <div className="card-actions">
          <button type="button" className="button button-gold" onClick={() => void onSync()} disabled={refreshing || pending}>
            {refreshing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      ) : null}
      {!loading && rows.length === 0 && unlinked.length === 0 ? (
        <p className="empty-copy">No sheet rows yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="card-list">
          {rows.map((row) => (
            <li key={row.id} className="info-card">
              <h3>
                <Link to={duesPath(row.id)}>{row.name}</Link>
              </h3>
              <p className="money-line">
                <span>Balance due {formatCents(row.balance)}</span>
              </p>
              <p className="fine-print">{row.sheetNames.join(', ')}</p>
              <CopyLink value={duesUrl(origin, row.id)} />
            </li>
          ))}
        </ul>
      ) : null}
      <h3>Names not linked</h3>
      {desk.meta?.syncedAt && unmatched.length === 0 ? (
        <p className="empty-copy">Every sheet name is linked to a member.</p>
      ) : null}
      {unmatched.length > 0 ? (
        <ul className="choice-list">
          {unmatched.map((name) => {
            const row = unlinked.find((item) => item.sheetName === name)
            return (
              <li key={name}>
                {name}
                {row ? ` · balance due ${formatCents(row.balance)}` : ''}
              </li>
            )
          })}
        </ul>
      ) : null}
      {isAdmin ? (
        <form className="composer" onSubmit={onSaveMap}>
          <h3>Link a sheet name</h3>
          <label htmlFor="sheet-name">Name on the sheet</label>
          <input
            id="sheet-name"
            list="unmatched-sheet-names"
            value={sheetName}
            onChange={(event) => setSheetName(event.target.value)}
            required
          />
          <datalist id="unmatched-sheet-names">
            {unmatched.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <label htmlFor="sheet-member">Member</label>
          <MemberCombobox id="sheet-member" members={members} value={mapMember} onChange={setMapMember} />
          <div className="composer-row">
            <button type="submit" className="button button-gold" disabled={pending || !mapMember}>
              {pending ? 'Saving…' : 'Save link'}
            </button>
          </div>
        </form>
      ) : null}
      {desk.maps.length > 0 ? (
        <>
          <h3>Saved links</h3>
          <ul className="choice-list">
            {desk.maps.map((row) => (
              <li key={row.id}>
                {row.sheetName} → {personName(members, rosterName.get(row.profileId) ?? null, row.profileId)}
                {isAdmin ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={pending}
                    onClick={() => void run(() => removeSheetNameMap(row.id))}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {isAdmin ? (
        <form className="composer" onSubmit={onSaveSettings}>
          <h3>Zelle</h3>
          <label htmlFor="zelle-email">Send to</label>
          <input id="zelle-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="reminder-mmdd">Reminder date (MMDD)</label>
          <input
            id="reminder-mmdd"
            inputMode="numeric"
            maxLength={4}
            value={mmdd}
            onChange={(event) => setMmdd(event.target.value)}
            required
          />
          <p className="fine-print">Memos look like CHW26ANMOL{mmdd.trim() || '1114'}.</p>
          <div className="composer-row">
            <button type="submit" className="button button-gold" disabled={pending}>
              {pending ? 'Saving…' : 'Save payment details'}
            </button>
          </div>
        </form>
      ) : null}
      {isAdmin ? (
        <form className="composer" onSubmit={onSaveMemo}>
          <h3>Memo name</h3>
          <p className="fine-print">
            Leave this blank to use the member&apos;s first name. The two Srivatsans use SRIVATSANSR and SRIVATSANSU
            when their full names say so. Save a token here to override that.
          </p>
          <label htmlFor="memo-member">Member</label>
          <MemberCombobox id="memo-member" members={members} value={memoMember} onChange={setMemoMember} />
          <label htmlFor="memo-token">Name in the memo</label>
          <input
            id="memo-token"
            value={memoDraft}
            onChange={(event) => setMemoDraft(event.target.value)}
            placeholder="SRIVATSANSR"
            maxLength={40}
            required
          />
          {memoMember ? <p className="fine-print">Preview {memoPreview}</p> : null}
          <div className="composer-row">
            <button type="submit" className="button button-gold" disabled={pending || !memoMember}>
              {pending ? 'Saving…' : 'Save memo'}
            </button>
          </div>
        </form>
      ) : null}
      {desk.memos.length > 0 ? (
        <>
          <h3>Saved memo names</h3>
          <ul className="choice-list">
            {desk.memos.map((row) => (
              <li key={row.profileId}>
                {personName(members, rosterName.get(row.profileId) ?? null, row.profileId)} · {row.memoToken} ·{' '}
                {zelleMemo(null, row.memoToken, desk.settings.reminderMmdd)}
                {isAdmin ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={pending}
                    onClick={() => void run(() => removeMemoOverride(row.profileId))}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function CopyLink({ value }: { value: string }) {
  const [label, setLabel] = useState('Copy link')
  return (
    <div className="card-actions">
      <code>{value}</code>
      <button
        type="button"
        className="button button-quiet"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => {
              setLabel('Copied')
              window.setTimeout(() => setLabel('Copy link'), 2000)
            },
            () => setLabel('Copy link'),
          )
        }}
      >
        {label}
      </button>
    </div>
  )
}
