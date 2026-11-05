import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { PollForm } from '../components/PollForm.tsx'
import { RoleNote } from '../components/RoleNote.tsx'
import { formatPacific } from '../lib/format.ts'
import { castVote, loadPollBoard, pollIsOpen, removePoll, setPollStatus, type PollBoard } from '../lib/polls.ts'
import { canManageClub, type Poll, type PollOption } from '../lib/types.ts'

const emptyBoard: PollBoard = { polls: [], options: [], votes: new Map(), tallies: [] }

export function PollsPage() {
  const { session, profile, profileReady } = useAuth()
  const staff = canManageClub(profile?.role)
  const [board, setBoard] = useState<PollBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [asOf, setAsOf] = useState<number | null>(null)

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    let cancelled = false
    loadPollBoard(userId).then(({ board: next, error: nextError }) => {
      if (cancelled) return
      setBoard(next)
      setError(nextError)
      setAsOf(Date.now())
      const seeded: Record<string, string> = {}
      for (const [pollId, optionId] of next.votes) seeded[pollId] = optionId
      setChoices(seeded)
    })
    return () => {
      cancelled = true
    }
  }, [session, token])

  function refresh() {
    setBoard(null)
    setError(null)
    setToken((value) => value + 1)
  }

  const grouped = useMemo(() => {
    const options = new Map<string, PollOption[]>()
    for (const option of board?.options ?? []) {
      const list = options.get(option.poll_id) ?? []
      list.push(option)
      options.set(option.poll_id, list)
    }
    const counts = new Map<string, number>()
    for (const tally of board?.tallies ?? []) counts.set(tally.option_id, tally.votes)
    const open: Poll[] = []
    const closed: Poll[] = []
    for (const poll of board?.polls ?? []) {
      if (pollIsOpen(poll)) open.push(poll)
      else closed.push(poll)
    }
    return { options, counts, open, closed }
  }, [board])

  async function onVote(poll: Poll) {
    const userId = session?.user.id
    const optionId = choices[poll.id]
    if (!userId || !optionId) return
    setPendingId(poll.id)
    const message = await castVote({
      pollId: poll.id,
      optionId,
      voterId: userId,
      existing: board?.votes.has(poll.id) ?? false,
    })
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    refresh()
  }

  async function onStatus(poll: Poll, status: 'open' | 'closed') {
    setPendingId(poll.id)
    const message = await setPollStatus(poll.id, status)
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    refresh()
  }

  async function onRemove(poll: Poll) {
    if (!window.confirm(`Remove “${poll.question}”? Votes go with it.`)) return
    setPendingId(poll.id)
    const message = await removePoll(poll.id)
    setPendingId(null)
    if (message) {
      setError(message)
      return
    }
    refresh()
  }

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Club vote</p>
        <h1>Polls</h1>
        <p className="lede">One vote per member while a poll is open. Counts stay visible.</p>
      </header>
      <RoleNote ready={profileReady} restricted={!staff}>
        Captains and admins open and close polls. Every member can vote.
      </RoleNote>
      {staff ? <PollForm onCreated={refresh} /> : null}
      {board === null && !error ? <p className="empty-copy">Loading polls…</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {board && grouped.open.length === 0 && grouped.closed.length === 0 && !error ? (
        <section className="panel">
          <p className="empty-copy">No polls yet.</p>
        </section>
      ) : null}
      {grouped.open.length > 0 ? (
        <PollSection
          heading="Open"
          polls={grouped.open}
          options={grouped.options}
          counts={grouped.counts}
          votes={board?.votes ?? emptyBoard.votes}
          choices={choices}
          asOf={asOf ?? 0}
          staff={staff}
          pendingId={pendingId}
          onChoose={(pollId, optionId) => setChoices((current) => ({ ...current, [pollId]: optionId }))}
          onVote={onVote}
          onStatus={onStatus}
          onRemove={onRemove}
        />
      ) : null}
      {grouped.closed.length > 0 ? (
        <PollSection
          heading="Closed"
          polls={grouped.closed}
          options={grouped.options}
          counts={grouped.counts}
          votes={board?.votes ?? emptyBoard.votes}
          choices={choices}
          asOf={asOf ?? 0}
          staff={staff}
          pendingId={pendingId}
          onChoose={(pollId, optionId) => setChoices((current) => ({ ...current, [pollId]: optionId }))}
          onVote={onVote}
          onStatus={onStatus}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  )
}

function PollSection({
  heading,
  polls,
  options,
  counts,
  votes,
  choices,
  asOf,
  staff,
  pendingId,
  onChoose,
  onVote,
  onStatus,
  onRemove,
}: {
  heading: string
  polls: Poll[]
  options: Map<string, PollOption[]>
  counts: Map<string, number>
  votes: Map<string, string>
  choices: Record<string, string>
  asOf: number
  staff: boolean
  pendingId: string | null
  onChoose: (pollId: string, optionId: string) => void
  onVote: (poll: Poll) => void
  onStatus: (poll: Poll, status: 'open' | 'closed') => void
  onRemove: (poll: Poll) => void
}) {
  const headingId = `${heading.toLowerCase()}-polls`
  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="section-heading">
        <p className="kicker">Ballots</p>
        <h2 id={headingId}>{heading}</h2>
      </div>
      <ul className="card-list tiles">
        {polls.map((poll) => {
          const choicesForPoll = options.get(poll.id) ?? []
          const total = choicesForPoll.reduce((sum, option) => sum + (counts.get(option.id) ?? 0), 0)
          const open = pollIsOpen(poll, asOf)
          const mine = votes.get(poll.id) ?? null
          const selected = choices[poll.id] ?? mine ?? ''
          const canReopen =
            poll.status === 'closed' && (!poll.closes_at || new Date(poll.closes_at).getTime() > asOf)
          return (
            <li key={poll.id} className="info-card">
              <div className="tag-row">
                <span className={open ? 'tag tag-gold' : 'tag'}>{open ? 'Open' : 'Closed'}</span>
                <span className="fine-print">{total} {total === 1 ? 'vote' : 'votes'}</span>
              </div>
              <h3>{poll.question}</h3>
              {poll.description ? <p className="feedback-body">{poll.description}</p> : null}
              {poll.closes_at ? <p className="fine-print">Closes {formatPacific(poll.closes_at)}</p> : null}
              <ul className="choice-list">
                {choicesForPoll.map((option) => {
                  const votesForOption = counts.get(option.id) ?? 0
                  const width = total > 0 ? Math.round((votesForOption / total) * 100) : 0
                  return (
                    <li key={option.id}>
                      <label className="choice">
                        {open ? (
                          <input
                            type="radio"
                            name={`poll-${poll.id}`}
                            value={option.id}
                            checked={selected === option.id}
                            onChange={() => onChoose(poll.id, option.id)}
                          />
                        ) : null}
                        <span className="choice-copy">
                          <span>
                            {option.label}
                            {mine === option.id ? ' · Your vote' : ''}
                          </span>
                          <span className="fine-print">{votesForOption}</span>
                        </span>
                      </label>
                      <span className="tally" aria-hidden="true">
                        <span style={{ width: `${width}%` }} />
                      </span>
                    </li>
                  )
                })}
              </ul>
              <div className="card-actions">
                {open ? (
                  <button
                    type="button"
                    className="button button-gold"
                    onClick={() => onVote(poll)}
                    disabled={pendingId === poll.id || selected.length === 0}
                  >
                    {pendingId === poll.id ? 'Saving…' : mine ? 'Update vote' : 'Vote'}
                  </button>
                ) : null}
                {staff && open ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onStatus(poll, 'closed')}
                    disabled={pendingId === poll.id}
                  >
                    Close
                  </button>
                ) : null}
                {staff && canReopen ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onStatus(poll, 'open')}
                    disabled={pendingId === poll.id}
                  >
                    Reopen
                  </button>
                ) : null}
                {staff ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onRemove(poll)}
                    disabled={pendingId === poll.id}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
