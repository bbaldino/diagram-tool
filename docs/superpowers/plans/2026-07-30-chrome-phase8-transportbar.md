# Flow Playback Transport Bar (Chrome Phase 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual arrow-key-only flow playback with a bottom **transport bar** (transport buttons + label + step scrubber + speed + Exit) plus §5-accurate canvas dim/highlight, adding real auto-advance play/pause at a chosen speed.

**Architecture:** A new presentational `TransportBar.tsx` renders the §5 bar and is mounted absolutely at the bottom of the canvas wrapper, shown only in `flowMode === 'play'`. New pure helpers in `flowPlayback.ts` (label text, auto-advance target, scrubber fill, interval timing) carry the testable logic. `App.tsx` gains `playing`/`speed` state, an auto-advance `setInterval` effect, `Space`-toggles-play in the existing play-mode keydown effect, and wires the bar's callbacks. The canvas gets §5 treatment: a play-mode-scoped class raises non-current opacity to `0.4`, current-step nodes render a monospace step-number badge (fed via `data.flowBadge`), and the active ring/border matches §5.

**Tech Stack:** Vite + React 18 + TypeScript, React Flow v12 (`@xyflow/react`), hand-written plain CSS in `src/index.css`, Vitest (node env — pure-function tests only, no DOM).

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm` — in-app UI only (the speed menu is an in-app popover). [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json` (runtime state).
- Capitalize only the first letter of multi-letter acronyms.
- App is served over plain-HTTP LAN — no secure-context-only browser APIs.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Use the exact §5 design tokens verbatim (copied into each task): bar bg `#1e293b`, control/border `#3d4b60`, accent `#4f46e5`, upcoming-bar `#3d4b60`, muted text `#94a3b8`, on-accent `#fff`, focus/highlight ring `rgba(79,70,229,0.13)`. Bar height **52px**, horizontal padding **16px**, `gap: 14px`. Transport `⏮`/`⏭` 30×30px `#cbd5e1`; play/pause 34×30px radius 7px bg `#4f46e5`. Label block `min-width: 190px`, flow name **13px / 600**, sub **11.5px** `#94a3b8`. Scrubber bars `height: 5px`, `border-radius: 3px`, `flex: 1`, `gap: 6px`. Speed chip + Exit: height 28px, `border: 1px solid #3d4b60`, `border-radius: 7px`, font 12px (Exit **12px / 550** `#fff`, speed `#cbd5e1`). Badge: monospace **10px / 700**, `#fff` on `#4f46e5`, padding `2px 6px`, `border-radius: 4px`. Non-current canvas opacity `0.4`; active border `2px solid #4f46e5` + `box-shadow: 0 0 0 4px rgba(79,70,229,0.13)`. Glyphs: `▶` play, `❚❚` pause, `⏮` prev, `⏭` next, `▾` dropdown.

---

## File Structure

- **Create** `webapp/src/flowPlayback.ts` — pure playback helpers (label, auto-advance, scrubber, timing, speed list). Mirrors the existing `flowState.ts` pure-helper pattern.
- **Create** `webapp/src/flowPlayback.test.ts` — Vitest unit tests for the helpers.
- **Create** `webapp/src/TransportBar.tsx` — the §5 bottom transport bar (presentational).
- **Modify** `webapp/src/App.tsx` — `playing`/`speed` state; auto-advance interval effect; `Space` in the play-mode keydown effect; manual-nav/scrub pause; mount `<TransportBar>` at the bottom of the canvas wrapper (`position: relative`); feed `data.flowBadge`; add `is-flow-play` class to `<ReactFlow>`; update `onPlay` to start playing at step 0.
- **Modify** `webapp/src/nodes.tsx` — `ServiceNode` renders the step-number badge when `data.flowBadge` is set.
- **Modify** `webapp/src/index.css` — `.transport*` bar styles, `.node__flow-badge`, and `.is-flow-play` play-mode canvas overrides.

---

### Task 1: Playback helpers + tests

