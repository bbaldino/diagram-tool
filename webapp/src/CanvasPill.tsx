import { useEffect, useRef, useState } from 'react'

interface Engine {
  id: string
  label: string
}

interface Props {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onTidy: () => void
  engine: string
  engines: Engine[]
  onChooseEngine: (id: string) => void
  onReRun: () => void
}

// The floating canvas pill: the five commands used often enough to live on
// the canvas itself (Undo, Redo, Tidy, Auto-layout ▾). Everything else lives
// in the menu bar. Disabled controls grey out rather than disappear so the
// pill never changes width. Positioning (absolute, top-centered) is the
// mounting parent's job — this component is just a self-sized flex row.
export function CanvasPill({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTidy,
  engine,
  engines,
  onChooseEngine,
  onReRun,
}: Props) {
  const [layoutOpen, setLayoutOpen] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!layoutOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLayoutOpen(false)
    }
    // Capture phase: React Flow's pane runs d3-zoom, which calls
    // stopImmediatePropagation() on the pane's mousedown — a bubble-phase
    // listener never sees clicks on the canvas. Capturing runs before d3 can
    // stop the event (mirrors MenuBar / CanvasAddMenu's dismiss pattern).
    const onDown = (e: MouseEvent) => {
      if (layoutRef.current && !layoutRef.current.contains(e.target as Node)) {
        setLayoutOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [layoutOpen])

  const chooseEngine = (id: string) => {
    onChooseEngine(id)
    setLayoutOpen(false)
  }

  const reRun = () => {
    onReRun()
    setLayoutOpen(false)
  }

  return (
    <div className="pill">
      <button
        type="button"
        className="pill__btn"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
      >
        <span>↶</span>
      </button>
      <button
        type="button"
        className="pill__btn"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
      >
        <span>↷</span>
      </button>
      <div className="pill__divider" />
      <button type="button" className="pill__text" onClick={onTidy}>
        <span className="pill__text-icon">◫</span>
        <span>Tidy</span>
      </button>
      <div className="pill__layoutwrap" ref={layoutRef}>
        <button
          type="button"
          className={`pill__text${layoutOpen ? ' is-open' : ''}`}
          onClick={() => setLayoutOpen((v) => !v)}
        >
          <span>Auto-layout</span>
          <span className="pill__caret">▾</span>
        </button>
        {layoutOpen && (
          <div className="menu pill__menu" role="menu">
            {engines.map((e) => (
              <div
                key={e.id}
                className="menu__item"
                role="menuitem"
                onClick={() => chooseEngine(e.id)}
              >
                <span className="menu__check">{e.id === engine ? '✓' : ''}</span>
                <span className="menu__label">{e.label}</span>
              </div>
            ))}
            <div className="menu__sep" />
            <div className="menu__item" role="menuitem" onClick={reRun}>
              <span className="menu__label">Re-run layout</span>
              <span className="menu__shortcut">⌘⇧L</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
