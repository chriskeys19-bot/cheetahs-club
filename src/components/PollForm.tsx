import { useId, useRef, useState, type FormEvent } from 'react'
import { RichTextField } from './RichTextField.tsx'
import { isoToPacificWall, pacificWallToIso } from '../lib/format.ts'
import { createPoll, updatePoll } from '../lib/polls.ts'
import { visibleTextLength } from '../lib/richText.ts'
import type { Poll, PollOption } from '../lib/types.ts'

type DraftOption = { key: string; id: string | null; label: string }

function draftOptions(initial: PollOption[] | undefined): DraftOption[] {
  if (!initial || initial.length === 0) {
    return [
      { key: 'choice-1', id: null, label: '' },
      { key: 'choice-2', id: null, label: '' },
    ]
  }
  return [...initial]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((option) => ({ key: option.id, id: option.id, label: option.label }))
}

export function PollForm({
  initial,
  initialOptions,
  votedOptionIds,
  voteTotal,
  onSaved,
  onCancel,
}: {
  initial?: Poll | null
  initialOptions?: PollOption[]
  votedOptionIds?: string[]
  voteTotal?: number
  onSaved: () => void
  onCancel?: () => void
}) {
  const close = isoToPacificWall(initial?.closes_at ?? null)
  const questionId = useId()
  const sending = useRef(false)
  const [draft, setDraft] = useState(0)
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [questionLength, setQuestionLength] = useState(() => visibleTextLength(initial?.question ?? ''))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [descriptionLength, setDescriptionLength] = useState(() =>
    visibleTextLength(initial?.description ?? ''),
  )
  const [options, setOptions] = useState<DraftOption[]>(() => draftOptions(initialOptions))
  const [closeDate, setCloseDate] = useState(close.date)
  const [closeTime, setCloseTime] = useState(close.time)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const voted = new Set(votedOptionIds ?? [])
  const votes = voteTotal ?? 0

  function setOption(key: string, value: string) {
    setOptions((current) => current.map((item) => (item.key === key ? { ...item, label: value } : item)))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (questionLength < 1 || questionLength > 280 || question.length > 8000) {
      setError('Ask a question up to 280 characters.')
      return
    }
    const labels = options.map((item) => ({ ...item, label: item.label.trim() })).filter((item) => item.label.length > 0)
    if (labels.length < 2) {
      setError('Add at least two choices.')
      return
    }
    if (new Set(labels.map((item) => item.label)).size !== labels.length) {
      setError('Each choice needs its own wording.')
      return
    }
    if (labels.some((item) => item.label.length > 120)) {
      setError('Keep each choice to 120 characters.')
      return
    }
    const removedVoted = initial
      ? (initialOptions ?? []).filter((option) => voted.has(option.id) && !labels.some((item) => item.id === option.id))
      : []
    if (removedVoted.length > 0) {
      setError('A choice that already has votes stays on the poll. Rename it instead of removing it.')
      return
    }
    const hasCloseDate = closeDate.trim().length > 0
    const hasCloseTime = closeTime.trim().length > 0
    if (hasCloseDate !== hasCloseTime) {
      setError('Add both a close date and time, or leave both blank.')
      return
    }
    const closesAt = hasCloseDate ? pacificWallToIso(closeDate, closeTime) : null
    if (hasCloseDate && !closesAt) {
      setError('The close time could not be read.')
      return
    }
    if (descriptionLength > 2000 || description.length > 16000) {
      setError('Shorten the description.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const descriptionValue = descriptionLength > 0 ? description : null
    const message = initial
      ? await updatePoll({
          id: initial.id,
          question,
          description: descriptionValue,
          closes_at: closesAt,
          options: labels.map((item) => ({ id: item.id, label: item.label })),
          votedOptionIds: [...voted],
        })
      : await createPoll({
          question,
          description: descriptionValue,
          closes_at: closesAt,
          options: labels.map((item) => item.label),
        })
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    if (!initial) {
      setQuestion('')
      setQuestionLength(0)
      setDescription('')
      setDescriptionLength(0)
      setOptions(draftOptions(undefined))
      setCloseDate('')
      setCloseTime('')
      setDraft((value) => value + 1)
    }
    onSaved()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">{initial ? 'Edit' : 'New'}</p>
        <h2>{initial ? 'Update this poll' : 'Open a poll'}</h2>
      </div>
      {initial && votes > 0 ? (
        <p className="banner banner-note">
          This poll has {votes} {votes === 1 ? 'vote' : 'votes'}. Renaming a choice keeps those votes. A choice
          that already has votes cannot be removed.
        </p>
      ) : null}
      <RichTextField
        key={`question-${initial?.id ?? 'new'}-${draft}`}
        label="Question"
        initial={draft > 0 ? '' : (initial?.question ?? '')}
        compact
        required
        onChange={(stored, length) => {
          setQuestion(stored)
          setQuestionLength(length)
        }}
      />
      <RichTextField
        key={`detail-${initial?.id ?? 'new'}-${draft}`}
        label="Details"
        initial={draft > 0 ? '' : (initial?.description ?? '')}
        onChange={(stored, length) => {
          setDescription(stored)
          setDescriptionLength(length)
        }}
      />
      <fieldset className="option-set">
        <legend>Choices</legend>
        {options.map((option, index) => {
          const locked = option.id !== null && voted.has(option.id)
          return (
            <div className="option-edit" key={option.key}>
              <label className="sr-only" htmlFor={`${questionId}-option-${option.key}`}>
                Choice {index + 1}
              </label>
              <input
                id={`${questionId}-option-${option.key}`}
                name={`option-${index}`}
                value={option.label}
                onChange={(event) => setOption(option.key, event.target.value)}
                maxLength={120}
                placeholder={`Choice ${index + 1}`}
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setOptions((current) => current.filter((item) => item.key !== option.key))}
                  disabled={locked}
                  title={locked ? 'This choice has votes, so it stays on the poll.' : undefined}
                >
                  Remove
                </button>
              ) : null}
            </div>
          )
        })}
        {options.length < 8 ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() =>
              setOptions((current) => [...current, { key: crypto.randomUUID(), id: null, label: '' }])
            }
          >
            Add a choice
          </button>
        ) : null}
      </fieldset>
      <div className="form-grid two">
        <div>
          <label htmlFor={`${questionId}-close-date`}>Closes (date)</label>
          <input
            id={`${questionId}-close-date`}
            name="closeDate"
            type="date"
            value={closeDate}
            onChange={(event) => setCloseDate(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${questionId}-close-time`}>Closes (Pacific time)</label>
          <input
            id={`${questionId}-close-time`}
            name="closeTime"
            type="time"
            value={closeTime}
            onChange={(event) => setCloseTime(event.target.value)}
          />
        </div>
      </div>
      <div className="composer-row">
        {initial && onCancel ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : (
          <span className="fine-print">Leave the close blank to keep it open until a captain closes it.</span>
        )}
        <button type="submit" className="button button-gold" disabled={busy || questionLength < 1}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Open poll'}
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
