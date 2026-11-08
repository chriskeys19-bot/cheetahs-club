import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_LABEL,
  civilMonth,
  dayButtonLabel,
  dotsForDay,
  formatDayHeading,
  formatMonthTitle,
  groupCalendarItems,
  monthGrid,
  shiftMonth,
  type CalendarItem,
} from '../lib/calendar.ts'
import { loadMonthCalendar } from '../lib/calendarLoad.ts'
import { pacificDateInput } from '../lib/format.ts'
import { resultLabel, resultTagClass } from '../lib/games.ts'
import { WatchVideoLink } from './GameMeta.tsx'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  const path = direction === 'left' ? 'M11.5 3.5 6 9l5.5 5.5' : 'M6.5 3.5 12 9l-5.5 5.5'
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MonthCalendar({ revision }: { revision: number }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const [today, setToday] = useState(() => pacificDateInput())
  const [cursor, setCursor] = useState(() => civilMonth(pacificDateInput()) ?? { year: 2026, month: 11 })
  const [selected, setSelected] = useState(() => pacificDateInput())
  const [items, setItems] = useState<CalendarItem[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const requestKey = `${cursor.year}-${cursor.month}-${revision}-${userId ?? ''}`
  const loading = Boolean(userId) && loadedKey !== requestKey
  const visibleItems = loadedKey === requestKey ? items : []

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const key = requestKey
    loadMonthCalendar(cursor.year, cursor.month, userId).then((result) => {
      if (cancelled) return
      setItems(result.items)
      setError(result.error)
      setLoadedKey(key)
    })
    return () => {
      cancelled = true
    }
  }, [cursor.month, cursor.year, requestKey, userId])

  function shift(delta: number) {
    const next = shiftMonth(cursor.year, cursor.month, delta)
    const cells = monthGrid(next.year, next.month)
    setCursor(next)
    setSelected((day) => {
      if (cells.some((cell) => cell.date === day)) return day
      const todayIso = pacificDateInput()
      if (cells.some((cell) => cell.date === todayIso)) return todayIso
      return cells.find((cell) => cell.inMonth)?.date ?? day
    })
  }

  function goToday() {
    const iso = pacificDateInput()
    const next = civilMonth(iso)
    if (next) setCursor(next)
    if (iso) {
      setToday(iso)
      setSelected(iso)
    }
  }

  return (
    <MonthCalendarView
      year={cursor.year}
      month={cursor.month}
      selected={selected}
      today={today}
      items={visibleItems}
      loading={loading}
      error={loadedKey === requestKey ? error : null}
      onSelect={setSelected}
      onShift={shift}
      onToday={goToday}
    />
  )
}

export function MonthCalendarView({
  year,
  month,
  selected,
  today,
  items,
  loading,
  error,
  onSelect,
  onShift,
  onToday,
}: {
  year: number
  month: number
  selected: string
  today: string
  items: CalendarItem[]
  loading: boolean
  error: string | null
  onSelect: (date: string) => void
  onShift: (delta: number) => void
  onToday: () => void
}) {
  const cells = monthGrid(year, month)
  const grouped = useMemo(() => groupCalendarItems(items), [items])
  const selectedItems = grouped.get(selected) ?? []

  return (
    <div className="calendar-layout">
      <section className="panel calendar-board" aria-labelledby="calendar-month">
        <div className="calendar-toolbar">
          <button type="button" className="calendar-nav" onClick={() => onShift(-1)} aria-label="Previous month">
            <Chevron direction="left" />
          </button>
          <div className="calendar-heading">
            <h2 id="calendar-month">{formatMonthTitle(year, month)}</h2>
            <button type="button" className="text-button" onClick={onToday}>
              Today
            </button>
          </div>
          <button type="button" className="calendar-nav" onClick={() => onShift(1)} aria-label="Next month">
            <Chevron direction="right" />
          </button>
        </div>
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p className="fine-print">Loading this month…</p> : null}
        <ul className="calendar-legend">
          {CALENDAR_KINDS.map((kind) => (
            <li key={kind}>
              <span className={`calendar-dot calendar-dot-${kind}`} aria-hidden="true" />
              {CALENDAR_KIND_LABEL[kind]}
            </li>
          ))}
        </ul>
        <div className="calendar-dow-row" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day} className="calendar-dow">
              {day}
            </span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((cell) => {
            const dayItems = grouped.get(cell.date) ?? []
            const dots = dotsForDay(dayItems)
            const className = [
              'calendar-day',
              cell.inMonth ? '' : 'is-outside',
              cell.date === today ? 'is-today' : '',
              cell.date === selected ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={cell.date}
                type="button"
                className={className}
                data-date={cell.date}
                aria-pressed={cell.date === selected}
                aria-current={cell.date === today ? 'date' : undefined}
                aria-label={dayButtonLabel(cell.date, dayItems.length, cell.date === today)}
                onClick={() => onSelect(cell.date)}
              >
                <span className="calendar-day-num">{cell.day}</span>
                <span className="calendar-dots" aria-hidden="true">
                  {dots.map((kind) => (
                    <span key={kind} className={`calendar-dot calendar-dot-${kind}`} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      <section className="panel calendar-day-card" aria-live="polite" aria-labelledby="calendar-day-heading">
        <h2 id="calendar-day-heading" className="kicker">
          {formatDayHeading(selected)}
        </h2>
        {loading && items.length === 0 ? <p className="empty-copy">Loading this month…</p> : null}
        {!loading && selectedItems.length === 0 ? (
          <p className="empty-copy">Nothing scheduled this day.</p>
        ) : null}
        {selectedItems.length > 0 ? (
          <ul className="calendar-items">
            {selectedItems.map((item) => (
              <li key={item.id} className="calendar-item">
                <p className="calendar-time">{item.timeLabel}</p>
                <h3>
                  <Link to={item.href}>{item.title}</Link>
                </h3>
                {item.venue ? <p>{item.venue}</p> : null}
                <div className="tag-row">
                  <span className="tag tag-navy">{CALENDAR_KIND_LABEL[item.kind]}</span>
                  {item.sideLabel ? <span className="tag">{item.sideLabel}</span> : null}
                </div>
                {item.kit ? <p className="fixture-meta">{item.kit}</p> : null}
                {item.showResult ? (
                  <p className="game-result">
                    <span className={resultTagClass(item.result)}>{resultLabel(item.result)}</span>
                    {item.videoUrl ? <WatchVideoLink href={item.videoUrl} /> : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
