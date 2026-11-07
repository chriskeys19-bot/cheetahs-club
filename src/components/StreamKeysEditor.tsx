import { useEffect, useState } from 'react'
import { loadAllStreamKeys, removeStreamKey, saveStreamKey } from '../lib/streams.ts'
import type { StreamKey } from '../lib/streamStatus.ts'

export function StreamKeysEditor() {
  const [keys, setKeys] = useState<StreamKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)

  async function refresh() {
    const next = await loadAllStreamKeys()
    setKeys(next.keys)
    setError(next.error)
  }

  useEffect(() => {
    let cancelled = false
    loadAllStreamKeys().then((next) => {
      if (cancelled) return
      setKeys(next.keys)
      setError(next.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function addKey() {
    setPending(true)
    setError(null)
    const sortOrder = (keys ?? []).reduce((max, key) => Math.max(max, key.sort_order), 0) + 1
    const message = await saveStreamKey({ name, active: true, sortOrder })
    setPending(false)
    if (message) {
      setError(message)
      return
    }
    setName('')
    await refresh()
  }

  async function rename(key: StreamKey, nextName: string) {
    if (nextName.trim() === key.name) return
    setPending(true)
    const message = await saveStreamKey({
      id: key.id,
      name: nextName,
      active: key.active,
      sortOrder: key.sort_order,
    })
    setPending(false)
    if (message) setError(message)
    await refresh()
  }

  async function toggle(key: StreamKey) {
    setPending(true)
    const message = await saveStreamKey({
      id: key.id,
      name: key.name,
      active: !key.active,
      sortOrder: key.sort_order,
    })
    setPending(false)
    if (message) setError(message)
    await refresh()
  }

  async function remove(key: StreamKey) {
    if (!window.confirm(`Remove the stream key name “${key.name}”? The key value is not stored.`)) return
    setPending(true)
    const message = await removeStreamKey(key.id)
    setPending(false)
    if (message) setError(message)
    await refresh()
  }

  return (
    <section className="panel" aria-labelledby="stream-keys-heading">
      <div className="section-heading">
        <p className="kicker">Broadcasts</p>
        <h2 id="stream-keys-heading">Stream keys</h2>
      </div>
      <p className="lede">Names only. The key itself stays on the Yolobox and is never saved here.</p>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {keys === null && !error ? <p className="empty-copy">Loading stream keys…</p> : null}
      {keys && keys.length === 0 ? <p className="empty-copy">No stream keys yet.</p> : null}
      {keys && keys.length > 0 ? (
        <ul className="card-list">
          {keys.map((key) => (
            <li key={key.id} className="info-card">
              <form
                className="stream-key-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  const nextName = String(data.get('name') ?? '')
                  void rename(key, nextName)
                }}
              >
                <label className="sr-only" htmlFor={`stream-key-${key.id}`}>
                  Key name
                </label>
                <input id={`stream-key-${key.id}`} name="name" defaultValue={key.name} maxLength={80} />
                <div className="stream-field-actions">
                  <button type="submit" className="button button-quiet" disabled={pending}>
                    Rename
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => void toggle(key)} disabled={pending}>
                    {key.active ? 'Hide' : 'Show'}
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => void remove(key)} disabled={pending}>
                    Remove
                  </button>
                </div>
              </form>
              <p className="fine-print">{key.active ? 'Shown in the game pop-up' : 'Hidden from the game pop-up'}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void addKey()
        }}
      >
        <label>
          New key name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <button type="submit" className="button button-gold" disabled={pending || name.trim().length === 0}>
          Add key name
        </button>
      </form>
    </section>
  )
}
