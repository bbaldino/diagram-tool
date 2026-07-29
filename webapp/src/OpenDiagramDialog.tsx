import { useEffect, useMemo, useRef, useState } from 'react'

// "Open diagram" modal (⌘O / File ▸ Open diagram…). A single filterable list
// of diagrams — no All/Recent/Open-tabs sub-tabs and no real thumbnails
// (deferred; see task-4 brief). Single-click selects a row, double-click (or
// the primary button) opens it into a tab.

interface DiagramSummary {
  id: string
  name: string
  entities: number
}

export function OpenDiagramDialog({
  diagrams,
  openTabIds,
  onOpen,
  onNew,
  onImport,
  onClose,
}: {
  diagrams: DiagramSummary[]
  openTabIds: string[]
  onOpen: (id: string) => void
  onNew: () => void
  onImport: () => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => filterRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return diagrams
    return diagrams.filter((d) => d.name.toLowerCase().includes(q))
  }, [diagrams, filter])

  const openSelected = () => {
    if (!selectedId) return
    onOpen(selectedId)
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, onOpen, onClose])

  return (
    <div className="opendlg__scrim" onMouseDown={onClose}>
      <div
        className="opendlg"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="opendlg__title">Open diagram</div>
        <div className="opendlg__filter">
          <span className="opendlg__filter-glyph">⌕</span>
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name…"
          />
        </div>
        <div className="opendlg__list">
          {filtered.map((d) => {
            const selected = d.id === selectedId
            const isOpen = openTabIds.includes(d.id)
            return (
              <div
                key={d.id}
                className={`opendlg__row${selected ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(d.id)}
                onDoubleClick={() => {
                  onOpen(d.id)
                  onClose()
                }}
              >
                <div className="opendlg__thumb" />
                <div className="opendlg__rowbody">
                  <div className="opendlg__name" style={{ fontWeight: selected ? 650 : 600 }}>
                    {d.name}
                  </div>
                  <div className="opendlg__sub">{d.entities} entities</div>
                </div>
                {isOpen && <div className="opendlg__open-chip">open</div>}
              </div>
            )
          })}
        </div>
        <div className="opendlg__footer">
          <div className="opendlg__footer-left">
            <button type="button" className="opendlg__textaction" onClick={onImport}>
              Import JSON…
            </button>
            <button type="button" className="opendlg__textaction" onClick={onNew}>
              New diagram
            </button>
          </div>
          <div className="opendlg__footer-right">
            <button type="button" className="opendlg__btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="opendlg__btn opendlg__btn--primary"
              disabled={!selectedId}
              onClick={openSelected}
            >
              Open in new tab
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
