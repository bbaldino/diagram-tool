import { useEffect, useRef, useState } from 'react'

interface Props {
  x: number
  y: number
  onCreateEntity: (label: string) => void
  onAddGroup: () => void
  onAddNote: () => void
  onClose: () => void
}

// A small "Add" menu shown where the user double-clicks empty canvas. Group and
// Note create a fresh node; Entity prompts for a label and creates a new ad-hoc
// entity placed at the click point (entities are no longer browsed from a shared
// catalog — creation is ad-hoc-first).
export function CanvasAddMenu({ x, y, onCreateEntity, onAddGroup, onAddNote, onClose }: Props) {
  const [mode, setMode] = useState<'root' | 'entity'>('root')
  const [label, setLabel] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // Capture phase: React Flow's pane runs d3-zoom, which calls
    // stopImmediatePropagation() on the pane's mousedown — so a bubble-phase
    // listener never sees clicks on the canvas. Capturing runs before d3 can
    // stop the event, so clicking anywhere outside the menu (incl. the canvas)
    // dismisses it.
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  const submit = () => {
    const l = label.trim()
    if (!l) return
    onCreateEntity(l)
    onClose()
  }

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
            placeholder="New entity label…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button className="addmenu__item" onClick={submit} disabled={!label.trim()}>
            <span className="addmenu__ico">＋</span>
            <span>Create “{label.trim() || '…'}”</span>
          </button>
          <button className="addmenu__back" onClick={() => setMode('root')}>
            ‹ Back
          </button>
        </div>
      )}
    </div>
  )
}
