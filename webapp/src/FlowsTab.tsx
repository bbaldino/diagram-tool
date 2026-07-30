import { useEffect, useRef, useState } from 'react'
import type { Flow, FlowStep } from './model'

type FlowMenuTarget = { flowId: string; x: number; y: number } | null

// Small in-app "⋯" popover offering Rename/Duplicate/Delete for a single flow.
// Reused for both the per-row menu (flow list) and the footer menu (current flow).
function FlowMenu({
  containerRef,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: {
  // Ref to the wrapper that contains BOTH the "⋯" trigger button and this
  // popover (mirrors MenuBar.tsx's rootRef shape). Anchoring outside-click
  // detection to that wider wrapper — rather than to this popover alone —
  // means a re-click on the trigger itself counts as "inside": the capture
  // mousedown listener below leaves the menu open, and the trigger's own
  // onClick toggle is what closes it. Without this, the mousedown listener
  // would close the menu first (since the button is outside the popover),
  // and then the button's click would immediately reopen it.
  containerRef: React.RefObject<HTMLElement | null>
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Capture phase: mirrors MenuBar/CanvasAddMenu's outside-click dismiss so
    // this also closes when the click lands on the React Flow pane (d3-zoom
    // stops propagation on the pane's mousedown before a bubble listener runs).
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [containerRef, onClose])

  return (
    <div
      className="menu flowstab__menu"
      role="menu"
      // Stops item clicks from bubbling into an ancestor row's onClick (which
      // would otherwise also fire onSelectFlow as a side effect of choosing
      // Rename/Duplicate/Delete on a non-active row). Harmless for the footer
      // menu, which has no clickable ancestor to guard against.
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="menu__item"
        onClick={() => {
          onRename()
          onClose()
        }}
      >
        <span className="menu__label">Rename…</span>
      </div>
      <div
        className="menu__item"
        onClick={() => {
          onDuplicate()
          onClose()
        }}
      >
        <span className="menu__label">Duplicate</span>
      </div>
      <div
        className="menu__item is-danger"
        onClick={() => {
          onDelete()
          onClose()
        }}
      >
        <span className="menu__label">Delete…</span>
      </div>
    </div>
  )
}

export function FlowsTab({
  flows,
  currentFlowId,
  currentFlow,
  mode,
  selStep,
  currentStep,
  onSelStep,
  onSelectFlow,
  onCreateFlow,
  onRenameFlow,
  onDuplicateFlow,
  onDeleteFlow,
  onStepsChange,
  newStepId,
  onPlay,
  onStop,
  chipLabel,
}: {
  flows: Flow[]
  currentFlowId: string | null
  currentFlow: Flow | null
  mode: 'none' | 'edit' | 'play'
  selStep: number
  currentStep: number
  onSelStep: (i: number) => void
  onSelectFlow: (id: string) => void
  onCreateFlow: () => void
  onRenameFlow: (id: string) => void
  onDuplicateFlow: (id: string) => void
  onDeleteFlow: (id: string) => void
  onStepsChange: (steps: FlowStep[]) => void
  newStepId: () => string
  onPlay: () => void
  onStop: () => void
  chipLabel: (elementId: string) => string
}) {
  const [rowMenu, setRowMenu] = useState<FlowMenuTarget>(null)
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  // Only one row/footer menu can be open at a time, so a single shared ref
  // per trigger kind is enough — it's attached to whichever wrapper is
  // currently rendered with its menu open.
  const rowMenuWrapRef = useRef<HTMLDivElement>(null)
  const footerMenuWrapRef = useRef<HTMLDivElement>(null)

  const steps = currentFlow?.steps ?? []
  // During playback the app advances `currentStep` (arrow-key stepping),
  // not `selStep` (which only moves via explicit edit-mode clicks) — so the
  // expanded/selected step card must track whichever index is live for the
  // current mode, matching App's existing `mode === 'edit' ? selStep : currentStep`
  // convention.
  const activeStep = mode === 'play' ? currentStep : selStep

  const setStep = (i: number, patch: Partial<FlowStep>) => {
    onStepsChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const moveStep = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const next = steps.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onStepsChange(next)
  }

  const addStep = () => {
    onStepsChange([...steps, { id: newStepId(), elementIds: [], caption: '' }])
    onSelStep(steps.length)
  }

  const removeChip = (i: number, id: string) => {
    setStep(i, { elementIds: steps[i].elementIds.filter((x) => x !== id) })
  }

  const renderFlowRow = (f: Flow) => {
    const isActive = f.id === currentFlowId
    const menuOpen = rowMenu?.flowId === f.id
    return (
      <div
        key={f.id}
        className={`flowstab__row${isActive ? ' is-active' : ''}`}
        onMouseEnter={() => setHoverRow(f.id)}
        onMouseLeave={() => setHoverRow((h) => (h === f.id ? null : h))}
        onClick={() => onSelectFlow(f.id)}
      >
        <span className={`flowstab__row-arrow${isActive ? ' is-active' : ''}`}>▶</span>
        <span className="flowstab__row-name">{f.name}</span>
        <span className="flowstab__row-count">{f.steps.length} steps</span>
        {(hoverRow === f.id || menuOpen) && (
          // Wraps both the trigger and its popover so outside-click detection
          // (inside FlowMenu) treats the trigger as "inside" — see FlowMenu's
          // containerRef doc comment.
          <div className="flowstab__morewrap" ref={menuOpen ? rowMenuWrapRef : undefined}>
            <button
              className="flowstab__row-more"
              onClick={(e) => {
                e.stopPropagation()
                setRowMenu((cur) => (cur?.flowId === f.id ? null : { flowId: f.id, x: 0, y: 0 }))
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <FlowMenu
                containerRef={rowMenuWrapRef}
                onRename={() => onRenameFlow(f.id)}
                onDuplicate={() => onDuplicateFlow(f.id)}
                onDelete={() => onDeleteFlow(f.id)}
                onClose={() => setRowMenu(null)}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  const flowList = (
    <div className="flowstab__list">
      {flows.map(renderFlowRow)}
      <div className="flowstab__new" onClick={onCreateFlow}>
        + New flow
      </div>
    </div>
  )

  if (!currentFlow) {
    return (
      <div className="flowstab">
        {flowList}
        <div className="flowstab__empty">
          <div className="flowstab__empty-tile">▶</div>
          <div className="flowstab__empty-title">No flow selected</div>
          <div className="flowstab__empty-body">
            {flows.length === 0
              ? 'No flows yet.'
              : 'Pick a flow above to see and edit its steps, or create one to walk through a path in this diagram.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flowstab">
      {flowList}
      <div className="flowstab__steps">
        <div className="flowstab__steps-head">
          <span className="flowstab__steps-label">Steps · {currentFlow.name}</span>
          <span className="flowstab__reorder" onClick={() => setReorderMode((r) => !r)}>
            Reorder
          </span>
        </div>
        <div className="flowstab__steplist">
          {steps.map((s, i) => {
            const isSel = i === activeStep
            return isSel ? (
              <div key={s.id} className="flowstab__step is-sel">
                <div className="flowstab__step-head">
                  <span className="flowstab__step-idx">{i + 1}</span>
                  <input
                    className="flowstab__step-title"
                    value={s.caption ?? ''}
                    placeholder="caption…"
                    onChange={(e) => setStep(i, { caption: e.target.value })}
                  />
                  {reorderMode && (
                    <span className="flowstab__step-reorder">
                      <button
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveStep(i, -1)
                        }}
                      >
                        ↑
                      </button>
                      <button
                        disabled={i === steps.length - 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveStep(i, 1)
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                  <span className="flowstab__step-drag">⋮</span>
                </div>
                <div className="flowstab__step-body">
                  {s.elementIds.map((id) => (
                    <span key={id} className="flowstab__chip">
                      {chipLabel(id)}
                      <button className="flowstab__chip-x" onClick={() => removeChip(i, id)}>
                        ×
                      </button>
                    </span>
                  ))}
                  <span className="flowstab__addchip">+ click canvas</span>
                </div>
              </div>
            ) : (
              <div
                key={s.id}
                className="flowstab__step"
                onClick={() => onSelStep(i)}
              >
                <span className="flowstab__step-idx flowstab__step-idx--muted">{i + 1}</span>
                <span className="flowstab__step-title-view">
                  {s.caption || '(no caption)'}
                </span>
                {reorderMode && (
                  <span className="flowstab__step-reorder">
                    <button
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveStep(i, -1)
                      }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={i === steps.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveStep(i, 1)
                      }}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            )
          })}
          <div className="flowstab__addstep" onClick={addStep}>
            + Add step
          </div>
        </div>
      </div>
      <div className="flowstab__footer">
        {mode === 'play' ? (
          <button className="flowstab__play" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="flowstab__play" onClick={onPlay}>
            ▶ Play flow
          </button>
        )}
        <div className="flowstab__morewrap" ref={footerMenuOpen ? footerMenuWrapRef : undefined}>
          <button
            className="flowstab__more"
            onClick={() => setFooterMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {footerMenuOpen && currentFlowId && (
            <FlowMenu
              containerRef={footerMenuWrapRef}
              onRename={() => onRenameFlow(currentFlowId)}
              onDuplicate={() => onDuplicateFlow(currentFlowId)}
              onDelete={() => onDeleteFlow(currentFlowId)}
              onClose={() => setFooterMenuOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
