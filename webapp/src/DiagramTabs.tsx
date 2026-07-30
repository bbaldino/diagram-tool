import { useRef } from 'react'

export function DiagramTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  meta,
}: {
  tabs: { id: string; name: string }[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  meta: { entities: number; groups: number; edges: number } | null
}) {
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const focusAndSelect = (id: string) => {
    onSelect(id)
    tabRefs.current.get(id)?.focus()
  }

  return (
    <div className="tabstrip">
      <div className="tabstrip__tabs">
        <div className="tabstrip__tablist" role="tablist">
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeId
            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el)
                  else tabRefs.current.delete(tab.id)
                }}
                className={`tab${isActive ? ' is-active' : ''}`}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                onClick={() => onSelect(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    onClose(tab.id)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return // let the × button's own keys through
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(tab.id)
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    const next = tabs[index + 1]
                    if (next) focusAndSelect(next.id)
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    const prev = tabs[index - 1]
                    if (prev) focusAndSelect(prev.id)
                  }
                }}
              >
                <span className="tab__label">{tab.name}</span>
                <button
                  type="button"
                  className="tab__close"
                  aria-label={`Close ${tab.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
        <button type="button" className="tabstrip__new" onClick={onNew}>
          +
        </button>
      </div>
      {meta && (
        <div className="tabstrip__meta">
          {(() => {
            const plural = (n: number, one: string) =>
              `${n} ${n === 1 ? one : one + (one.endsWith('y') ? '' : 's')}`
            // entities is irregular: "1 entity" / "2 entities"
            const entities = `${meta.entities} ${meta.entities === 1 ? 'entity' : 'entities'}`
            return `${entities} · ${plural(meta.groups, 'group')} · ${plural(meta.edges, 'edge')}`
          })()}
        </div>
      )}
    </div>
  )
}
