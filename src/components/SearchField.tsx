export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="search-field">
      <label htmlFor={id}>{label}</label>
      <div className="search-control">
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
        />
        {value ? (
          <button type="button" className="search-clear" onClick={() => onChange('')} aria-label={`Clear ${label}`}>
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
