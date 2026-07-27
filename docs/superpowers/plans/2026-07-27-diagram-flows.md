# Diagram Flows (Walkthroughs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, ordered "flow" walkthroughs to a diagram — step through them to light up elements in sequence (cumulative reveal + moving highlight) — authored in-app and drivable via the MCP.

**Architecture:** A `Flow` is per-diagram content (`Diagram.flows[]`) that rides the existing op/store/diff/undo pipeline exactly like groups. A pure `flowStates(flow, stepIndex)` helper decides which element ids are `active`/`lit`; the canvas tags nodes/edges with a `flowState` class (`active`/`lit`/`ghost`) and CSS fades them. UI state (current flow, step, mode) is client-only. MCP gains `author_flow` + granular flow tools; `get_diagram` already returns the raw diagram (so it surfaces flows + edge ids).

**Tech Stack:** TypeScript, React, `@xyflow/react`, Vitest, MCP SDK + zod.

**Spec:** `docs/superpowers/specs/2026-07-27-diagram-flows-design.md`

## Global Constraints

- A flow is a **lens** — it never changes the diagram's placements/groups/edges/notes.
- `FlowStep = { id: string; elementIds: string[]; caption?: string }`; `Flow = { id: string; name: string; steps: FlowStep[] }`; `Diagram.flows?: Flow[]` (absent = none).
- Reveal is **cumulative + moving active highlight**: at step N, `active` = ids in `steps[N]`; `lit` = ids in `steps[0..N-1]` not active; every other diagram element = `ghost`.
- Flows are **per-diagram content**: they use the `diffById` add/update/remove op pattern (op carries the full object with its own id), are part of `DiagramContent` (so **undoable**), and stream over SSE like any edit.
- Element references are element **ids** (a placement `entityId`, a `DEdge.id`, a `Group.id`, or a `Note.id`). MCP tools additionally accept an edge as `{ from, to }` resolved to the edge id.
- Dragging/authoring is **explicit** (no auto-lighting). Play is **manual** (Prev/Next, arrow keys, click-a-step). No auto-play timer.
- Current flow / step / mode (`none`|`edit`|`play`) is **client UI state**, not stored in the model.
- Server/model code unit-tested (vitest); client UI browser-verified (Playwright) — consistent with existing client work. Keep `npx tsc --noEmit` clean and the suite green after each task.
- Branch: `main`.

---

## File Structure

- `webapp/src/model.ts` — `Flow`/`FlowStep` types, `Diagram.flows`, `DiagramContent.flows`, `diagramContent`, `addFlow`/`updateFlow`/`removeFlow`.
- `webapp/src/ops.ts` — `flow.add`/`flow.update`/`flow.remove` ops + `applyOp` cases.
- `webapp/src/diff.ts` — diff `flows` via `diffById`.
- `webapp/src/flowState.ts` (new) — `flowStates` pure helper.
- `webapp/src/buildGraph.ts` — accept optional flow states, tag node/edge `flowState`.
- `webapp/src/FlowPanel.tsx` (new) — the step-list editor + player panel.
- `webapp/src/App.tsx` — flow UI state, Flows selector, edit/play modes, click-to-light, re-tag effect.
- `webapp/src/index.css` — `.flow-ghost`/`.flow-active` styling + fade.
- `webapp/server/mcp.ts` — `author_flow` + granular flow tools + element-ref resolver.
- Tests: `webapp/src/{model,ops,diff,flowState}.test.ts`, `webapp/server/mcp.test.ts`.

---

### Task 1: Flows data layer — types, mutators, ops, diff, undo content

**Files:**
- Modify: `webapp/src/model.ts`, `webapp/src/ops.ts`, `webapp/src/diff.ts`
- Test: `webapp/src/diff.test.ts`, `webapp/src/model.test.ts`

**Interfaces (produced):**
- `interface FlowStep { id: string; elementIds: string[]; caption?: string }`
- `interface Flow { id: string; name: string; steps: FlowStep[] }`
- `Diagram.flows?: Flow[]`, `DiagramContent.flows: Flow[]`, `diagramContent(d).flows = d.flows ?? []`
- `addFlow(model, diagramId, flow): Model`, `updateFlow(model, diagramId, id, patch): Model`, `removeFlow(model, diagramId, id): Model`
- Ops `flow.add {diagramId, flow}`, `flow.update {diagramId, id, patch}`, `flow.remove {diagramId, id}`

- [ ] **Step 1: Write the failing tests**

Add to `webapp/src/diff.test.ts`:

