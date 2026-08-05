import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Flow, FlowStep } from '../shared/model'

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
  // The panel is 160px wide (see .flowstab__menu) and, left unflipped, opens
  // rightward from the trigger's left edge — fine for rows near the left of
  // the rail, but this rail is docked at the right of the viewport, so most
  // triggers sit close enough to the right edge that the panel would run off
  // screen. Measure once on open and flip to right-edge anchoring (opens
  // leftward) when there isn't roughly the panel's own width of room left.
  const [flipLeft, setFlipLeft] = useState(false)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const MENU_WIDTH = 160
    setFlipLeft(window.innerWidth - rect.left < MENU_WIDTH)
  }, [containerRef])

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
      className={`menu flowstab__menu${flipLeft ? ' flowstab__menu--left' : ''}`}
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
    // Keep the highlight on the step object that moved, not the fixed index
    // — otherwise the card you were editing collapses and a different step
    // expands in its place after a reorder.
    if (activeStep === i) onSelStep(j)
    else if (activeStep === j) onSelStep(i)
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

  const walkHeader = currentFlow && (
    <div className="flowstab__walkhead">
      <span className="flowstab__walkhead-arrow">▶</span>
      <span className="flowstab__walkhead-name">{currentFlow.name}</span>
      <span className="flowstab__walkhead-chip">
        Step {currentStep + 1} / {steps.length}
      </span>
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
      {mode === 'play' ? walkHeader : flowList}
      <div className="flowstab__steps">
        {mode !== 'play' && (
          <div className="flowstab__steps-head">
            <span className="flowstab__steps-label">Steps · {currentFlow.name}</span>
            {/* Editing affordance only — locked out during Play (see mode-gated
                reorder controls below). */}
            {mode === 'edit' && (
              <span className="flowstab__reorder" onClick={() => setReorderMode((r) => !r)}>
                Reorder
              </span>
            )}
          </div>
        )}
        <div className="flowstab__steplist">
          {steps.map((s, i) => {
            const isSel = i === activeStep
            // Step editing (caption input, chip removal, reorder) is locked
            // during Play — the step list stays navigable (onSelStep still
            // fires below) but nothing here is mutable while a flow is
            // running.
            const canEdit = mode === 'edit'
            const done = mode === 'play' && i < currentStep
            return isSel ? (
              <div key={s.id} className="flowstab__step is-sel">
                <div className="flowstab__step-head">
                  <span className="flowstab__step-idx">{i + 1}</span>
                  {canEdit ? (
                    <input
                      className="flowstab__step-title"
                      value={s.caption ?? ''}
                      placeholder="caption…"
                      onChange={(e) => setStep(i, { caption: e.target.value })}
                    />
                  ) : (
                    <span className="flowstab__step-title-view">{s.caption || '(no caption)'}</span>
                  )}
                  {canEdit && reorderMode && (
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
                  {mode === 'play' && i === currentStep && (
                    <span className="flowstab__step-now">▶</span>
                  )}
                </div>
                <div className="flowstab__step-body">
                  {s.elementIds.map((id) => (
                    <span key={id} className="flowstab__chip">
                      {chipLabel(id)}
                      {canEdit && (
                        <button className="flowstab__chip-x" onClick={() => removeChip(i, id)}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {canEdit && <span className="flowstab__addchip">+ click canvas</span>}
                </div>
              </div>
            ) : (
              <div
                key={s.id}
                className={`flowstab__step${done ? ' is-done' : ''}`}
                onClick={() => onSelStep(i)}
              >
                <span className="flowstab__step-idx flowstab__step-idx--muted">{i + 1}</span>
                <span className="flowstab__step-title-view">{s.caption || '(no caption)'}</span>
                {mode === 'play' && i < currentStep && (
                  <span className="flowstab__step-check">✓</span>
                )}
                {mode === 'play' && i === currentStep && (
                  <span className="flowstab__step-now">▶</span>
                )}
                {canEdit && reorderMode && (
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
          {mode === 'edit' && (
            <div className="flowstab__addstep" onClick={addStep}>
              + Add step
            </div>
          )}
        </div>
      </div>
      <div className="flowstab__footer">
        {mode === 'play' ? (
          <>
            <button
              className="flowstab__walk-back"
              disabled={currentStep <= 0}
              onClick={() => onSelStep(Math.max(0, currentStep - 1))}
            >
              ← Back
            </button>
            <button
              className="flowstab__walk-next"
              onClick={() =>
                currentStep >= steps.length - 1
                  ? onStop()
                  : onSelStep(Math.min(steps.length - 1, currentStep + 1))
              }
            >
              {currentStep >= steps.length - 1 ? 'Finish' : 'Next →'}
            </button>
            <button className="flowstab__walk-exit" onClick={onStop}>
              Exit
            </button>
          </>
        ) : (
          <>
            <button className="flowstab__play" onClick={onPlay}>
              ▶ Walk through
            </button>
            <div
              className="flowstab__morewrap"
              ref={footerMenuOpen ? footerMenuWrapRef : undefined}
            >
              <button className="flowstab__more" onClick={() => setFooterMenuOpen((v) => !v)}>
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
          </>
        )}
      </div>
    </div>
  )
}
