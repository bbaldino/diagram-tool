import { useEffect, useState } from 'react'
import { ICON_BASE } from './graph'
import { loadIconIndex, searchIcons, moveHighlight, type IconEntry } from './iconIndex'

interface Props {
  value: string | undefined
  onChange: (v: string | undefined) => void
  placeholder?: string
}

export function IconInput({ value, onChange, placeholder }: Props) {
  const [index, setIndex] = useState<IconEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  // Lazily load the icon index the first time the field is focused.
  const ensureIndex = () => {
    if (index === null) void loadIconIndex().then(setIndex)
  }

  const query = value ?? ''
  const matches = index ? searchIcons(index, query) : []
  const loading = open && query.trim() !== '' && index === null
  const showMenu = open && query.trim() !== '' && (loading || matches.length > 0)

  // Reset the keyboard cursor whenever the query changes.
  useEffect(() => setHighlight(-1), [query])

  const pick = (slug: string) => {
    onChange(slug)
    setOpen(false)
  }

  return (
    <div className="iconinput">
      <input
        value={query}
        placeholder={placeholder}
        onFocus={() => {
          ensureIndex()
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let a row click register first
        onChange={(e) => {
          onChange(e.target.value || undefined)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!showMenu) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => moveHighlight(h, matches.length, +1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => moveHighlight(h, matches.length, -1))
          } else if (e.key === 'Enter') {
            if (highlight >= 0 && matches[highlight]) {
              e.preventDefault()
              pick(matches[highlight].slug)
            } else {
              e.preventDefault()
              setOpen(false)
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {showMenu && (
        <div className="iconinput__menu">
          {loading ? (
            <div className="iconinput__loading">loading icons…</div>
          ) : (
            matches.map((m, i) => (
              <button
                type="button"
                key={m.slug}
                className={`iconinput__row ${i === highlight ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} // keep input focus so onBlur doesn't fire before onClick
                onClick={() => pick(m.slug)}
                onMouseEnter={() => setHighlight(i)}
              >
                <img
                  className="iconinput__preview"
                  src={`${ICON_BASE}/${m.slug}.svg`}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
                <span className="iconinput__slug">{m.slug}</span>
                {m.categories[0] ? <span className="iconinput__cat">{m.categories[0]}</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