```ts
import { applyOps } from './ops'
import { diagramContent } from './model'

describe('flows data layer', () => {
  const base = {
    version: 1, templates: [], entities: [],
    diagrams: [{ id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [], groups: [], edges: [], notes: [] }],
  }
  const flow = { id: 'f1', name: 'Doorbell', steps: [{ id: 's1', elementIds: ['a'], caption: 'press' }] }

  it('adds a flow via diff -> flow.add and applyOps', () => {
    const next = structuredClone(base); (next.diagrams[0] as any).flows = [flow]
    const ops = diffToOps(base, next)
    expect(ops).toContainEqual({ t: 'flow.add', diagramId: 'd', flow })
    expect((applyOps(base, ops).diagrams[0] as any).flows).toEqual([flow])
  })

  it('updates a flow (steps change) via flow.update patch', () => {
    const withFlow = structuredClone(base); (withFlow.diagrams[0] as any).flows = [flow]
    const next = structuredClone(withFlow)
    ;(next.diagrams[0] as any).flows[0].steps.push({ id: 's2', elementIds: ['b'], caption: 'to cam' })
    const ops = diffToOps(withFlow, next)
    expect(ops.some((o) => o.t === 'flow.update' && (o as any).id === 'f1')).toBe(true)
    expect((applyOps(withFlow, ops).diagrams[0] as any).flows[0].steps).toHaveLength(2)
  })

  it('removes a flow via flow.remove', () => {
    const withFlow = structuredClone(base); (withFlow.diagrams[0] as any).flows = [flow]
    const ops = diffToOps(withFlow, base)
    expect(ops).toContainEqual({ t: 'flow.remove', diagramId: 'd', id: 'f1' })
    expect((applyOps(withFlow, ops).diagrams[0] as any).flows).toEqual([])
  })

  it('diagramContent includes flows (undo snapshot)', () => {
    const d = { ...base.diagrams[0], flows: [flow] }
    expect(diagramContent(d as any).flows).toEqual([flow])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run src/diff.test.ts -t "flows data layer"`
Expected: FAIL — `flow.*` ops/types don't exist.

- [ ] **Step 3: Model — types, `Diagram.flows`, `DiagramContent.flows`, mutators**

In `webapp/src/model.ts`:

