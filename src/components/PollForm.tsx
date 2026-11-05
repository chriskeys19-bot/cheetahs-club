import { useId, useRef, useState, type FormEvent } from 'react'
import { pacificWallToIso } from '../lib/format.ts'
import { createPoll } from '../lib/polls.ts'

export function PollForm({ onCreated }: { onCreated: () => void }) {
  const questionId = useId()
  const sending = useRef(false)
  const [question, setQuestion] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [closeDate, setCloseDate] = useState('')
  const [closeTime, setCloseTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextQuestion = question.trim()
    if (nextQuestion.length < 1 || nextQuestion.length > 280) {
      setError('Ask a question up to 280 characters.')
      return
    }
    const labels = options.map((item) => item.trim()).filter((item) => item.length > 0)
    if (labels.length < 2) {
      setError('Add at least two choices.')
      return
    }
    if (new Set(labels).size !== labels.length) {
      setError('Each choice needs its own wording.')
      return
    }
    if (labels.some((label) => label.length > 120)) {
      setError('Keep each choice to 120 characters.')
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
    const nextDescription = description.trim()
    if (nextDescription.length > 2000) {
      setError('Shorten the description.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await createPoll({
      question: nextQuestion,
      description: nextDescription.length > 0 ? nextDescription : null,
      closes_at: closesAt,
      options: labels,
    })
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setQuestion('')
    setDescription('')
    setOptions(['', ''])
    setCloseDate('')
    setCloseTime('')
    onCreated()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">New</p>
        <h2>Open a poll</h2>
      </div>
      <label htmlFor={questionId}>Question</label>
      <input
        id={questionId}
        name="question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        maxLength={280}
        required
      />
      <label htmlFor={`${questionId}-detail`}>Details</label>
      <textarea
        id={`${questionId}-detail`}
        name="description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={2000}
        rows={3}
      />
      <fieldset className="option-set">
        <legend>Choices</legend>
        {options.map((option, index) => (
          <div className="option-edit" key={index}>
            <label className="sr-only" htmlFor={`${questionId}-option-${index}`}>
              Choice {index + 1}
            </label>
            <input
              id={`${questionId}-option-${index}`}
              name={`option-${index}`}
              value={option}
              onChange={(event) => setOption(index, event.target.value)}
              maxLength={120}
              placeholder={`Choice ${index + 1}`}
            />
            {options.length > 2 ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {options.length < 8 ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setOptions((current) => [...current, ''])}
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
        <span className="fine-print">Leave the close blank to keep it open until a captain closes it.</span>
        <button type="submit" className="button button-gold" disabled={busy || question.trim().length < 1}>
          {busy ? 'Opening…' : 'Open poll'}
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
