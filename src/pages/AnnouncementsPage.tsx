import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { AnnouncementForm } from '../components/AnnouncementForm.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { RichText } from '../components/RichText.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { loadAnnouncements, removeAnnouncement, saveAnnouncement } from '../lib/announcements.ts'
import { formatPacific } from '../lib/format.ts'
import { visibleText } from '../lib/richText.ts'
import { canEditItem, canManageClub, type Announcement } from '../lib/types.ts'

export function AnnouncementsPage() {
  const { session, profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const userId = session?.user.id ?? null
  const [rows, setRows] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Announcement | null>(null)

  function canEdit(row: Announcement) {
    return canEditItem(profile?.role, userId, row.created_by)
  }

  useEffect(() => {
    let cancelled = false
    loadAnnouncements().then(({ rows: next, error: nextError }) => {
      if (cancelled) return
      setRows(next)
      setError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  function refresh() {
    setEditing(null)
    setRows(null)
    setError(null)
    setToken((value) => value + 1)
  }

  async function togglePin(row: Announcement) {
    setPendingId(row.id)
    const message = await saveAnnouncement({
      id: row.id,
      title: row.title,
      body: row.body,
      pinned: !row.pinned,
    })
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    setToken((value) => value + 1)
  }

  async function onRemove(row: Announcement) {
    setPendingId(row.id)
    const message = await removeAnnouncement(row.id)
    setPendingId(null)
    setConfirming(null)
    if (message) {
      setError(message)
      return
    }
    if (editing?.id === row.id) setEditing(null)
    setToken((value) => value + 1)
  }

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Club board</p>
        <h1>Announcements</h1>
        <p className="lede">Club-wide notes from captains and admins. Pinned notes stay at the top.</p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins post announcements. You can edit or delete a note you posted.
      </RoleNote>
      <div className="desk-split">
      {staff || editing ? (
        <AnnouncementForm key={editing?.id ?? 'new'} initial={editing} onSaved={refresh} onCancel={() => setEditing(null)} />
      ) : null}
      <section className="panel" aria-labelledby="announcements-heading">
        <div className="section-heading">
          <p className="kicker">Latest</p>
          <h2 id="announcements-heading">The board</h2>
        </div>
        {rows === null && !error ? <p className="empty-copy">Loading announcements…</p> : null}
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {rows && rows.length === 0 && !error ? (
          <p className="empty-copy">No announcements yet.</p>
        ) : null}
        {rows && rows.length > 0 ? (
          <ul className="card-list tiles">
            {rows.map((row) => (
              <li key={row.id} className="info-card">
                <div className="tag-row">
                  {row.pinned ? <span className="tag tag-gold">Pinned</span> : null}
                  <span className="fine-print">{formatPacific(row.created_at)}</span>
                </div>
                <RichText value={row.title} as="h3" />
                <RichText value={row.body} />
                {canEdit(row) ? (
                  <div className="card-actions">
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => togglePin(row)}
                      disabled={pendingId === row.id}
                    >
                      {row.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" className="button button-quiet" onClick={() => setEditing(row)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => setConfirming(row)}
                      disabled={pendingId === row.id}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      </div>
      {confirming ? (
        <ConfirmDialog
          title={`Delete “${visibleText(confirming.title)}”?`}
          body="This note comes off the board for every member."
          confirmLabel="Delete"
          busy={pendingId === confirming.id}
          onCancel={() => {
            if (pendingId !== confirming.id) setConfirming(null)
          }}
          onConfirm={() => onRemove(confirming)}
        />
      ) : null}
    </div>
  )
}