1. Add types (near `Diagram`):
```ts
export interface FlowStep {
  id: string
  elementIds: string[]
  caption?: string
}
export interface Flow {
  id: string
  name: string
  steps: FlowStep[]
}
```
2. Add `flows?: Flow[]` to the `Diagram` interface.
3. Add `flows: Flow[]` to `DiagramContent`; in `diagramContent`, return `flows: d.flows ?? []`.
4. Add mutators (mirroring `addGroup`/`updateGroup`/`removeGroup`, using the existing `patchDiagram` helper the group mutators use):
```ts
export function addFlow(model: Model, diagramId: string, flow: Flow): Model {
  const d = getDiagram(model, diagramId)
  if (!d) return model
  return patchDiagram(model, diagramId, { flows: [...(d.flows ?? []), flow] })
}
export function updateFlow(model: Model, diagramId: string, id: string, patch: Partial<Omit<Flow, 'id'>>): Model {
  const d = getDiagram(model, diagramId)
  if (!d) return model
  return patchDiagram(model, diagramId, {
    flows: (d.flows ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
  })
}
export function removeFlow(model: Model, diagramId: string, id: string): Model {
  const d = getDiagram(model, diagramId)
  if (!d) return model
  return patchDiagram(model, diagramId, { flows: (d.flows ?? []).filter((f) => f.id !== id) })
}
```
(If `patchDiagram` isn't already used by the group mutators, match whatever those three do exactly — read `addGroup`/`updateGroup`/`removeGroup` and mirror their mechanism.)

- [ ] **Step 4: Ops — `flow.*` in the `Op` union + `applyOp`**

In `webapp/src/ops.ts`:
1. Import `Flow` in the model type import.
2. Add to the `Op` union (next to the `group.*` entries):
```ts
  | { t: 'flow.add'; diagramId: string; flow: Flow }
  | { t: 'flow.update'; diagramId: string; id: string; patch: Partial<Omit<Flow, 'id'>> }
  | { t: 'flow.remove'; diagramId: string; id: string }
```
3. Add `applyOp` cases (next to the `group.*` cases):
```ts
    case 'flow.add':
      return M.addFlow(model, op.diagramId, op.flow)
    case 'flow.update':
      return M.updateFlow(model, op.diagramId, op.id, op.patch)
    case 'flow.remove':
      return M.removeFlow(model, op.diagramId, op.id)
```

- [ ] **Step 5: Diff — diff `flows` via `diffById`**

In `webapp/src/diff.ts`, add `Flow` to the model type import and append a `diffById<Flow>` block in `diffDiagramContents` (after the edges block):
```ts
  ops.push(
    ...diffById<Flow>(
      prev.flows,
      next.flows,
      (f) => ({ t: 'flow.add', diagramId, flow: f }),
      (id, patch) => ({ t: 'flow.update', diagramId, id, patch }),
      (id) => ({ t: 'flow.remove', diagramId, id }),
    ),
  )
```

- [ ] **Step 6: Run tests + full suite + tsc**

Run: `cd webapp && npx vitest run src/diff.test.ts src/model.test.ts && npx tsc --noEmit && npx vitest run`
Expected: new tests PASS; full suite green; tsc clean.

- [ ] **Step 7: Commit**

```bash
cd webapp && git add src/model.ts src/ops.ts src/diff.ts src/diff.test.ts src/model.test.ts
git commit -m "feat: flows data layer — types, mutators, ops, diff, undo content"
```

---

### Task 2: `flowStates` helper

**Files:**
- Create: `webapp/src/flowState.ts`
- Test: `webapp/src/flowState.test.ts`

**Interfaces (produced):**
- `type FlowElemState = 'active' | 'lit'`
- `function flowStates(flow: Flow, stepIndex: number): Record<string, FlowElemState>`

- [ ] **Step 1: Write the failing test**

Create `webapp/src/flowState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { flowStates } from './flowState'

const flow = { id: 'f', name: 'F', steps: [
  { id: 's1', elementIds: ['a'] },
  { id: 's2', elementIds: ['b', 'e1'] },
  { id: 's3', elementIds: ['c'] },
] }

describe('flowStates', () => {
  it('step 0: only the first set is active', () => {
    expect(flowStates(flow, 0)).toEqual({ a: 'active' })
  })
  it('step 1: prior set lit, current set active', () => {
    expect(flowStates(flow, 1)).toEqual({ a: 'lit', b: 'active', e1: 'active' })
  })
  it('last step: earlier all lit, last active', () => {
    expect(flowStates(flow, 2)).toEqual({ a: 'lit', b: 'lit', e1: 'lit', c: 'active' })
  })
  it('clamps out-of-range indices and handles empty flows', () => {
    expect(flowStates(flow, 99).c).toBe('active') // clamped to last
    expect(flowStates(flow, -5)).toEqual({ a: 'active' }) // clamped to 0
    expect(flowStates({ id: 'x', name: 'x', steps: [] }, 0)).toEqual({})
  })
  it('an id appearing in two steps keeps its earliest-lit status but is active if in the current step', () => {
    const f2 = { id: 'f', name: 'F', steps: [{ id: 's1', elementIds: ['a'] }, { id: 's2', elementIds: ['a'] }] }
    expect(flowStates(f2, 1)).toEqual({ a: 'active' })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run src/flowState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Flow } from './model'

export type FlowElemState = 'active' | 'lit'

// Element ids and their state at a given step (cumulative + moving highlight):
// ids in steps[stepIndex] are 'active'; ids in any earlier step (and not in the
// active set) are 'lit'. Ids not returned here are 'ghost' (the renderer's job).
export function flowStates(flow: Flow, stepIndex: number): Record<string, FlowElemState> {
  const out: Record<string, FlowElemState> = {}
  if (flow.steps.length === 0) return out
  const n = Math.max(0, Math.min(stepIndex, flow.steps.length - 1))
  for (let i = 0; i < n; i++) {
    for (const id of flow.steps[i].elementIds) out[id] = 'lit'
  }
  for (const id of flow.steps[n].elementIds) out[id] = 'active'
  return out
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `cd webapp && npx vitest run src/flowState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/flowState.ts src/flowState.test.ts
git commit -m "feat: flowStates helper (active/lit per step)"
```

---

### Task 3: Flow UI state + Flows selector + edit/play mode scaffold

**Files:**
- Modify: `webapp/src/App.tsx`

**Interfaces (produced, in the `Flow` component):**
- state `flowMode: 'none' | 'edit' | 'play'`, `currentFlowId: string | null`, `currentStep: number`, `selStep: number` (selected step in edit)
- helpers `createFlow()`, `renameFlowById(id,name)`, `deleteFlowById(id)`, `selectFlow(id)`, `setFlowMode(mode)`
- `currentFlow = active?.flows?.find(f => f.id === currentFlowId)`

**Context:** The `Flow` component holds diagram UI state (`selNode`, `edgeStyle`, `layoutEngine`, …) and renders the toolbar. `active` is the current `Diagram`. Model edits go through `setModel(...)` (diffed to ops). Reuse the `showPrompt` in-app dialog (from `useDialogs`) for the flow name.

- [ ] **Step 1: Add flow UI state + a Flows control to the toolbar**

In `Flow`, add state near `layoutEngine`:
```ts
const [flowMode, setFlowMode] = useState<'none' | 'edit' | 'play'>('none')
const [currentFlowId, setCurrentFlowId] = useState<string | null>(null)
const [currentStep, setCurrentStep] = useState(0)
const [selStep, setSelStep] = useState(0)
const currentFlow = useMemo(() => active?.flows?.find((f) => f.id === currentFlowId) ?? null, [active, currentFlowId])
```
Add handlers (mirror the diagram-switcher handlers — flush not needed since flows aren't canvas geometry; just `setModel`):
```ts
const createFlow = useCallback(async () => {
  if (!model || !activeId) return
  const name = await showPrompt({ title: 'New flow', label: 'Name', initial: 'Flow' })
  if (!name) return
  const id = `flow-${Date.now().toString(36)}`
  setModel((m) => addFlow(m, activeId, { id, name, steps: [] }))
  setCurrentFlowId(id); setFlowMode('edit'); setSelStep(0); setCurrentStep(0)
}, [model, activeId, setModel, showPrompt])
const renameFlowById = useCallback(async (id: string) => {
  const f = active?.flows?.find((x) => x.id === id); if (!f || !activeId) return
  const name = await showPrompt({ title: 'Rename flow', label: 'Name', initial: f.name })
  if (name) setModel((m) => updateFlow(m, activeId, id, { name }))
}, [active, activeId, setModel, showPrompt])
const deleteFlowById = useCallback((id: string) => {
  if (!activeId) return
  setModel((m) => removeFlow(m, activeId, id))
  if (currentFlowId === id) { setCurrentFlowId(null); setFlowMode('none') }
}, [activeId, currentFlowId, setModel])
```
Import `addFlow`, `updateFlow`, `removeFlow` from `./model`. (If `showPrompt` doesn't exist on `useDialogs`, use the existing prompt dialog the app already uses for diagram rename — read `DiagramBar`/`useDialogs` and reuse that exact call.)

Add a Flows control to the toolbar (next to the Layout selector), rendering a `<select>` of `active?.flows`, a **+ Flow**, **Edit**/**Play** toggle, **Rename**, **Delete** — only enabled when a flow is selected. Exact JSX mirrors the existing `.edgestyle` label + buttons.

- [ ] **Step 2: Reset flow mode on diagram switch**

In the diagram re-seed effect (the one keyed on `[model, activeId]`), when `activeId` changes, reset: `setFlowMode('none'); setCurrentFlowId(null); setCurrentStep(0)`. (Add to the `changed`/diagram-switch branch that already exists.)

- [ ] **Step 3: Typecheck**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Playwright — the selector works and persists**

With `npm run dev` up: load the app, Diagrams tab, pick a diagram. Verify: a **Flows** control is present; **+ Flow** prompts for a name and creates a flow (check `GET /api/model` — the diagram now has a `flows[]` entry); **Rename**/**Delete** work and persist; selecting a flow + **Edit** sets edit mode (no rendering yet — that's Task 4). Close the tab.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/App.tsx
git commit -m "feat: flow UI state + Flows selector (create/rename/delete/mode)"
```

---

### Task 4: Render the light-up state on the canvas

**Files:**
- Modify: `webapp/src/buildGraph.ts`, `webapp/src/App.tsx`, `webapp/src/index.css`

**Interfaces:**
- Consumes: `flowStates` (Task 2), `currentFlow`/`currentStep`/`flowMode` (Task 3).
- Produces: nodes/edges carry `className` reflecting `flow-active`/`flow-lit`/`flow-ghost` when a flow is active.

**Context:** When `flowMode !== 'none'` and a flow is selected, every node/edge gets a class: `flow-active` (in the current step), `flow-lit` (revealed earlier), or `flow-ghost` (not yet). Recompute on step/flow/mode change without a full re-seed by mapping the live nodes/edges.

- [ ] **Step 1: A re-tag effect in `Flow`**

Add an effect keyed on `[currentFlowId, currentStep, flowMode, nodes.length, edges.length]` that sets each node's/edge's `className`:
```ts
useEffect(() => {
  const states = flowMode !== 'none' && currentFlow ? flowStates(currentFlow, currentStep) : null
  const cls = (id: string): string | undefined => {
    if (!states) return undefined
    const s = states[id]
    return s === 'active' ? 'flow-active' : s === 'lit' ? 'flow-lit' : 'flow-ghost'
  }
  setNodes((ns) => ns.map((n) => ({ ...n, className: cls(n.id) })))
  setEdges((es) => es.map((e) => ({ ...e, className: cls(e.id) })))
}, [currentFlowId, currentStep, flowMode, currentFlow, setNodes, setEdges])
```
Import `flowStates` from `./flowState`. (Node/edge `id` for a service node is the `entityId`; for edges the edge id; for groups the group id; for notes the note id — all already the RF node/edge `id`, so `states[id]` matches the spec's element ids.)

- [ ] **Step 2: CSS for the three states + fade**

In `webapp/src/index.css`:
```css
/* Flow walkthrough element states (applied to node/edge wrappers in flow mode) */
.react-flow__node, .react-flow__edge { transition: opacity .2s ease; }
.react-flow__node.flow-ghost, .react-flow__edge.flow-ghost { opacity: .18; }
.react-flow__edge.flow-ghost .react-flow__edge-path { stroke-dasharray: 5 5; }
.react-flow__node.flow-active { box-shadow: 0 0 0 4px color-mix(in srgb, #6366f1 30%, transparent); border-radius: 12px; }
.react-flow__edge.flow-active .react-flow__edge-path { stroke-width: 4 !important; }
```

- [ ] **Step 3: Typecheck**

Run: `cd webapp && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Playwright — states render**

Create a flow with two steps via `POST /api/ops` (flow.add with steps referencing two real element ids from the diagram), select it, enter edit/play. Verify: elements not in any step are faint (`flow-ghost`), the current step's element has the active glow, earlier steps' elements are solid (no ghost). Advance `currentStep` (temporarily via the panel/keys once Task 6 exists, or by re-issuing ops) and confirm the classes move. No console errors. Close the tab.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/App.tsx src/buildGraph.ts src/index.css
git commit -m "feat: render flow light-up (active/lit/ghost) on the canvas"
```

---

### Task 5: Authoring — FlowPanel step editor + click-to-light

**Files:**
- Create: `webapp/src/FlowPanel.tsx`
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- `FlowPanel` props: `{ flow: Flow; mode: 'edit'|'play'; selStep: number; onSelStep: (i:number)=>void; onChange: (steps: FlowStep[]) => void; onExit: () => void; stepCount: number; }` (play-only props added in Task 6).
- Click-to-light: in `flowMode === 'edit'`, clicking a canvas node/edge toggles its id in `steps[selStep].elementIds`.

**Context:** In edit mode the right panel (where `Inspector` renders) shows `FlowPanel` instead. `onChange(steps)` persists via `setModel((m) => updateFlow(m, activeId, currentFlow.id, { steps }))`.

- [ ] **Step 1: Create `FlowPanel.tsx` (edit form)**

A panel listing steps with: caption input, its element chips (each removable), select-step, add-step, move up/down, delete-step, and an Exit button. Full component:
```tsx
import type { Flow, FlowStep } from './model'

export function FlowPanel({
  flow, mode, selStep, onSelStep, onChange, onExit,
}: {
  flow: Flow; mode: 'edit' | 'play'; selStep: number
  onSelStep: (i: number) => void
  onChange: (steps: FlowStep[]) => void
  onExit: () => void
}) {
  const steps = flow.steps
  const setStep = (i: number, patch: Partial<FlowStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const addStep = () => {
    const id = `step-${Date.now().toString(36)}`
    onChange([...steps, { id, elementIds: [], caption: '' }])
    onSelStep(steps.length)
  }
  const removeStep = (i: number) => { onChange(steps.filter((_, idx) => idx !== i)); onSelStep(Math.max(0, i - 1)) }
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= steps.length) return
    const next = steps.slice(); ;[next[i], next[j]] = [next[j], next[i]]; onChange(next); onSelStep(j)
  }
  return (
    <div className="panel insp flowpanel">
      <h4>Flow: {flow.name}</h4>
      {mode === 'edit' && <div className="insp__hint">Click a canvas element to light it up in the selected step.</div>}
      {steps.map((s, i) => (
        <div key={s.id} className={`flowstep ${i === selStep ? 'sel' : ''}`} onClick={() => onSelStep(i)}>
          <div className="flowstep__head"><span className="flowstep__num">{i + 1}</span>
            {mode === 'edit' && (
              <span className="flowstep__ctl">
                <button onClick={(e) => { e.stopPropagation(); move(i, -1) }}>↑</button>
                <button onClick={(e) => { e.stopPropagation(); move(i, 1) }}>↓</button>
                <button onClick={(e) => { e.stopPropagation(); removeStep(i) }}>✕</button>
              </span>
            )}
          </div>
          {mode === 'edit'
            ? <input className="flowstep__cap" value={s.caption ?? ''} placeholder="caption…"
                onClick={(e) => e.stopPropagation()} onChange={(e) => setStep(i, { caption: e.target.value })} />
            : <div className="flowstep__capview">{s.caption || <span className="flowstep__empty">(no caption)</span>}</div>}
          <div className="flowstep__chips">
            {s.elementIds.map((id) => (
              <span key={id} className="flowstep__chip">{id}
                {mode === 'edit' && <button onClick={(e) => { e.stopPropagation(); setStep(i, { elementIds: s.elementIds.filter((x) => x !== id) }) }}>×</button>}
              </span>
            ))}
            {s.elementIds.length === 0 && <span className="flowstep__empty">no elements</span>}
          </div>
        </div>
      ))}
      {mode === 'edit' && <button className="flowstep__add" onClick={addStep}>+ Add step</button>}
      <button className="insp__action" onClick={onExit}>Exit flow</button>
    </div>
  )
}
```

- [ ] **Step 2: Render `FlowPanel` in flow mode + wire click-to-light**

In `App.tsx`, where `<Inspector .../>` renders in the toolbar's `stack-tr`, render `FlowPanel` instead when `flowMode !== 'none' && currentFlow`:
```tsx
{flowMode !== 'none' && currentFlow ? (
  <FlowPanel
    flow={currentFlow} mode={flowMode === 'edit' ? 'edit' : 'play'} selStep={flowMode === 'edit' ? selStep : currentStep}
    onSelStep={(i) => (flowMode === 'edit' ? setSelStep(i) : setCurrentStep(i))}
    onChange={(steps) => activeId && setModel((m) => updateFlow(m, activeId, currentFlow.id, { steps }))}
    onExit={() => setFlowMode('none')}
  />
) : (
  <Inspector … />  /* existing */
)}
```
Add click-to-light: on the `<ReactFlow>` element add `onNodeClick`/`onEdgeClick` that, only when `flowMode === 'edit'`, toggle the element id into the selected step:
```ts
const toggleInStep = useCallback((elementId: string) => {
  if (flowMode !== 'edit' || !currentFlow || !activeId) return
  const steps = currentFlow.steps.map((s, i) => i !== selStep ? s
    : { ...s, elementIds: s.elementIds.includes(elementId)
        ? s.elementIds.filter((x) => x !== elementId)
        : [...s.elementIds, elementId] })
  setModel((m) => updateFlow(m, activeId, currentFlow.id, { steps }))
}, [flowMode, currentFlow, activeId, selStep, setModel])
```
Wire `onNodeClick={(_, n) => toggleInStep(n.id)}` and `onEdgeClick={(_, e) => toggleInStep(e.id)}`. (When there are no steps yet, `FlowPanel`'s **+ Add step** creates one and selects it; guard `toggleInStep` when `currentFlow.steps[selStep]` is undefined.)

- [ ] **Step 3: CSS for FlowPanel**

Add `.flowpanel`, `.flowstep`, `.flowstep.sel`, `.flowstep__*`, `.flowstep__chip`, `.flowstep__add` styles in `index.css` (mirror the `.insp`/`.wp-label` look — small chips, selected row with an accent left bar). Keep it consistent with the Inspector.

- [ ] **Step 4: Typecheck + Playwright**

Run: `cd webapp && npx tsc --noEmit && npx vitest run` (suite still green).
Playwright: create a flow, Edit; **+ Add step**, click two canvas elements → they appear as chips and light up (active); add a second step, click another element; type captions. Reload → steps persist (`GET /api/model`). Undo (Ctrl-Z) reverts the last flow edit. Close the tab.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/FlowPanel.tsx src/App.tsx src/index.css
git commit -m "feat: flow authoring — step editor panel + click-to-light"
```

---

### Task 6: Play mode — Prev/Next, arrow keys, jump, caption + counter

**Files:**
- Modify: `webapp/src/FlowPanel.tsx`, `webapp/src/App.tsx`

**Interfaces:**
- `FlowPanel` (play mode) shows a player header: Prev / Next / step counter, and each step row is click-to-jump (already `onSelStep`).

- [ ] **Step 1: Player controls in `FlowPanel` (play mode)**

Add, at the top of the returned panel, when `mode === 'play'`:
```tsx
{mode === 'play' && (
  <div className="flowplay">
    <button className="pbtn" disabled={selStep <= 0} onClick={() => onSelStep(selStep - 1)}>‹ Prev</button>
    <button className="pbtn" disabled={selStep >= steps.length - 1} onClick={() => onSelStep(selStep + 1)}>Next ›</button>
    <span className="flowplay__count">{steps.length ? selStep + 1 : 0} / {steps.length}</span>
  </div>
)}
```
(`selStep` in play mode is bound to `currentStep` by the parent — see Task 5's render wiring.)

- [ ] **Step 2: Arrow-key stepping**

In `App.tsx`, add a keydown effect active only when `flowMode === 'play'`: `ArrowRight`/`ArrowDown` → `setCurrentStep((s) => Math.min(s + 1, (currentFlow?.steps.length ?? 1) - 1))`; `ArrowLeft`/`ArrowUp` → `setCurrentStep((s) => Math.max(0, s - 1))`; ignore when a text input/textarea is focused; deps `[flowMode, currentFlow]`. Clamp `currentStep` into range whenever the flow/step changes.

- [ ] **Step 3: Typecheck + Playwright**

Run: `cd webapp && npx tsc --noEmit`.
Playwright: with a flow of ≥3 steps, **Play**; Next advances the light-up cumulatively (prior stay lit, current is active, future ghosted); Prev goes back; arrow keys work; clicking a step row jumps to it; the caption + `n / N` counter update. Exit returns to the normal (un-ghosted) view. Close the tab.

- [ ] **Step 4: Commit**

```bash
cd webapp && git add src/FlowPanel.tsx src/App.tsx
git commit -m "feat: flow play mode — prev/next, arrow keys, jump, caption + counter"
```

---

### Task 7: MCP — element-ref resolver + `author_flow`

**Files:**
- Modify: `webapp/server/mcp.ts`
- Test: `webapp/server/mcp.test.ts`

**Interfaces (produced):**
- `resolveElementRef(diagram, ref): string` — `ref` is a string id or `{ from, to }`; returns the resolved element id; throws on no match.
- `handlers.authorFlow(store, { diagramId, name, steps })` → `{ flowId } | ErrorResult`.
- Tool `author_flow`.

**Context:** A step's `elements` may be an element id (entity/edge/group/note) OR `{ from, to }` (resolved to the diagram edge whose `from`/`to` match). Validate every ref resolves to a real diagram element.

- [ ] **Step 1: Write the failing tests**

Add to `webapp/server/mcp.test.ts` (build the store/diagram as the existing tests do, with placed nodes `a`,`b` and an edge `e1` from `a` to `b`):
```ts
describe('author_flow', () => {
  it('creates a flow, resolving ids and {from,to} edge refs', async () => {
    handlers.authorFlow(store, { diagramId: 'd', name: 'F', steps: [
      { elements: ['a'], caption: 'press' },
      { elements: [{ from: 'a', to: 'b' }, 'b'], caption: 'to b' },
    ] })
    const d = getDiagram(store.getState().model, 'd')!
    const f = d.flows!.at(-1)!
    expect(f.name).toBe('F')
    expect(f.steps[0].elementIds).toEqual(['a'])
    expect(f.steps[1].elementIds).toEqual(['e1', 'b']) // {from:a,to:b} resolved to e1
  })
  it('rejects an unknown element ref', () => {
    const res = handlers.authorFlow(store, { diagramId: 'd', name: 'X', steps: [{ elements: ['nope'] }] })
    expect('error' in res).toBe(true)
  })
  it('rejects an unresolvable edge ref', () => {
    const res = handlers.authorFlow(store, { diagramId: 'd', name: 'X', steps: [{ elements: [{ from: 'a', to: 'zzz' }] }] })
    expect('error' in res).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run server/mcp.test.ts -t author_flow`
Expected: FAIL — `handlers.authorFlow` undefined.

- [ ] **Step 3: Implement the resolver + handler + tool**

In `webapp/server/mcp.ts`:
```ts
type ElementRef = string | { from: string; to: string }
export function resolveElementRef(diagram: Diagram, ref: ElementRef): string {
  if (typeof ref !== 'string') {
    const edge = diagram.edges.find((e) => e.from === ref.from && e.to === ref.to)
    if (!edge) throw new Error(`no edge from "${ref.from}" to "${ref.to}"`)
    return edge.id
  }
  const exists =
    diagram.placements.some((p) => p.entityId === ref) ||
    diagram.edges.some((e) => e.id === ref) ||
    diagram.groups.some((g) => g.id === ref) ||
    diagram.notes.some((n) => n.id === ref)
  if (!exists) throw new Error(`unknown element "${ref}" in diagram "${diagram.id}"`)
  return ref
}
```
Handler (in the `handlers` object):
```ts
authorFlow(store: Store, a: { diagramId: string; name: string; steps: { elements: ElementRef[]; caption?: string }[] }): { flowId: string } | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId)
  if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  let steps
  try {
    steps = a.steps.map((s, i) => ({
      id: `step-${i}-${Date.now().toString(36)}`,
      elementIds: s.elements.map((r) => resolveElementRef(diagram, r)),
      caption: s.caption,
    }))
  } catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  const flowId = `flow-${Date.now().toString(36)}`
  store.apply([{ t: 'flow.add', diagramId: a.diagramId, flow: { id: flowId, name: a.name, steps } }], 'mcp')
  return { flowId }
},
```
Register the tool (zod shapes; an element is `z.union([z.string(), z.object({from:z.string(), to:z.string()})])`):
```ts
server.registerTool('author_flow', {
  description: 'Create a named walkthrough (flow) over a diagram: an ordered list of steps that light up elements cumulatively with a moving highlight. Each step lists the elements to light up (by id, or an edge as {from,to}) plus an optional caption.',
  inputSchema: {
    diagramId: z.string(), name: z.string(),
    steps: z.array(z.object({
      elements: z.array(z.union([z.string(), z.object({ from: z.string(), to: z.string() })])),
      caption: z.string().optional(),
    })),
  },
}, (args) => wrap(handlers.authorFlow(store, args as any)))
```

- [ ] **Step 4: Run tests + tsc**

Run: `cd webapp && npx vitest run server/mcp.test.ts && npx tsc --noEmit`
Expected: the three new cases PASS.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add server/mcp.ts server/mcp.test.ts
git commit -m "feat: MCP author_flow + element-ref resolver (id or {from,to})"
```

---

### Task 8: MCP — granular flow tools

**Files:**
- Modify: `webapp/server/mcp.ts`
- Test: `webapp/server/mcp.test.ts`

**Interfaces (produced):** `handlers.addFlowStep`, `setFlowStep`, `removeFlowStep`, `renameFlow`, `deleteFlow`; tools of the same (snake_case) names. `get_diagram` already returns the raw diagram (flows + edge ids) — no change needed there; add an assertion.

- [ ] **Step 1: Write the failing tests**

Add to `webapp/server/mcp.test.ts` (seed a flow via `handlers.authorFlow`, then):
```ts
describe('flow granular tools', () => {
  it('add/set/remove step, rename, delete a flow', () => {
    const { flowId } = handlers.authorFlow(store, { diagramId: 'd', name: 'F', steps: [{ elements: ['a'] }] }) as { flowId: string }
    handlers.addFlowStep(store, { diagramId: 'd', flowId, elements: ['b'], caption: 'two' })
    let f = getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)!
    expect(f.steps).toHaveLength(2)
    const stepId = f.steps[1].id
    handlers.setFlowStep(store, { diagramId: 'd', flowId, stepId, patch: { caption: 'edited' } })
    handlers.removeFlowStep(store, { diagramId: 'd', flowId, stepId })
    handlers.renameFlow(store, { diagramId: 'd', flowId, name: 'F2' })
    f = getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)!
    expect(f.name).toBe('F2'); expect(f.steps).toHaveLength(1)
    handlers.deleteFlow(store, { diagramId: 'd', flowId })
    expect(getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)).toBeUndefined()
  })
  it('get_diagram surfaces flows and edge ids', () => {
    const { flowId } = handlers.authorFlow(store, { diagramId: 'd', name: 'G', steps: [{ elements: [{ from: 'a', to: 'b' }] }] }) as { flowId: string }
    const d = handlers.getDiagram(store, 'd') as any
    expect(d.flows.find((f: any) => f.id === flowId)).toBeTruthy()
    expect(d.edges[0].id).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd webapp && npx vitest run server/mcp.test.ts -t "flow granular"`
Expected: FAIL — handlers undefined.

- [ ] **Step 3: Implement the handlers + tools**

Each reads the flow, computes new `steps`/`name`, and applies a `flow.update` (or `flow.remove`). Add to `handlers`:
```ts
addFlowStep(store, a: { diagramId: string; flowId: string; elements: ElementRef[]; caption?: string; index?: number }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  const flow = diagram.flows?.find((f) => f.id === a.flowId); if (!flow) return err(`unknown flow "${a.flowId}"`)
  let elementIds
  try { elementIds = a.elements.map((r) => resolveElementRef(diagram, r)) } catch (e) { return err(String(e instanceof Error ? e.message : e)) }
  const step = { id: `step-${Date.now().toString(36)}`, elementIds, caption: a.caption }
  const steps = flow.steps.slice(); steps.splice(a.index ?? steps.length, 0, step)
  store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }], 'mcp'); return { ok: true }
},
setFlowStep(store, a: { diagramId: string; flowId: string; stepId: string; patch: { elements?: ElementRef[]; caption?: string } }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  const flow = diagram.flows?.find((f) => f.id === a.flowId); if (!flow) return err(`unknown flow "${a.flowId}"`)
  if (!flow.steps.some((s) => s.id === a.stepId)) return err(`unknown step "${a.stepId}"`)
  let resolved: string[] | undefined
  try { resolved = a.patch.elements?.map((r) => resolveElementRef(diagram, r)) } catch (e) { return err(String(e instanceof Error ? e.message : e)) }
  const steps = flow.steps.map((s) => s.id !== a.stepId ? s : { ...s, ...(resolved ? { elementIds: resolved } : {}), ...(a.patch.caption !== undefined ? { caption: a.patch.caption } : {}) })
  store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps } }], 'mcp'); return { ok: true }
},
removeFlowStep(store, a: { diagramId: string; flowId: string; stepId: string }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  const flow = diagram.flows?.find((f) => f.id === a.flowId); if (!flow) return err(`unknown flow "${a.flowId}"`)
  store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { steps: flow.steps.filter((s) => s.id !== a.stepId) } }], 'mcp'); return { ok: true }
},
renameFlow(store, a: { diagramId: string; flowId: string; name: string }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  if (!diagram.flows?.some((f) => f.id === a.flowId)) return err(`unknown flow "${a.flowId}"`)
  store.apply([{ t: 'flow.update', diagramId: a.diagramId, id: a.flowId, patch: { name: a.name } }], 'mcp'); return { ok: true }
},
deleteFlow(store, a: { diagramId: string; flowId: string }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  store.apply([{ t: 'flow.remove', diagramId: a.diagramId, id: a.flowId }], 'mcp'); return { ok: true }
},
```
Register `add_flow_step`, `set_flow_step`, `remove_flow_step`, `rename_flow`, `delete_flow` with matching zod input shapes (element arrays use the same `z.union([...])` as Task 7). The callbacks are `(args) => wrap(handlers.X(store, args as any))`.

- [ ] **Step 4: Run tests + full suite + tsc**

Run: `cd webapp && npx vitest run server/mcp.test.ts && npx tsc --noEmit && npx vitest run`
Expected: new cases PASS; full suite green; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd webapp && git add server/mcp.ts server/mcp.test.ts
git commit -m "feat: MCP granular flow tools (add/set/remove step, rename, delete)"
```

---

## Self-Review

**Spec coverage:**
- Types + `Diagram.flows` + `DiagramContent` (undo) + mutators + ops + diff → Task 1. ✓
- `flowStates` (active/lit; ghost = renderer) → Task 2. ✓
- Rendering light-up (active/lit/ghost + fade) → Task 4. ✓
- Multiple named flows + selector + edit/play modes (client state) → Task 3. ✓
- Authoring: right panel step list + click-to-light + captions + reorder → Task 5. ✓
- Play: prev/next + arrow keys + jump + caption/counter → Task 6. ✓
- MCP `author_flow` + `{from,to}` resolver + granular tools + `get_diagram` surfaces flows/edge ids → Tasks 7-8. ✓
- Undoable (flows in DiagramContent + diff) → Task 1 (+ verified in Task 5). ✓
- Persisted via existing op/SSE path (live for agent + other clients) → Task 1 plumbing. ✓

**Placeholder scan:** server/model tasks (1,2,7,8) carry complete code + unit tests. Client tasks (3–6) carry complete component/handler code and are browser-verified (no `WaypointEdge`/`App.tsx` unit harness), consistent with prior client work; a couple of steps say "mirror the existing X exactly" pointing at a concrete in-repo pattern (group mutators, `.edgestyle` toolbar, `useDialogs` prompt) rather than an unspecified placeholder.

**Type consistency:** `Flow`/`FlowStep` defined once (Task 1) and consumed by `flowStates` (Task 2), `FlowPanel` (Task 5), and the MCP handlers (Tasks 7-8). `flow.add/update/remove` op shapes match between `ops.ts` (Task 1) and `diff.ts` (Task 1). `flowStates(flow, stepIndex) → Record<id,'active'|'lit'>` matches the Task 4 renderer's `cls()`. `resolveElementRef(diagram, ref)` signature is identical across Tasks 7 and 8. Element ids are the same values everywhere (RF node/edge `id` == placement `entityId`/edge id/group id/note id == the spec's `elementIds`).

**One flagged decision for the reviewer/user:** click-to-light uses React Flow's `onNodeClick`/`onEdgeClick` while in flow-edit mode, which repurposes a normal click; selection/Inspector is replaced by the FlowPanel in that mode, so the two don't collide. If in-mode selecting-without-lighting is ever wanted, that's a follow-up.
