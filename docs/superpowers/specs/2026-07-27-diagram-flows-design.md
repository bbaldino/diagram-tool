# Diagram Flows (Walkthroughs) Design

**Status:** Design — approved in brainstorming (with mockups), pending spec review.
**Branch:** builds on `main` (the whole prior stack is merged).

## Problem

The diagram is "outside of time" — it shows everything at once. There's no way
to show the **order** in which things happen (a request path, a startup
sequence, a signal fan-out). We want to step through a diagram and have parts
light up in sequence.

## Goal

Add **flows**: named, ordered walkthroughs layered over a diagram. Playing a
flow steps through it (Prev/Next), lighting up elements in order with a moving
highlight, so a viewer sees the sequence. Flows are authored in the app and
also **drivable via the MCP** so an agent can create/edit them.

## Decisions (from brainstorming + mockups)

1. **A flow is a lens over an existing diagram**, not a new diagram type — it
   references the diagram's real elements and never changes the diagram's data.
2. **Multiple named flows per diagram** (`Diagram.flows[]`); pick one to
   play/edit.
3. **"Light up" reveal, cumulative, with a moving active highlight.** At step N:
   - **ghosted** — element never lit in a step ≤ N (faint, dashed, low opacity);
   - **lit** — element lit in some step ≤ N (solid/normal);
   - **active** — element in step N's set specifically (accent glow/ring).
   Earlier sets stay lit but lose the highlight as it advances. ~200ms fade on
   state change (the only "animation").
4. **A step is an explicit set of elements + an optional caption.** No
   auto-lighting — you choose exactly which elements (any type) light up at each
   step. `Step = { id, elementIds[], caption? }`.
5. **Authoring: a right-side step panel + click-to-light** (mockup option B). A
   Flows selector puts you in flow-edit mode; the canvas ghosts out; the right
   panel lists the ordered steps (caption + lit elements + reorder/add/delete);
   clicking a canvas element toggles it into the selected step.
6. **Play: manual only.** Prev/Next buttons, arrow keys, and click-a-step-to-jump;
   current caption + step counter shown.
7. **MCP-drivable.** Flows can be created/edited by the agent via new tools.
8. **Undoable for free** — flows are per-diagram content, so flow edits flow
   through the ops/store/undo pipeline like any other diagram change.

## Non-goals

- Auto-play on a timer (manual stepping only).
- Element animation beyond a simple fade (no motion along edges, etc.).
- Kiosk/presentation mode that hides all app chrome (possible later polish).
- Cross-diagram flows, branching/conditional flows.

## Data model (`webapp/src/model.ts`)

```ts
export interface FlowStep {
  id: string
  elementIds: string[] // ids of diagram elements lit at this step (see element refs)
  caption?: string
}
export interface Flow {
  id: string
  name: string
  steps: FlowStep[]
}
export interface Diagram {
  // …existing…
  flows?: Flow[]
}
```

**Element references.** `elementIds` hold the ids of any element in the
diagram: a placement's `entityId` (node), a `DEdge.id` (edge), a `Group.id`, or
a `Note.id`. These id spaces are effectively distinct in practice (`e-…`,
`g-…`, `note-…`, entity slugs); a step simply stores ids and the renderer maps
each id to whichever element carries it. Ids that no longer resolve (element
deleted) are ignored at render time and can be pruned lazily.

`normalizeModel` defaults `flows` to `[]` when absent. No migration; existing
diagrams simply have no flows.

**Mutators** (pure, tested, mirroring the existing `addGroup`/`updateGroup`/
`removeGroup`): `addFlow(model, diagramId, flow)`, `updateFlow(model, diagramId,
id, patch)`, `removeFlow(model, diagramId, id)`. The flow object (including its
client-assigned `id` and full `steps`) is created UI-side; renaming, adding a
step, editing a caption, reordering, etc. all just produce a new `Flow` object
that flows through `updateFlow`'s patch. Thin UI helpers (`addStep`, `setStep`,
`removeStep`, `moveStep`) compute the new `steps` array and hand it to the model
update.

## Ops / persistence / diff / undo

Flows are **per-diagram content**, so they join the existing pipeline exactly
like groups/edges/notes (the `diffById` add/update/remove pattern — the op
carries the full object with its own id, so client and server never diverge on
the id, and a steps change is simply part of the `update` patch):

- `ops.ts` — add `flow.add {diagramId, flow}`, `flow.update {diagramId, id,
  patch}` (patch = the changed `Flow` minus `id`, i.e. `name` and/or `steps`),
  `flow.remove {diagramId, id}`. `applyOp` routes them to the mutators above.
- `diff.ts` — extend `diffDiagramContents` to diff `flows` via the existing
  generic `diffById` helper (same as `groups`/`notes`/`edges`), so the client
  write-back persists flow edits, and so `DiagramContent` (undo snapshots)
  includes `flows`. This makes flow edits **undoable/redoable** with everything
  else.
- `model.ts` `DiagramContent` + `diagramContent()` gain `flows`.

Because flows ride the op/SSE path, an agent's flow edits appear **live** in the
open app, and human flow edits stream to other clients — same as all other
edits.

## Rendering (`webapp/src/buildGraph.ts` + a small flow-state helper + `App.tsx`)

A pure helper computes, for a flow at step index `n`, each element id's state:

```ts
type FlowElemState = 'active' | 'lit' | 'ghost'
function flowStates(flow: Flow, stepIndex: number): Record<string, FlowElemState>
// active = ids in steps[stepIndex]; lit = ids in steps[0..stepIndex-1] not in active;
// everything else in the diagram = ghost.
```