**Files:**
- Create: `webapp/src/flowPlayback.ts`
- Test: `webapp/src/flowPlayback.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks import these verbatim):
  - `PLAYBACK_SPEEDS: readonly number[]` = `[0.5, 1, 2]`
  - `PLAYBACK_BASE_MS: number` = `2200`
  - `stepIntervalMs(speed: number): number`
  - `transportSublabel(stepIndex: number, stepCount: number, caption?: string): string`
  - `advanceStep(cur: number, stepCount: number): { index: number; atEnd: boolean }`
  - `isStepPlayed(barIndex: number, currentIndex: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `webapp/src/flowPlayback.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_SPEEDS,
  PLAYBACK_BASE_MS,
  stepIntervalMs,
  transportSublabel,
  advanceStep,
  isStepPlayed,
} from './flowPlayback'

describe('flowPlayback helpers', () => {
  it('exposes the speed list and base interval', () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.5, 1, 2])
    expect(PLAYBACK_BASE_MS).toBe(2200)
  })

  it('scales the interval by speed', () => {
    expect(stepIntervalMs(1)).toBe(2200)
    expect(stepIntervalMs(2)).toBe(1100)
    expect(stepIntervalMs(0.5)).toBe(4400)
  })

  it('builds the sub-label with and without a caption', () => {
    expect(transportSublabel(0, 4)).toBe('Step 1 of 4')
    expect(transportSublabel(1, 4, 'User hits Traefik')).toBe('Step 2 of 4 · User hits Traefik')
    // blank/whitespace caption is treated as absent
    expect(transportSublabel(2, 4, '   ')).toBe('Step 3 of 4')
  })

  it('advances toward the last step and reports atEnd', () => {
    expect(advanceStep(0, 4)).toEqual({ index: 1, atEnd: false })
    expect(advanceStep(2, 4)).toEqual({ index: 3, atEnd: true })
    // already on (or past) the last step: stays put, atEnd
    expect(advanceStep(3, 4)).toEqual({ index: 3, atEnd: true })
    expect(advanceStep(9, 4)).toEqual({ index: 3, atEnd: true })
    // single-step flow is immediately atEnd
    expect(advanceStep(0, 1)).toEqual({ index: 0, atEnd: true })
  })

  it('fills scrubber bars up to and including the current step', () => {
    expect(isStepPlayed(0, 1)).toBe(true)
    expect(isStepPlayed(1, 1)).toBe(true)
    expect(isStepPlayed(2, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp && npx vitest run src/flowPlayback.test.ts`
Expected: FAIL — `Failed to resolve import "./flowPlayback"`.

- [ ] **Step 3: Write minimal implementation**

Create `webapp/src/flowPlayback.ts`:

```ts
// Pure helpers for flow playback (the transport bar). Kept side-effect-free
// and DOM-free so they unit-test under Vitest's node env, mirroring flowState.ts.

// Auto-advance speed multipliers offered by the transport bar's speed chip.
export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const

// Milliseconds a step is shown at 1× before auto-advancing.
export const PLAYBACK_BASE_MS = 2200

// Interval between auto-advances at a given speed multiplier.
export function stepIntervalMs(speed: number): number {
  return Math.round(PLAYBACK_BASE_MS / speed)
}

// Transport sub-label: "Step 2 of 4" or "Step 2 of 4 · <caption>".
// A blank/whitespace-only caption is treated as absent.
export function transportSublabel(
  stepIndex: number,
  stepCount: number,
  caption?: string,
): string {
  const base = `Step ${stepIndex + 1} of ${stepCount}`
  const c = caption?.trim()
  return c ? `${base} · ${c}` : base
}

// Next auto-advance target. `atEnd` is true when the returned index is the
// last step (nothing more to advance to). Clamps out-of-range input.
export function advanceStep(cur: number, stepCount: number): { index: number; atEnd: boolean } {
  const last = Math.max(0, stepCount - 1)
  if (cur >= last) return { index: last, atEnd: true }
  const index = cur + 1
  return { index, atEnd: index >= last }
}

// Scrubber bar fill: played/current bars (index ≤ current) are on; later bars off.
export function isStepPlayed(barIndex: number, currentIndex: number): boolean {
  return barIndex <= currentIndex
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp && npx vitest run src/flowPlayback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm the whole suite still passes and typechecks**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all prior tests + the 5 new ones pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/flowPlayback.ts webapp/src/flowPlayback.test.ts
git commit -m "feat(flows): pure playback helpers for the transport bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: TransportBar component + CSS

**Files:**
- Create: `webapp/src/TransportBar.tsx`
- Modify: `webapp/src/index.css` (append `.transport*` styles)

**Interfaces:**
- Consumes: `transportSublabel`, `isStepPlayed` from `./flowPlayback` (Task 1).
- Produces (Task 3 renders `<TransportBar>` with exactly this prop shape):

```ts
export function TransportBar(props: {
  flowName: string
  stepIndex: number        // 0-based current step
  stepCount: number        // total steps (≥ 1 when the bar is shown)
  caption?: string         // current step's caption
  playing: boolean
  speed: number
  speeds: readonly number[]
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  onScrub: (index: number) => void
  onSetSpeed: (speed: number) => void
  onExit: () => void
}): JSX.Element
```

Behavior notes for the implementer:
- Prev disabled at `stepIndex === 0`; Next disabled at `stepIndex >= stepCount - 1`.
- Play/pause button shows `❚❚` while `playing`, `▶` while paused; `onTogglePlay` on click.
- Scrubber renders `stepCount` bars; bar `i` gets the `is-on` class when `isStepPlayed(i, stepIndex)`; clicking bar `i` calls `onScrub(i)`.
- Speed chip shows `` `${speed}× ▾` `` and opens an in-app popover menu listing `speeds` (each `` `${s}×` ``, checked when `s === speed`); choosing one calls `onSetSpeed(s)` and closes. The popover closes on outside click (capture-phase listener — d3-zoom stops bubbling) and on choosing an item. NO `window.confirm/alert/prompt`.
- Exit button labeled `Exit flow`, calls `onExit`.
- Buttons are real `<button type="button">`; stop click propagation is not required (the bar is outside the canvas), but the speed popover's trigger+menu share one ref wrapper so clicking the trigger while open closes it (same pattern as `FlowsTab`'s `flowstab__morewrap`).

- [ ] **Step 1: Write the component**

Create `webapp/src/TransportBar.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { transportSublabel, isStepPlayed } from './flowPlayback'

export function TransportBar(props: {
  flowName: string
  stepIndex: number
  stepCount: number
  caption?: string
  playing: boolean
  speed: number
  speeds: readonly number[]
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  onScrub: (index: number) => void
  onSetSpeed: (speed: number) => void
  onExit: () => void
}) {
  const {
    flowName,
    stepIndex,
    stepCount,
    caption,
    playing,
    speed,
    speeds,
    onPrev,
    onNext,
    onTogglePlay,
    onScrub,
    onSetSpeed,
    onExit,
  } = props

  const [speedOpen, setSpeedOpen] = useState(false)
  const speedWrap = useRef<HTMLDivElement | null>(null)

  // Close the speed popover on any outside pointer-down. Capture phase because
  // React Flow's d3-zoom stops propagation on the canvas (bubble-phase misses).
  useEffect(() => {
    if (!speedOpen) return
    const onDown = (e: MouseEvent) => {
      if (!speedWrap.current?.contains(e.target as Node)) setSpeedOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [speedOpen])

  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepCount - 1

  return (
    <div className="transport" role="group" aria-label="Flow playback">
      <div className="transport__buttons">
        <button
          type="button"
          className="transport__btn"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous step"
        >
          ⏮
        </button>
        <button
          type="button"
          className="transport__btn transport__btn--play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="transport__btn"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next step"
        >
          ⏭
        </button>
      </div>

      <div className="transport__label">
        <div className="transport__name">{flowName}</div>
        <div className="transport__sub">{transportSublabel(stepIndex, stepCount, caption)}</div>
      </div>

      <div className="transport__scrub">
        {Array.from({ length: stepCount }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`transport__bar${isStepPlayed(i, stepIndex) ? ' is-on' : ''}`}
            onClick={() => onScrub(i)}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      <div className="transport__right">
        <div className="transport__speedwrap" ref={speedWrap}>
          <button
            type="button"
            className="transport__speed"
            onClick={() => setSpeedOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={speedOpen}
          >
            {speed}× ▾
          </button>
          {speedOpen && (
            <div className="transport__speedmenu" role="menu">
              {speeds.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`transport__speeditem${s === speed ? ' is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={s === speed}
                  onClick={() => {
                    onSetSpeed(s)
                    setSpeedOpen(false)
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="transport__exit" onClick={onExit}>
          Exit flow
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Append the CSS**

Append to the end of `webapp/src/index.css`:

```css
/* ---- Flow playback transport bar (chrome §5) ---- */
.transport {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 7;
  height: 52px;
  box-sizing: border-box;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #1e293b;
  color: #fff;
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.transport__buttons { display: flex; align-items: center; gap: 2px; }
.transport__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #cbd5e1;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.transport__btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
.transport__btn:disabled { opacity: 0.4; cursor: default; }
.transport__btn--play {
  width: 34px;
  height: 30px;
  background: #4f46e5;
  color: #fff;
}
.transport__btn--play:hover:not(:disabled) { background: #4338ca; }

.transport__label {
  min-width: 190px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}
.transport__name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.transport__sub {
  font-size: 11.5px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transport__scrub { display: flex; gap: 6px; flex: 1; min-width: 0; }
.transport__bar {
  flex: 1;
  height: 5px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: #3d4b60;
  cursor: pointer;
}
.transport__bar.is-on { background: #4f46e5; }

.transport__right { display: flex; align-items: center; gap: 8px; }
.transport__speedwrap { position: relative; }
.transport__speed {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #3d4b60;
  border-radius: 7px;
  background: transparent;
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
}
.transport__speed:hover { background: rgba(255, 255, 255, 0.06); }
.transport__speedmenu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 72px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #1e293b;
  border: 1px solid #3d4b60;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.3);
}
.transport__speeditem {
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #cbd5e1;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.transport__speeditem:hover { background: rgba(255, 255, 255, 0.08); }
.transport__speeditem.is-active { color: #fff; font-weight: 600; }
.transport__exit {
  height: 28px;
  padding: 0 11px;
  border: 1px solid #3d4b60;
  border-radius: 7px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.transport__exit:hover { background: rgba(255, 255, 255, 0.06); }
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite still green (component is not yet mounted — no behavior change).

- [ ] **Step 5: Commit**

```bash
git add webapp/src/TransportBar.tsx webapp/src/index.css
git commit -m "feat(flows): TransportBar component + styles (§5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the transport bar into App (mount, auto-advance, keyboard)

**Files:**
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- Consumes: `TransportBar` (Task 2); `advanceStep`, `stepIntervalMs`, `PLAYBACK_SPEEDS` (Task 1).
- Existing state this task builds on (already in `App.tsx`): `flowMode: 'none'|'edit'|'play'`, `setFlowMode`, `currentStep`, `setCurrentStep`, `currentFlow`, and the play-mode keydown effect (`useEffect` guarded by `if (flowMode !== 'play') return`, currently handling Arrow keys + Escape).
- Produces: nothing later tasks import (integration only).

- [ ] **Step 1: Add the imports**

In `webapp/src/App.tsx`, add near the other local imports (e.g. after the `FlowsTab` import):

```ts
import { TransportBar } from './TransportBar'
import { advanceStep, stepIntervalMs, PLAYBACK_SPEEDS } from './flowPlayback'
```

- [ ] **Step 2: Add playback state**

Immediately after the existing `const [selStep, setSelStep] = useState(0)` line (~line 246), add:

```ts
  // Transport-bar playback: whether auto-advance is running, and its speed
  // multiplier. Only meaningful while flowMode === 'play'.
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
```

- [ ] **Step 3: Start playing when entering play mode from the Flows tab**

Find the `onPlay` prop passed to `<FlowsTab>` (currently `onPlay={() => setFlowMode('play')}`, ~line 1519) and replace it with:

```tsx
              onPlay={() => {
                setCurrentStep(0)
                setPlaying(true)
                setFlowMode('play')
              }}
```

Also update the `onStop` prop (currently `onStop={() => setFlowMode('edit')}`) to stop playback:

```tsx
              onStop={() => {
                setPlaying(false)
                setFlowMode('edit')
              }}
```

- [ ] **Step 4: Add the auto-advance interval effect**

Add a new effect immediately after the existing play-mode keydown effect (after the `}, [flowMode, currentFlow])` at ~line 1253):

```ts
  // Auto-advance: while playing in a flow, step forward on an interval scaled
  // by `speed`. Stops (pauses) when it reaches the last step. Cleared whenever
  // play/pause, speed, mode, or the flow changes.
  useEffect(() => {
    if (flowMode !== 'play' || !playing) return
    const count = currentFlow?.steps.length ?? 0
    if (count <= 1) {
      setPlaying(false)
      return
    }
    const t = setInterval(() => {
      setCurrentStep((s) => {
        const { index, atEnd } = advanceStep(s, count)
        if (atEnd) setPlaying(false)
        return index
      })
    }, stepIntervalMs(speed))
    return () => clearInterval(t)
  }, [flowMode, playing, speed, currentFlow])
```

- [ ] **Step 5: Add `Space` toggle + pause-on-manual-nav to the play-mode keydown effect**

In the existing play-mode keydown effect (~lines 1235-1253), modify the key handling so `Space` toggles play/pause and manual Arrow navigation pauses auto-advance. Replace the body of `onKey` (the `if (e.key === 'ArrowRight' …)` block) with:

```ts
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setPlaying(false)
        setCurrentStep((s) => Math.min(s + 1, (currentFlow?.steps.length ?? 1) - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPlaying(false)
        setCurrentStep((s) => Math.max(0, s - 1))
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'Escape') {
        setPlaying(false)
        setFlowMode('edit')
      }
```

- [ ] **Step 6: Mark the canvas wrapper as a positioning context**

Find the canvas wrapper `<div ref={wrapperRef} … style={{ flex: 1, minWidth: 0, minHeight: 0 }}>` (~line 1387) and add `position: 'relative'` to its inline style:

```tsx
        style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
```

- [ ] **Step 7: Mount the transport bar at the bottom of the canvas wrapper**

Inside that same wrapper `<div>`, after the `{addMenu && ( … )}` block and immediately before the wrapper's closing `</div>` (~line 1479), add:

```tsx
      {flowMode === 'play' && currentFlow && currentFlow.steps.length > 0 && (
        <TransportBar
          flowName={currentFlow.name}
          stepIndex={currentStep}
          stepCount={currentFlow.steps.length}
          caption={currentFlow.steps[currentStep]?.caption}
          playing={playing}
          speed={speed}
          speeds={PLAYBACK_SPEEDS}
          onPrev={() => {
            setPlaying(false)
            setCurrentStep((s) => Math.max(0, s - 1))
          }}
          onNext={() => {
            setPlaying(false)
            setCurrentStep((s) => Math.min(s + 1, currentFlow.steps.length - 1))
          }}
          onTogglePlay={() => setPlaying((p) => !p)}
          onScrub={(i) => {
            setPlaying(false)
            setCurrentStep(i)
          }}
          onSetSpeed={setSpeed}
          onExit={() => {
            setPlaying(false)
            setFlowMode('edit')
          }}
        />
      )}
```

- [ ] **Step 8: Verify build + full suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite green (no unit tests assert integration; they must not regress).

- [ ] **Step 9: Commit**

```bash
git add webapp/src/App.tsx
git commit -m "feat(flows): mount transport bar, auto-advance, Space/Esc playback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: §5 canvas playback visuals (step-number badge + 0.4 dim)

**Files:**
- Modify: `webapp/src/App.tsx` (feed `data.flowBadge`; add `is-flow-play` class to `<ReactFlow>`)
- Modify: `webapp/src/nodes.tsx` (`ServiceNode` renders the badge)
- Modify: `webapp/src/index.css` (`.node__flow-badge` + `.is-flow-play` overrides)

**Interfaces:**
- Consumes: the flow-class tagging effect already in `App.tsx` (~lines 338-348) that maps `flowClassOf(id)` onto every node/edge `className`, and `currentStep`/`flowMode` state.
- Produces: `data.flowBadge?: number` on service nodes (1-based step number for current-step nodes in play mode; `undefined` otherwise).

- [ ] **Step 1: Feed the badge number into node data**

In `webapp/src/App.tsx`, in the flow-class tagging effect (~lines 338-348), replace the `setNodes(...)` call so active nodes in play mode carry a 1-based badge number:

```ts
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const cls = flowClassOf(n.id)
        const flowBadge =
          flowMode === 'play' && cls === 'flow-active' ? currentStep + 1 : undefined
        return { ...n, className: cls, data: { ...n.data, flowBadge } }
      }),
    )
    setEdges((es) =>
      es.map((e) => {
        const fc = flowClassOf(e.id)
        return { ...e, className: fc, data: { ...e.data, flowState: fc } }
      }),
    )
  }, [flowClassOf, setNodes, setEdges, flowMode, currentStep])
```

(The `setEdges` half is unchanged from the current code — reproduced here because the effect body is replaced as a unit. `flowMode` and `currentStep` are added to the dep array; they are already transitively covered by `flowClassOf`'s identity, but listing them makes the badge dependency explicit and satisfies the linter.)

- [ ] **Step 2: Add the `is-flow-play` class to the ReactFlow canvas**

Find the `<ReactFlow` opening tag (~line 1396) and add a `className` prop (there is none today):

```tsx
      <ReactFlow
        className={flowMode === 'play' ? 'is-flow-play' : undefined}
        nodes={nodes}
```

(Place `className` as the first prop; keep every existing prop unchanged.)

- [ ] **Step 3: Render the badge in ServiceNode**

In `webapp/src/nodes.tsx`, in `ServiceNode`, add the badge as the last child of the outer `.node` div — after the `d.note` line (~line 63), before the closing `</div>`:

```tsx
      {(d as any).flowBadge ? (
        <div className="node__flow-badge">{(d as any).flowBadge}</div>
      ) : null}
```

- [ ] **Step 4: Add the badge + play-mode canvas CSS**

Append to the end of `webapp/src/index.css`:

```css
/* ---- §5 canvas treatment during flow playback ---- */
/* Non-current elements dim to 0.4 (play mode only; edit-mode ghost stays 0.18). */
.react-flow.is-flow-play .react-flow__node.flow-ghost,
.react-flow.is-flow-play .react-flow__edge.flow-ghost { opacity: 0.4; }
.react-flow.is-flow-play .wp-label.flow-ghost { opacity: 0.4; }

/* Current-step nodes: §5 accent border + ring. */
.react-flow.is-flow-play .react-flow__node.flow-active .node {
  border: 2px solid #4f46e5;
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.13);
}

/* Step-number badge on current-step entity nodes. */
.node { position: relative; }
.node__flow-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #4f46e5;
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  pointer-events: none;
}
```

- [ ] **Step 5: Verify build + full suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/App.tsx webapp/src/nodes.tsx webapp/src/index.css
git commit -m "feat(flows): §5 playback canvas — step-number badge + 0.4 dim

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Browser validation (controller-run)

**Files:** none (verification only; the SDD controller runs this with Playwright against a throwaway diagram — never the real "Homelab (sample)" diagram [[sdd-smokes-use-throwaway-diagram]]).

**Interfaces:** consumes the full integrated feature from Tasks 1-4.

- [ ] **Step 1: Prepare a throwaway diagram with a multi-step flow**

Using the app UI (or MCP), create a throwaway diagram with ≥3 entities and a flow of ≥3 steps, each step assigning ≥1 element and a caption. Do NOT mutate the "Homelab (sample)" diagram or any real diagram.

- [ ] **Step 2: Verify the bar renders and playback runs**

Select the flow → `▶ Play flow`. Confirm:
- The bottom transport bar appears (dark `#1e293b`, spanning the canvas width, above the rail is not required — it sits at the canvas bottom).
- Playback auto-advances: the scrubber fills left-to-right, the "Step N of M · caption" label updates, and it pauses on the last step.
- `❚❚`/`▶` toggles auto-advance; `⏮`/`⏭` step and disable at the ends; clicking a scrubber bar jumps to that step and pauses.
- Speed chip opens the `0.5× / 1× / 2×` menu, changes cadence, and closes on outside click.
- `Space` toggles play/pause; `←`/`→` step (and pause); `Esc` and `Exit flow` both leave play mode back to the Flows-tab steps view.

- [ ] **Step 3: Verify the §5 canvas treatment**

During playback confirm:
- Non-current entities/edges dim to `~0.4` (visibly lighter dim than edit-mode authoring, which stays fainter).
- Current-step entity nodes show the accent border + ring and a small monospace step-number badge at the top-right corner.
- Exiting restores full opacity and removes the bar and badges.

- [ ] **Step 4: Confirm no real diagram was mutated**

Verify the throwaway diagram is the only thing touched; delete it when done. Confirm `git status` shows no `model.json`/`history.json` staged.

---

## Self-Review

**Spec coverage (§5):**
- Bar layout/position/height/padding/gap → Task 2 CSS + Task 3 mount. ✅
- Transport buttons (⏮ / play-pause / ⏭, sizes, colors) → Task 2. ✅
- Label block (flow name + "Step N of M · caption") → Task 2 + `transportSublabel` (Task 1). ✅
- Step scrubber (bars, played/upcoming fill, click-to-jump) → Task 2 + `isStepPlayed` (Task 1) + `onScrub` (Task 3). ✅
- Speed chip `1× ▾` with menu → Task 2 + `speed` state / `onSetSpeed` (Task 3) + `PLAYBACK_SPEEDS`/`stepIntervalMs` (Task 1). ✅
- Exit flow → Task 2 + `onExit` (Task 3). ✅
- Auto-advance at chosen speed, pause at end → Task 3 effect + `advanceStep`/`stepIntervalMs` (Task 1). ✅
- `Space` play/pause, `←`/`→` manual, `Esc` exits → Task 3. ✅
- Canvas: non-current `opacity: 0.4`, current border+ring, step-number badge → Task 4. ✅
- Esc exits, restores opacity, removes bar → Task 3 (mode gate) + Task 4 (class gate). ✅

**Placeholder scan:** No TBD/TODO; every code step contains full content. ✅

**Type consistency:** `TransportBar` prop names identical between Task 2 (definition) and Task 3 (usage); `advanceStep`/`stepIntervalMs`/`transportSublabel`/`isStepPlayed`/`PLAYBACK_SPEEDS` signatures identical between Task 1 (definition) and Tasks 2-3 (consumption); `data.flowBadge` produced in Task 4 Step 1 and consumed in Task 4 Step 3 under the same name. ✅

**Deferred (not in §5 scope for this phase; log to fast-follows if surfaced):** looping playback; per-edge step badges (badge is entity-node only, matching the prototype's node cards); reduced-motion handling of the scrubber; the "compensate padding by 1px" note in §5 (only relevant if nodes are size-sensitive — the app's nodes are not fixed-size, so the 2px border is absorbed by `box-sizing`).
