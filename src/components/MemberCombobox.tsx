import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterByQuery } from '../lib/search.ts'
import { displayName, type ClubMember } from '../lib/types.ts'

function optionLabel(member: ClubMember): string {
  const name = displayName(member, member.email)
  return member.email ? `${name} · ${member.email}` : name
}

export function MemberCombobox({
  id,
  members,
  value,
  onChange,
}: {
  id: string
  members: ClubMember[]
  value: string
  onChange: (memberId: string) => void
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const selected = members.find((member) => member.id === value) ?? null
  const selectedLabel = selected ? optionLabel(selected) : ''
  const editing = draft !== null
  const text = editing ? draft : selectedLabel
  const unchangedSelection = editing && draft === selectedLabel
  const filterText = !editing || unchangedSelection ? '' : draft

  const matches = useMemo(
    () =>
      filterByQuery(members, filterText, (member) => [
        member.full_name,
        member.email,
        displayName(member, member.email),
      ]),
    [members, filterText],
  )
  const safeActive = matches.length === 0 ? 0 : Math.min(active, matches.length - 1)
  const activeMember = matches[safeActive]

  useEffect(() => {
    if (!open) return
    const option = rootRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    option?.scrollIntoView({ block: 'nearest' })
  }, [open, safeActive, filterText])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
      setDraft(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function pick(member: ClubMember) {
    onChange(member.id)
    setDraft(null)
    setOpen(false)
  }

  function clear() {
    onChange('')
    setOpen(true)
    setActive(0)
    rootRef.current?.querySelector('input')?.focus()
    setDraft('')
  }

  return (
    <div className="member-combo" ref={rootRef}>
      <div className="search-control">
        <input
          id={id}
          role="combobox"
          type="text"
          value={text}
          placeholder="Name or email"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeMember ? `${listId}-${activeMember.id}` : undefined}
          onFocus={(event) => {
            setDraft(selectedLabel)
            setOpen(true)
            setActive(Math.max(0, members.findIndex((member) => member.id === value)))
            event.currentTarget.select()
          }}
          onBlur={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && rootRef.current?.contains(next)) return
            if (next) {
              setOpen(false)
              setDraft(null)
            }
          }}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            setOpen(true)
            setActive(0)
            if (next !== selectedLabel) onChange('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) {
                setOpen(true)
                setActive(0)
                return
              }
              setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActive((index) => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              setDraft(null)
              return
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault()
              if (activeMember) pick(activeMember)
            }
          }}
        />
        {text ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear member"
            onPointerDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <ul id={listId} className="combo-list" role="listbox" aria-label="Members">
          {matches.length === 0 ? (
            <li className="combo-empty" role="status">
              No matches.
            </li>
          ) : (
            matches.map((member, index) => {
              const name = displayName(member, member.email)
              return (
                <li key={member.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${member.id}`}
                    role="option"
                    className="combo-option"
                    data-active={index === safeActive ? 'true' : 'false'}
                    aria-selected={member.id === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(member)}
                  >
                    <span className="combo-name">{name}</span>
                    <span className="combo-meta">{member.email ?? 'No email on the account'}</span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
