import { useMemo, useState } from 'react'
import { ICON_BASE } from './graph'
import type { Entity } from './model'
import { useDialogs } from './Dialog'

interface Props {
  entities: Entity[]
  placedIds: Set<string>
  onPlace: (entityId: string) => void
  onCreate: (entity: Entity) => void
}

function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'entity'
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function Palette({ entities, placedIds, onPlace, onCreate }: Props) {
  const { showPrompt } = useDialogs()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const filtered = useMemo(() => {
    const sorted = [...entities].sort((a, b) => a.label.localeCompare(b.label))
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (e) => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q),
    )
  }, [entities, search])

  const handleCreate = async () => {
    const label = (await showPrompt({ title: 'New entity', label: 'Label', placeholder: 'e.g. Grafana' }))?.trim()
    if (!label) return
    const existingIds = new Set(entities.map((e) => e.id))
    const id = uniqueId(slugify(label), existingIds)
    onCreate({ id, label, fields: [] })
  }

  if (collapsed) {
    return (
      <div className="panel palette palette--collapsed">
        <button onClick={() => setCollapsed(false)}>Palette</button>
      </div>
    )
  }

  return (
    <div className="panel palette">
      <div className="palette__header">
        <h4>Entities</h4>
        <button
          className="palette__collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse palette"
        >
          &minus;
        </button>
      </div>
      <input
        className="palette__search"
        type="text"
        placeholder="Search entities…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="palette__list">
        {filtered.map((e) => {
          const placed = placedIds.has(e.id)
          return (
            <div
              key={e.id}
              className={`palette__row${placed ? ' palette__row--placed' : ''}`}
              onClick={() => {
                if (!placed) onPlace(e.id)
              }}
              title={placed ? `${e.label} — already on this diagram` : `Add ${e.label}`}
            >
              {e.icon ? (
                <img className="palette__icon" src={`${ICON_BASE}/${e.icon}.svg`} alt="" />
              ) : (
                <span className="palette__icon palette__icon--placeholder">
                  {e.label.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="palette__label">{e.label}</span>
              {e.status && <span className={`legend__dot status-${e.status}`} />}
              <span className="palette__marker">{placed ? '✓' : '＋'}</span>
            </div>
          )
        })}
        {filtered.length === 0 && <div className="palette__empty">No entities found</div>}
      </div>
      <button className="palette__new" onClick={handleCreate}>
        ＋ New entity
      </button>
    </div>
  )
}
