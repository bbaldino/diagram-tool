import { useEffect, useMemo, useRef, useState } from 'react'
import { ICON_BASE } from './graph'
import type { Entity } from './model'

interface Props {
  x: number
  y: number
  entities: Entity[] // already filtered to entities not yet placed in this diagram
  onPlaceEntity: (id: string) => void
  onAddGroup: () => void
  onAddNote: () => void
  onClose: () => void
}

// A small "Add" menu shown where the user double-clicks empty canvas. Group and
// Note create a fresh node; Entity opens a searchable list of catalog entities
// to place (entities are created/managed only on the Entities page).
export function CanvasAddMenu({
  x,
  y,
  entities,
  onPlaceEntity,
  onAddGroup,
  onAddNote,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'root' | 'entity'>('root')
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return entities
    return entities.filter(
      (e) => e.label.toLowerCase().includes(s) || e.id.toLowerCase().includes(s),
    )
  }, [entities, q])

  return (
    <div ref={ref} className="addmenu" style={{ left: x, top: y }}>
      {mode === 'root' ? (
        <>
          <div className="addmenu__title">Add</div>
          <button className="addmenu__item" onClick={() => setMode('entity')}>
            <span className="addmenu__ico">◇</span>
            <span>Entity</span>
            <span className="addmenu__more">›</span>
          </button>
          <button
            className="addmenu__item"
            onClick={() => {
              onAddGroup()
              onClose()
            }}
          >
            <span className="addmenu__ico">▭</span>
            <span>Group</span>
          </button>
          <button
            className="addmenu__item"
            onClick={() => {
              onAddNote()
              onClose()
            }}
          >
            <span className="addmenu__ico">✎</span>
            <span>Note</span>
          </button>
        </>
      ) : (
        <div className="addmenu__entity">
          <input
            autoFocus
            className="addmenu__search"
            placeholder="Search entities…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="addmenu__list">
            {filtered.length === 0 && (
              <div className="addmenu__empty">
                {entities.length === 0 ? 'All entities already placed' : 'No matches'}
              </div>
            )}
            {filtered.map((e) => (
              <button
                key={e.id}
                className="addmenu__row"
                onClick={() => {
                  onPlaceEntity(e.id)
                  onClose()
                }}
              >
                {e.icon ? (
                  <img className="addmenu__row-ico" src={`${ICON_BASE}/${e.icon}.svg`} alt="" />
                ) : (
                  <span className="addmenu__row-ico addmenu__row-ico--ph">
                    {e.label.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="addmenu__row-label">{e.label}</span>
              </button>
            ))}
          </div>
          <button className="addmenu__back" onClick={() => setMode('root')}>
            ‹ Back
          </button>
        </div>
      )}
    </div>
  )
}
