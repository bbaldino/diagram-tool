# Flow Walkthrough rev-4 Rework (Chrome Phase 13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the flow playback to the handoff's **rev 4** design: no auto-play (no timer / play-pause / speed), a manual "step bar" (Back · Next/Finish · counter · scrubber · Exit), a new **step caption card** for the description, and a "while walking through" rail state. `Play flow` becomes `Walk through`.

**Architecture:** Reworks what Phase 8 built. `flowPlayback.ts` sheds its auto-advance/speed helpers. `TransportBar.tsx` is replaced by `StepBar.tsx` + a new `StepCaptionCard.tsx`. `App.tsx` drops `playing`/`speed` state, the auto-advance effect, and the Space-toggle, keeping only manual stepping (`flowMode` + `currentStep` already ARE `flowWalkthrough: { flowId, stepIndex }` once the timer state is gone). `FlowsTab.tsx` renames its footer to `Walk through` and gains the "while walking" rail chrome.

**Tech Stack:** Vite + React 18 + TypeScript, React Flow v12, plain CSS, Vitest (node env).

**Reference:** `redesign-review/design_handoff_top_chrome/README.md` — Revision history (rev 4), §4 "Flows tab" + "While walking through", §5 "Flow step bar" + "Step caption card", §Interactions "Flows", §Out of scope. The reference has been synced to rev 4.

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm`. [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json`.
- Capitalize only the first letter of multi-letter acronyms.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Absolutely no auto-advance may be reintroduced** — no timer, no `playing`, no `speed`, no play/pause, no interval. Advancing is only ever a deliberate user action (Back/Next/Finish, ←/→, scrubber click, step-row click). (Handoff §5 + Out-of-scope.)
- Internal note: keep the existing `flowMode: 'none' | 'edit' | 'play'` union — the `'play'` value now means "walkthrough" (no rename, to avoid churn across `flowClassOf`, the `is-flow-play` canvas class, the badge feed, and FlowsTab's `mode` prop). Only the timer/speed state is removed.
- **§5/§4 rev-4 tokens (verbatim, copied into tasks):** Step bar: 52px, `background: #1e293b`, `color: #fff`, padding `0 16px`, flex `align-items: center` `gap: 14px`. Stepping buttons: flex `gap: 7px`, height 30px, radius 7px, font 12.5px; `← Back` secondary padding `0 12px` `border: 1px solid #3d4b60` weight 550 `#cbd5e1` (disabled `#6b7a90`); `Next step →` primary padding `0 14px` `background: #4f46e5` `#fff` weight 600, becomes `Finish` on the last step (exits). Step counter monospace 12px `#cbd5e1` `min-width: 42px` reading `1 / 4`. Scrubber: flex `gap: 6px` `flex: 1`, bars `height: 5px` radius 3 `flex: 1`, played/current `#4f46e5` upcoming `#3d4b60`, click jumps. `Exit flow`: height 28px padding `0 11px` `border: 1px solid #3d4b60` radius 7 `12px / 550` `#fff`. Caption card: `bottom: 68px; left: 50%; transform: translateX(-50%)`, `width: 720px`, padding `18px 22px 20px`, `background: #1e293b`, radius 12, `box-shadow: 0 14px 36px rgba(15,23,42,0.28)`, flex column `gap: 9px`; meta row flex `gap: 9px` align center — step pill `Step 1 / 4` monospace **10px/700** uppercase `letter-spacing: 0.09em` `#fff` on `#4f46e5` padding `2px 7px` radius 4, flow name **11.5px** `#8593a8`, right-aligned element summary **11.5px** `#8593a8` (`margin-left: auto`); description **21px/650** `line-height: 1.35` `letter-spacing: -0.015em` `text-wrap: pretty` `#fff`, wraps 2–3 lines, no truncation. While-walking rail: list collapses to a header strip padding `10px 12px` `background: #eef0fb` `border-bottom: 1px solid #dcdffa`, `▶` `#4338ca`, name **13px/650** `#312e81`, step chip `Step 2 / 4` **11px/600** `#4338ca` on `#dcdffa` padding `2px 7px` radius 5; current step `border: 1px solid #4f46e5` + `box-shadow: 0 0 0 3px rgba(79,70,229,0.13)` trailing `▶` 10px `#4338ca`; completed steps `opacity: 0.55` trailing `✓` `#94a3b8`; rail footer `← Back` (secondary `flex:1` `#64748b`) `Next →` (primary `#4f46e5` `flex:1` weight 600) `Exit` (secondary padding `8px 11px`).

---

## File Structure

- **Modify** `webapp/src/flowPlayback.ts` — drop speed/timer/advance/`transportSublabel`; keep `isStepPlayed`; add `stepCounterLabel`.
- **Modify** `webapp/src/flowPlayback.test.ts` — drop tests for removed helpers; keep `isStepPlayed`; add `stepCounterLabel`.
- **Create** `webapp/src/StepBar.tsx` — the §5 step bar (replaces `TransportBar.tsx`).
- **Create** `webapp/src/StepCaptionCard.tsx` — the §5 caption card.
- **Delete** `webapp/src/TransportBar.tsx`.
- **Modify** `webapp/src/App.tsx` — remove `playing`/`speed`/auto-advance/Space; wire StepBar + StepCaptionCard; update FlowsTab handlers + imports.
- **Modify** `webapp/src/FlowsTab.tsx` — `Walk through` footer; "while walking" rail state.
- **Modify** `webapp/src/index.css` — replace `.transport*` with `.stepbar*`; add `.stepcard*` and `.flowstab__walk*` (while-walking) styles.

---

### Task 1: Trim `flowPlayback.ts` helpers + tests

**Files:** `webapp/src/flowPlayback.ts`, `webapp/src/flowPlayback.test.ts`

**Interfaces:**
- Removes exports (no longer used anywhere after this phase): `PLAYBACK_SPEEDS`, `PLAYBACK_BASE_MS`, `stepIntervalMs`, `transportSublabel`, `advanceStep`.
- Keeps: `isStepPlayed(barIndex, currentIndex): boolean`.
- Adds: `stepCounterLabel(stepIndex: number, stepCount: number): string` → `"1 / 4"` (1-based).

- [ ] **Step 1: Rewrite the tests**

Replace the body of `webapp/src/flowPlayback.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { stepCounterLabel, isStepPlayed } from './flowPlayback'

describe('flowPlayback helpers', () => {
  it('formats a 1-based "index / total" step counter', () => {
    expect(stepCounterLabel(0, 4)).toBe('1 / 4')
    expect(stepCounterLabel(3, 4)).toBe('4 / 4')
  })

  it('fills scrubber bars up to and including the current step', () => {
    expect(isStepPlayed(0, 1)).toBe(true)
    expect(isStepPlayed(1, 1)).toBe(true)
    expect(isStepPlayed(2, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd webapp && npx vitest run src/flowPlayback.test.ts`
Expected: FAIL — `stepCounterLabel` not exported.

- [ ] **Step 3: Rewrite `flowPlayback.ts`**

Replace the whole file with:

```ts
// Pure helpers for the flow step bar. Side-effect- and DOM-free so they
// unit-test under Vitest's node env. (rev 4 removed auto-advance — no speed,
// no timer, no `transportSublabel`; the description now lives in the caption
// card and the bar shows a plain counter.)

// "1 / 4" step counter (1-based) for the step bar and caption-card pill.
export function stepCounterLabel(stepIndex: number, stepCount: number): string {
  return `${stepIndex + 1} / ${stepCount}`
}

// Scrubber bar fill: played/current bars (index ≤ current) are on; later off.
export function isStepPlayed(barIndex: number, currentIndex: number): boolean {
  return barIndex <= currentIndex
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd webapp && npx vitest run src/flowPlayback.test.ts`
Expected: PASS. (Full suite will fail to typecheck until Tasks 2-3 remove the other importers — that's fine here; the file-scoped test passes.)

- [ ] **Step 5: Commit**

```bash
git add webapp/src/flowPlayback.ts webapp/src/flowPlayback.test.ts
git commit -m "refactor(flows): trim flowPlayback to stepCounterLabel + isStepPlayed (rev4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Do NOT run the full `tsc`/suite yet — `App.tsx`/`TransportBar.tsx` still import the removed helpers; Task 3 fixes that. This task's gate is the file-scoped test only.)

---

### Task 2: StepBar + StepCaptionCard components + CSS

**Files:** Create `webapp/src/StepBar.tsx`, `webapp/src/StepCaptionCard.tsx`; delete `webapp/src/TransportBar.tsx`; modify `webapp/src/index.css`.

**Interfaces (Task 3 renders these exactly):**

```tsx
export function StepBar(props: {
  stepIndex: number
  stepCount: number
  onBack: () => void
  onNext: () => void        // advance one step (only called when not on the last step)
  onExit: () => void        // Exit flow AND the "Finish" action on the last step
  onScrub: (index: number) => void
}): JSX.Element

export function StepCaptionCard(props: {
  stepIndex: number
  stepCount: number
  flowName: string
  elementSummary: string    // e.g. "User · requests →" (step's element chip labels joined)
  description: string       // the step caption; may be empty
}): JSX.Element
```

- [ ] **Step 1: Create `StepBar.tsx`**

```tsx
import { stepCounterLabel, isStepPlayed } from './flowPlayback'

export function StepBar(props: {
  stepIndex: number
  stepCount: number
  onBack: () => void
  onNext: () => void
  onExit: () => void
  onScrub: (index: number) => void
}) {
  const { stepIndex, stepCount, onBack, onNext, onExit, onScrub } = props
  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepCount - 1

  return (
    <div className="stepbar" role="group" aria-label="Flow walkthrough">
      <div className="stepbar__buttons">
        <button
          type="button"
          className="stepbar__back"
          onClick={onBack}
          disabled={atStart}
        >
          ← Back
        </button>
        <button
          type="button"
          className="stepbar__next"
          // On the last step "Next" becomes "Finish", which exits the flow.
          onClick={atEnd ? onExit : onNext}
        >
          {atEnd ? 'Finish' : 'Next step →'}
        </button>
      </div>

      <div className="stepbar__counter">{stepCounterLabel(stepIndex, stepCount)}</div>

      <div className="stepbar__scrub">
        {Array.from({ length: stepCount }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`stepbar__bar${isStepPlayed(i, stepIndex) ? ' is-on' : ''}`}
            onClick={() => onScrub(i)}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      <button type="button" className="stepbar__exit" onClick={onExit}>
        Exit flow
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create `StepCaptionCard.tsx`**

```tsx
import { stepCounterLabel } from './flowPlayback'

export function StepCaptionCard(props: {
  stepIndex: number
  stepCount: number
  flowName: string
  elementSummary: string
  description: string
}) {
  const { stepIndex, stepCount, flowName, elementSummary, description } = props
  return (
    <div className="stepcard" role="status" aria-live="polite">
      <div className="stepcard__meta">
        <span className="stepcard__pill">Step {stepCounterLabel(stepIndex, stepCount)}</span>
        <span className="stepcard__flow">{flowName}</span>
        {elementSummary && <span className="stepcard__summary">{elementSummary}</span>}
      </div>
      <div className="stepcard__desc">{description || 'No description for this step.'}</div>
    </div>
  )
}
```

- [ ] **Step 3: Delete `TransportBar.tsx`**

```bash
git rm webapp/src/TransportBar.tsx
```

- [ ] **Step 4: Replace the `.transport*` CSS with `.stepbar*` + add `.stepcard*`**

In `webapp/src/index.css`, find the `/* ---- Flow playback transport bar (chrome §5) ---- */` block (all the `.transport*` rules, including the scrubber hit-area) and REPLACE the entire block with:

```css
/* ---- Flow step bar (chrome §5, rev 4 — manual stepping, no auto-play) ---- */
.stepbar {
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
.stepbar__buttons { display: flex; align-items: center; gap: 7px; }
.stepbar__back,
.stepbar__next {
  height: 30px;
  border-radius: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
.stepbar__back {
  padding: 0 12px;
  border: 1px solid #3d4b60;
  background: transparent;
  color: #cbd5e1;
  font-weight: 550;
}
.stepbar__back:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
.stepbar__back:disabled { color: #6b7a90; border-color: #2b3546; cursor: default; }
.stepbar__next {
  padding: 0 14px;
  border: none;
  background: #4f46e5;
  color: #fff;
  font-weight: 600;
}
.stepbar__next:hover { background: #4338ca; }
.stepbar__counter {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #cbd5e1;
  min-width: 42px;
}
.stepbar__scrub { display: flex; gap: 6px; flex: 1; min-width: 0; }
.stepbar__bar {
  flex: 1;
  height: 16px;
  padding: 5.5px 0;
  border: none;
  border-radius: 3px;
  background: #3d4b60;
  background-clip: content-box;
  cursor: pointer;
}
.stepbar__bar.is-on { background: #4f46e5; background-clip: content-box; }
.stepbar__exit {
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
.stepbar__exit:hover { background: rgba(255, 255, 255, 0.06); }

/* ---- Step caption card (chrome §5, rev 4) ---- */
.stepcard {
  position: absolute;
  bottom: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  width: 720px;
  max-width: calc(100% - 32px);
  box-sizing: border-box;
  padding: 18px 22px 20px;
  background: #1e293b;
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.28);
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.stepcard__meta { display: flex; align-items: center; gap: 9px; }
.stepcard__pill {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #fff;
  background: #4f46e5;
  padding: 2px 7px;
  border-radius: 4px;
}
.stepcard__flow { font-size: 11.5px; color: #8593a8; }
.stepcard__summary { margin-left: auto; font-size: 11.5px; color: #8593a8; }
.stepcard__desc {
  font-size: 21px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.015em;
  text-wrap: pretty;
  color: #fff;
}
```

(Keep the `@keyframes menuIn` reference to `.transport__speedmenu` from Phase 11 in mind — remove `.transport__speedmenu` from that keyframe selector list, since the speed menu no longer exists. Grep `transport` in index.css after editing and remove any stragglers.)

- [ ] **Step 5: Verify**

Run: `cd webapp && npx tsc --noEmit`
Expected: errors ONLY in `App.tsx` (still importing `TransportBar` / removed helpers) — those are fixed in Task 3. `StepBar.tsx`/`StepCaptionCard.tsx` themselves must typecheck clean. If any error is inside the two new files, fix it here.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/StepBar.tsx webapp/src/StepCaptionCard.tsx webapp/src/index.css
git commit -m "feat(flows): StepBar + StepCaptionCard components + styles (rev4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: App integration — remove auto-play, wire StepBar + caption card

**Files:** `webapp/src/App.tsx`

**Interfaces:** consumes `StepBar`, `StepCaptionCard` (Task 2); existing `flowMode`/`currentFlowId`/`currentStep`/`selStep`/`currentFlow`/`chipLabel`.

- [ ] **Step 1: Fix imports**

Replace `import { TransportBar } from './TransportBar'` with `import { StepBar } from './StepBar'` and add `import { StepCaptionCard } from './StepCaptionCard'`. Delete the line `import { advanceStep, stepIntervalMs, PLAYBACK_SPEEDS } from './flowPlayback'` (no longer used).

- [ ] **Step 2: Remove `playing` / `speed` state**

Delete the two lines (and the comment above them):

```ts
  // Transport-bar playback: whether auto-advance is running, and its speed
  // multiplier. Only meaningful while flowMode === 'play'.
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
```

- [ ] **Step 3: Delete the auto-advance effect**

Delete the entire `// Auto-advance: while playing …` `useEffect` (the one with `stepIntervalMs(speed)` / `advanceStep`). There is no timer in rev 4.

- [ ] **Step 4: Simplify the walkthrough keydown effect**

In the `if (flowMode !== 'play') return` keydown effect, remove all `setPlaying(...)` calls and the Space branch. The body becomes:

```ts
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCurrentStep((s) => Math.min(s + 1, (currentFlow?.steps.length ?? 1) - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCurrentStep((s) => Math.max(0, s - 1))
      } else if (e.key === 'Escape') {
        setFlowMode('edit')
      }
```

- [ ] **Step 5: Replace the TransportBar mount with StepBar + StepCaptionCard**

Replace the `{flowMode === 'play' && currentFlow && currentFlow.steps.length > 0 && (<TransportBar … />)}` block with:

```tsx
      {flowMode === 'play' && currentFlow && currentFlow.steps.length > 0 && (
        <>
          <StepCaptionCard
            stepIndex={currentStep}
            stepCount={currentFlow.steps.length}
            flowName={currentFlow.name}
            elementSummary={(currentFlow.steps[currentStep]?.elementIds ?? [])
              .map(chipLabel)
              .join(' · ')}
            description={currentFlow.steps[currentStep]?.caption ?? ''}
          />
          <StepBar
            stepIndex={currentStep}
            stepCount={currentFlow.steps.length}
            onBack={() => setCurrentStep((s) => Math.max(0, s - 1))}
            onNext={() => setCurrentStep((s) => Math.min(s + 1, currentFlow.steps.length - 1))}
            onExit={() => setFlowMode('edit')}
            onScrub={(i) => setCurrentStep(i)}
          />
        </>
      )}
```

- [ ] **Step 6: Update the FlowsTab handlers**

In the `<FlowsTab …>` props: change `onPlay` to drop `setPlaying` — `onPlay={() => { setCurrentStep(0); setFlowMode('play') }}`. Change `onStop` to `onStop={() => setFlowMode('edit')}`. Change the `onSelStep` play-mode branch to drop `setPlaying(false)` — in play mode it's just `setCurrentStep(i)`; edit mode stays `setSelStep(i)`.

- [ ] **Step 7: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite green (was 280; now 279 after removing the auto-advance-related unit tests in Task 1 — confirm the number is stable and nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add webapp/src/App.tsx
git commit -m "feat(flows): rev4 walkthrough — no auto-play; mount StepBar + caption card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: FlowsTab — `Walk through` footer + "while walking" rail state

**Files:** `webapp/src/FlowsTab.tsx`, `webapp/src/index.css`

**Interfaces:** No new props needed — the walkthrough footer drives `onSelStep` (Back/Next, clamped) and `onStop` (Exit); `onPlay`/`onStop` keep their meaning. `currentStep`/`mode`/`currentFlow` already flow in.

- [ ] **Step 1: Rename the edit-mode footer button**

In the `.flowstab__footer`, the non-play button label `▶ Play flow` → `Walk through` (keep the leading `▶`): `▶ Walk through`.

- [ ] **Step 2: Replace the play-mode footer with Back / Next / Exit**

Currently play mode renders a single `Stop` button. Replace the footer's `mode === 'play'` branch so it renders the three mirrored actions (Exit uses `onStop`; Back/Next use `onSelStep`, clamped; on the last step `Next →` becomes `Finish` → `onStop`):

```tsx
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
            <div className="flowstab__morewrap" ref={footerMenuOpen ? footerMenuWrapRef : undefined}>
              {/* …existing footer ⋯ trigger + FlowMenu, unchanged… */}
            </div>
          </>
        )}
      </div>
```

(Keep the existing footer `⋯` menu exactly as-is inside the non-play branch. The play-mode footer has no `⋯`.)

- [ ] **Step 3: Collapse the flow list to a header strip while walking**

When `mode === 'play'`, render a compact header strip instead of the full `flowList` (the editable list of all flows). Add, before the `return`:

```tsx
  const walkHeader = currentFlow && (
    <div className="flowstab__walkhead">
      <span className="flowstab__walkhead-arrow">▶</span>
      <span className="flowstab__walkhead-name">{currentFlow.name}</span>
      <span className="flowstab__walkhead-chip">Step {currentStep + 1} / {steps.length}</span>
    </div>
  )
```

In the main `return`, render `{mode === 'play' ? walkHeader : flowList}` where `flowList` is currently rendered.

- [ ] **Step 4: Hide the steps-block header + step editing while walking; style current/completed/upcoming**

- The `.flowstab__steps-head` (the `Steps · … ` + `Reorder` row): render only when `mode !== 'play'`.
- In the step map, add per-step state classes for play mode: the current step (`i === currentStep`) keeps `is-sel` styling; **completed** steps (`i < currentStep`) get a `is-done` class + a trailing `✓`; upcoming (`i > currentStep`) stay normal. The `is-sel` selected card already expands with chips; in play mode add a trailing `▶` marker to the current step's head. Editing affordances are already gated on `canEdit` (`mode === 'edit'`) — leave that (no `⋮` drag, no `+ Add step`, no `Reorder` during play; those already gate on `mode === 'edit'`).

Concretely, compute in the map: `const done = mode === 'play' && i < currentStep`, apply `className={... + (done ? ' is-done' : '')}`, and in play mode append a trailing marker to each step's head: `{mode === 'play' && i < currentStep && <span className="flowstab__step-check">✓</span>}` and `{mode === 'play' && i === currentStep && <span className="flowstab__step-now">▶</span>}`. Keep `onClick={() => onSelStep(i)}` on the non-selected rows so clicking a step jumps to it (already present).

- [ ] **Step 5: Add the while-walking CSS**

Append to `webapp/src/index.css`:

```css
/* ---- Flows tab: while walking through (rev 4 §4) ---- */
.flowstab__walkhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #eef0fb;
  border-bottom: 1px solid #dcdffa;
}
.flowstab__walkhead-arrow { font-size: 11px; color: #4338ca; }
.flowstab__walkhead-name { font-size: 13px; font-weight: 650; color: #312e81; }
.flowstab__walkhead-chip {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #4338ca;
  background: #dcdffa;
  padding: 2px 7px;
  border-radius: 5px;
}
.flowstab__step.is-done { opacity: 0.55; }
.flowstab__step-check { margin-left: auto; color: #94a3b8; font-size: 11px; }
.flowstab__step-now { margin-left: auto; color: #4338ca; font-size: 10px; }
.flowstab__walk-back,
.flowstab__walk-next,
.flowstab__walk-exit {
  padding: 8px 0;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.flowstab__walk-back { flex: 1; border: 1px solid #dfe3ea; background: #fff; color: #64748b; }
.flowstab__walk-back:disabled { color: #b0b8c4; cursor: default; }
.flowstab__walk-next { flex: 1; border: none; background: #4f46e5; color: #fff; }
.flowstab__walk-exit { padding: 8px 11px; border: 1px solid #dfe3ea; background: #fff; color: #64748b; }
```

- [ ] **Step 6: Verify build + suite**

Run: `cd webapp && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/FlowsTab.tsx webapp/src/index.css
git commit -m "feat(flows): Walk-through footer + while-walking rail state (rev4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Browser validation (controller-run)

**Files:** none (verification only; use a **throwaway** diagram with a ≥3-step flow, captions on the steps [[sdd-smokes-use-throwaway-diagram]]).

- [ ] **Step 1: Enter walkthrough.** Select the flow → footer reads **`▶ Walk through`**. Click it → the step bar and caption card appear, on **step 1, nothing moving** (no timer — confirm it does NOT advance on its own after several seconds). Canvas dims non-current to 0.4; current step highlighted + badged.
- [ ] **Step 2: Step bar.** Confirm: `← Back` disabled on step 1; `Next step →` advances; the `1 / N` counter updates; the scrubber fills and click-to-jump works; on the last step the primary reads **`Finish`** and exits the flow. `Exit flow` exits. **No** play/pause button and **no** `1× ▾` speed chip anywhere.
- [ ] **Step 3: Caption card.** The description shows at large 21px in the centered card above the bar; a multi-line caption wraps (2–3 lines) and the card grows upward without truncating. The meta row shows `Step 1 / N` pill + flow name + element summary.
- [ ] **Step 4: Keyboard.** `←`/`→` step; `Esc` exits. (No Space toggle.)
- [ ] **Step 5: Rail while walking.** The Flows rail collapses to the header strip with the `Step 2 / N` chip; the steps-block header (`Steps · …` / `Reorder`) is gone; the current step is highlighted/expanded, completed steps are dimmed with a `✓`; the rail footer shows `← Back` / `Next →` / `Exit`; clicking a step row jumps to it; no `⋮` / `+ Add step` during walk. Exiting returns to the editable rail.
- [ ] **Step 6: Cleanup.** Delete the throwaway; confirm no `model.json`/`history.json` staged.

---

## Self-Review

**rev-4 coverage:**
- Auto-play removed (no playing/speed/timer/play-pause/Space) → Tasks 1 + 3. ✅
- Step bar (Back · Next/Finish · counter · scrubber · Exit) → Task 2 + 3. ✅
- Step caption card (720px, meta row, 21px wrapping description) → Task 2 + 3. ✅
- `Play flow` → `Walk through` → Task 4. ✅
- "While walking through" rail (collapsed header + Step chip, current/completed styling, Back/Next/Exit footer, click-to-jump) → Task 4. ✅
- Canvas dim 0.4 + active border/ring + step badge → **kept from Phase 8** (`is-flow-play` / `.node__flow-badge` unchanged). ✅

**Placeholder scan:** none — every step has the concrete code/values. ✅

**Type consistency:** `StepBar`/`StepCaptionCard` prop shapes identical between Task 2 (definition) and Task 3 (use); `stepCounterLabel`/`isStepPlayed` identical between Task 1 (definition) and Tasks 2 (consumption). ✅

**Deferred / notes:** internal `flowMode: 'play'` value kept (means "walkthrough") — no rename, to avoid churn (documented in Global Constraints); the caption card's element summary joins the step's chip labels with ` · ` (the handoff's `User → Traefik` is illustrative — refine later if a specific source→target format is wanted); the step-to-step 180ms opacity crossfade (§Transitions) is a small polish left to a fast-follow unless the existing flow-class opacity transition already covers it (add `transition: opacity 180ms` to the flow-ghost/active rules only if the reviewer confirms it's missing and cheap). Exported GIF/video walkthrough is explicitly out of scope (must never reintroduce a timer).