When a flow is being played or edited, `buildGraph` (or a post-pass in `Flow`)
tags each node/edge with a `flowState` (via node `data` / edge `data` +
`className`), and CSS renders `.ghost` (faint/dashed, low opacity), plain
(lit), and `.active` (accent ring/glow), with a fade transition. When no flow
is active, rendering is exactly as today (no `flowState`). Edges reference their
own id; groups/notes likewise.

The **current flow + step + mode** (none | edit | play) is client UI state (like
the active diagram / selected engine) — not stored in the model.

## Authoring UI (flow-edit mode)

- A **Flows** control near the diagram toolbar (mirrors the diagram switcher):
  select a flow, **+ Flow** (create), rename, delete. Selecting a flow and
  choosing **Edit** enters flow-edit mode.
- In flow-edit mode: the canvas ghosts the whole diagram; the right panel (the
  Inspector slot) becomes the **Flow editor** — an ordered list of steps, each
  row showing its caption (editable) and its lit elements (as chips, removable),
  with add-step / reorder (up/down) / delete-step controls. The selected step is
  highlighted; the canvas shows that step's cumulative light-up.
- **Click-to-light:** with a step selected, clicking a canvas element toggles it
  in/out of that step's `elementIds` (it lights/unlights immediately). Works for
  nodes, edges, groups, notes.
- An **Exit / Play** control leaves edit mode or switches to play.

## Play UI (play mode)

- Entering play mode shows the flow at step 0. Controls: **Prev / Next**
  buttons, **←/→ arrow keys**, and **clicking a step** in the panel jumps to it.
- The current **caption** and **step counter** (e.g. "2 / 4") are shown.
- The canvas renders the light-up state for the current step (fade on advance).
- Exit returns to the normal (non-flow) diagram view.

## MCP surface (`webapp/server/mcp.ts`)

Mirror the existing `author_diagram` (one-shot) + granular-tools pattern. All
apply ops via `store.apply(ops, 'mcp')` so edits appear live.

- **`author_flow({ diagramId, name, steps: [{ elements: (string | { from, to })[], caption? }] })`**
  — create a flow with ordered steps. Each `elements` entry is an element id
  (entity/edge/group/note) **or**, for convenience, an edge given as
  `{ from, to }` resolved to the matching edge's id (so an agent doesn't need to
  look up generated edge ids). Validates every reference resolves to an element
  in the diagram (throws otherwise). Returns `{ flowId }`.
- **Granular:** `add_flow_step({ diagramId, flowId, elements, caption?, index? })`,
  `set_flow_step({ diagramId, flowId, stepId, patch:{ elements?, caption? } })`,
  `remove_flow_step({ diagramId, flowId, stepId })`,
  `rename_flow({ diagramId, flowId, name })`, `delete_flow({ diagramId, flowId })`.
- **`get_diagram`** is extended to include `flows` (with step ids, element ids,
  captions) and to surface each edge's `id`, so an agent can read and reference
  the current flows/elements. (Optionally a thin `list_flows` — but `get_diagram`
  covers it.)
- Tool descriptions explain the light-up/cumulative model so an agent authors
  sensible step sequences.

Element-reference resolution (id or `{from,to}` → element id, with existence
validation) is a small shared server helper reused by `author_flow` and the
step tools.

## Phasing (for the implementation plan)

1. **Model + ops + diff + undo** — types, mutators, `flow.*` ops, `diffDiagramContents`/`DiagramContent` include flows, round-trip + undo tests.
2. **Flow-state helper + canvas rendering** — `flowStates`, node/edge `flowState` tagging, `.ghost/.lit/.active` CSS with fade; render given a flow+step (no UI yet, driven by temporary state or a test hook).
3. **Play mode** — flow select + play controls (Prev/Next/arrows/jump), caption/counter.
4. **Authoring mode** — flow-edit panel (step list, click-to-light, reorder), Flows create/rename/delete.
5. **MCP tools** — `author_flow` + granular + `get_diagram`/edge-id surfacing + the element-ref resolver.

Each phase is independently testable (1 and 5 unit-tested; 2–4 browser-verified,
consistent with existing client work). The plan may split these into finer
tasks.

## Testing

- **Model/ops/diff (vitest):** flow mutators; `flow.*` op round-trips via
  `diffToOps`/`applyOps`; `flowStates` helper (active/lit/ghost at each step);
  `DiagramContent`/undo includes flows (a flow edit is undoable).
- **MCP (vitest):** `author_flow` validates element refs (id + `{from,to}`),
  rejects unknown refs, stores steps; granular step/flow tools mutate correctly;
  `get_diagram` includes flows + edge ids.
- **Client (Playwright):** author a flow (click-to-light builds steps), play it
  (Prev/Next/arrows/jump light up cumulatively with the active highlight),
  ghost/lit/active render correctly, exit returns to the normal view; a flow
  edit is undoable.

## Files (anticipated)

- `webapp/src/model.ts` — `Flow`/`FlowStep` types, `Diagram.flows`,
  `DiagramContent.flows`, mutators, `normalizeModel`.
- `webapp/src/ops.ts`, `webapp/src/diff.ts` — `flow.*` ops + flows diff.
- `webapp/src/flowState.ts` (new) — `flowStates` helper (pure, shared).
- `webapp/src/buildGraph.ts` + `webapp/src/App.tsx` — apply `flowState`,
  flow-edit + play UI, Flows selector, click-to-light.
- `webapp/src/FlowPanel.tsx` (new) — the step-list editor/player panel.
- `webapp/src/index.css` — `.ghost/.active` element styling + fade.
- `webapp/server/mcp.ts`, `webapp/server/authoring.ts` (or a new
  `webapp/server/flows.ts`) — MCP flow tools + element-ref resolver.
- Tests alongside each.
