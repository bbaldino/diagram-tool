# Model Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the catalog-based model with a flat, diagram-local model — every object is an `Entity` (uuid identity) with `Node`/`Group`/`Note`/`Edge` subtypes — with uuid ids throughout and no `Entity`/`Placement`/catalog machinery.

**Architecture:** Bottom-up rewrite. The node-side core (`ids`, `model`, `ops`, `diff`, `store`) and `mcp` are unit-testable in isolation; the client (`buildGraph`, `App`, `Inspector`, …) is migrated last and restores whole-project `tsc` + full-suite green. Existing diagram data is disposable — no migration; old-shape models seed fresh.

**Tech Stack:** Vite + React + TypeScript, React Flow v12, Vitest (node env), `uuid`, Playwright (MCP) for browser checks. Root: `webapp/`.

**Spec:** `docs/superpowers/specs/2026-07-28-model-redesign-phase1-design.md`

## Global Constraints

- Commands run from `webapp/`. Types: `npx tsc --noEmit`. Tests: `npx vitest run`.
- **Intermediate tasks won't whole-project-compile, and vitest can't boot via `vite.config.ts`** mid-sequence — `vite.config.ts` eagerly imports the whole server chain (`store`/`mcp`/`authoring`/`layout`), so a half-migrated chain is a hard rolldown module-load error that stops vitest from starting *any* test. Therefore Tasks 2-5 verify their named test files with a **scratch node config that bypasses `vite.config.ts`**:
  `npx vitest run --config /home/bbaldino/work/homelab-diagram/.superpowers/sdd/2026-07-28-model-redesign-phase1/vitest.node.mjs <test files>` (run from `webapp/`). Do NOT run `npx tsc --noEmit` or the plain `npx vitest run` in Tasks 2-5. **Task 5** additionally confirms the whole server chain module-loads by running the plain `npx vitest run server/ src/model.test.ts src/ops.test.ts src/diff.test.ts src/ids.test.ts` (node/server files) once it's consistent. **Task 7** restores whole-project `tsc --noEmit` clean + the full plain `npx vitest run`.
- Ids: **bare uuid v4** via `newId()` (Task 1), everywhere (nodes/groups/notes/edges/diagrams/flows/steps/templates). Never `crypto.randomUUID()` (secure-context-only; the app is plain-HTTP LAN).
- No native `window.alert/prompt/confirm` — use `useDialogs()` (`Dialog.tsx`).
- Capitalize only the first letter of multi-letter acronyms.
- Don't commit `model.json`/`history.json` (git-ignored).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Out of scope (Phase 2):** the MCP resolution/search layer. In this phase MCP tools just operate on the new model and return uuids.

## File Map

- `webapp/src/ids.ts` **(new)** — `newId()`.
- `webapp/src/model.ts` — new types (`Entity` base + `Node`/`Group`/`Note`/`Edge`), mutators (`node.*` replacing `entity.*`+`placement.*`), `removeGroup` frees all child kinds, `normalizeModel` resets old-shape, `DiagramContent` with `nodes[]`.
- `webapp/src/ops.ts` — `node.*` ops replace `entity.*`/`placement.*`; drop `placement.fieldShow`; retype the rest.
- `webapp/src/diff.ts` — `diffPlacements` → generic `diffById<Node>`; retype.
- `webapp/server/store.ts`, `webapp/server/history.ts` — `DiagramContent` shape; mechanism unchanged.
- `webapp/server/mcp.ts` — tools on the new model; `entity`→`node`; creation returns uuids.
- `webapp/server/authoring.ts` — retype to the new model (`addEntity`+`addPlacement`→`addNode`; `Placement`→`Node`; edges via `newId()`); it's `author_diagram`'s builder, imported by `mcp.ts`.
- `webapp/server/layout.ts` — retype to the new model (`Placement`→`Node`, `entityId`→node `id`, `DEdge`→`Edge`); it lays out a diagram's nodes; imported by `authoring.ts` and `App.tsx`'s tidy path.
- `webapp/src/buildGraph.ts` — build RF nodes/edges from new arrays; parents-before-children topological order.
- `webapp/src/App.tsx`, `Inspector.tsx`, `nodes.tsx`, `WaypointEdge.tsx` — new model; uuid creation; reparent cycle guard.
- **Delete:** `webapp/src/EntitiesPage.tsx`, `webapp/src/Palette.tsx`.

---

### Task 1: `newId()` helper + `uuid` dependency

**Files:** Create `webapp/src/ids.ts`, `webapp/src/ids.test.ts`; modify `webapp/package.json` (via install).

**Interfaces (produced):** `newId(): string` — a bare uuid v4. Consumed by every later task that mints ids.

- [ ] **Step 1: Add the dependency**

Run: `cd webapp && npm install uuid` (latest; ships its own types). Verify `uuid` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test** — `webapp/src/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newId } from './ids'

describe('newId', () => {
  it('returns a bare uuid v4 (no prefix), distinct each call', () => {
    const a = newId()
    const b = newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 3: Run to confirm failure** — `npx vitest run src/ids.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** — `webapp/src/ids.ts`:
```ts
import { v4 as uuidv4 } from 'uuid'

// Bare uuid v4. Uses the uuid lib (getRandomValues-based) so it works in a
// non-secure browser context (plain-HTTP LAN) — unlike crypto.randomUUID().
export function newId(): string {
  return uuidv4()
}
```

- [ ] **Step 5: Run + commit** — `npx vitest run src/ids.test.ts` → PASS. Commit `src/ids.ts src/ids.test.ts package.json package-lock.json` (`feat: newId() uuid helper`).

---

### Task 2: New model types + mutators (`model.ts`)

**Files:** Modify `webapp/src/model.ts`; rewrite `webapp/src/model.test.ts`.

**Interfaces (produced):** the types below, plus mutators `addNode`/`updateNode`/`removeNode`/`setNodeFields`/`applyTemplate(node, template)`, group/note/edge/flow/template/diagram mutators (retyped), `removeGroup`, `normalizeModel`, `diagramContent`, `getDiagram`, `nodesById` (per-diagram). Consumed by Tasks 3-7.

**Consumes:** `newId` from `./ids` (Task 1).

- [ ] **Step 1: Replace the type block** in `model.ts` with:
```ts
export interface Entity { id: string }              // base: pure identity (uuid)

export interface Field { key: string; value: string; showOnNode?: boolean }

export interface Node extends Entity {
  label: string
  icon?: string
  sub?: string
  status?: Status
  actor?: boolean            // was Entity.kind === 'actor'
  template?: string          // Template id
  fields: Field[]
  position: { x: number; y: number }
  parentId?: string          // containing Group id
}
export interface Group extends Entity {
  label: string; color: string
  position: { x: number; y: number }; size: { width: number; height: number }
  parentId?: string
}
export interface Note extends Entity {
  text: string
  position: { x: number; y: number }; size: { width: number; height: number }
  parentId?: string
}
export interface Edge extends Entity {
  from: string; to: string; type: RelType
  label?: string; inferred?: boolean
  shape?: 'default' | 'smoothstep' | 'straight'
  points?: { x: number; y: number }[]
  sourceHandle?: string; targetHandle?: string
  dir?: EdgeDir; color?: string; labelPos?: number; orientation?: EdgeOrientation
}
export interface Diagram {
  id: string; name: string; title: string; type: DiagramType
  nodes: Node[]; groups: Group[]; notes: Note[]; edges: Edge[]; flows: Flow[]
}
export interface DiagramContent {
  nodes: Node[]; groups: Group[]; notes: Note[]; edges: Edge[]; flows: Flow[]
}
export interface Model { version: number; diagrams: Diagram[]; templates: Template[] }
```
Keep `Status`, `DiagramType`, `Template`, `TemplateField`, `Flow`, `FlowStep`, `RelType`, `EdgeDir`, `EdgeOrientation`. Delete `Entity` (old service shape), `Placement`, `EntityField` (renamed `Field`; update `Template.fields`/`TemplateField` if they referenced `EntityField`). Delete `entitiesById`; add `nodesById(diagram): Record<string, Node>`.

- [ ] **Step 2: Rewrite mutators.** Node mutators mirror the old entity+placement ones but operate on `diagram.nodes[]`:
```ts
export function addNode(model: Model, diagramId: string, node: Node): Model {
  return mapDiagram(model, diagramId, (d) =>
    d.nodes.some((n) => n.id === node.id) ? d : { ...d, nodes: [...d.nodes, node] })
}
export function updateNode(model: Model, diagramId: string, id: string, patch: Partial<Omit<Node, 'id'>>): Model {
  return mapDiagram(model, diagramId, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n)) }))
}
export function removeNode(model: Model, diagramId: string, id: string): Model {
  return mapDiagram(model, diagramId, (d) => ({
    ...d,
    nodes: d.nodes.filter((n) => n.id !== id),
    edges: d.edges.filter((e) => e.from !== id && e.to !== id), // drop touching edges
  }))
}
export function setNodeFields(model: Model, diagramId: string, id: string, fields: Field[]): Model {
  return updateNode(model, diagramId, id, { fields })
}
export function applyTemplate(node: Node, template: Template): Node {
  const have = new Set(node.fields.map((f) => f.key))
  const added = template.fields.filter((tf) => !have.has(tf.key)).map((tf) => ({ key: tf.key, value: tf.default ?? '' }))
  return { ...node, template: template.id, icon: node.icon ?? template.icon, fields: [...node.fields, ...added] }
}
```
Retype `addGroup`/`updateGroup`/`addNote`/`updateNote`/`removeNote`/`addEdge`/`updateEdge`/`removeEdge`/`add/update/removeFlow` to the new types (same bodies, `Diagram.*` arrays). `deleteTemplate` clears `node.template` on nodes across all diagrams (was `entity.template`). Keep `addTemplate`/`updateTemplate`/`applyTemplate`-driven flows, `addDiagram` (empty `nodes/groups/notes/edges/flows`), `renameDiagram`, `deleteDiagram` (+ its ad-hoc sweep is obsolete — nodes are diagram-local, so `deleteDiagram` just filters diagrams; DELETE the sweep logic added earlier).

- [ ] **Step 3: `removeGroup` frees all child kinds** (containment generalization):
```ts
export function removeGroup(model: Model, diagramId: string, id: string): Model {
  const clear = <T extends { parentId?: string }>(xs: T[]) =>
    xs.map((x) => (x.parentId === id ? { ...x, parentId: undefined } : x))
  return mapDiagram(model, diagramId, (d) => ({
    ...d, groups: clear(d.groups.filter((g) => g.id !== id)), nodes: clear(d.nodes), notes: clear(d.notes),
  }))
}
```

- [ ] **Step 4: `normalizeModel` resets old-shape models** (disposable data):
```ts
export function normalizeModel(m: any): Model {
  // Old catalog-shape models (top-level `entities`) are not migrated — the data
  // is disposable. Seed a fresh empty model instead.
  if (!m || Array.isArray(m.entities)) return { version: 2, diagrams: [], templates: [] }
  return {
    version: 2,
    templates: Array.isArray(m.templates) ? m.templates : [],
    diagrams: Array.isArray(m.diagrams) ? m.diagrams : [],
  }
}
export function diagramContent(d: Diagram): DiagramContent {
  return { nodes: d.nodes, groups: d.groups, notes: d.notes, edges: d.edges, flows: d.flows ?? [] }
}
```

- [ ] **Step 5: Rewrite `model.test.ts`** to the new shape. Cover: `addNode`/`updateNode`/`removeNode` (removeNode drops touching edges); `setNodeFields`; `applyTemplate` seeds fields/icon/template on a Node; `removeGroup` clears `parentId` on child nodes AND child groups AND child notes; `addDiagram` empty arrays; `deleteDiagram` filters only diagrams; `normalizeModel` resets an old-shape `{entities:[...]}` model to `{version:2,diagrams:[],templates:[]}` and passes a new-shape model through. Use `newId()`-style string ids in fixtures (literal strings are fine).

- [ ] **Step 6: Run scoped test + commit** — `npx vitest run src/model.test.ts` → PASS (do NOT run tsc/full-suite yet). Commit `src/model.ts src/model.test.ts` (`feat: entity-base model types + node mutators (no catalog)`).

---

### Task 3: Ops + diff (`ops.ts`, `diff.ts`)

**Files:** Modify `webapp/src/ops.ts`, `webapp/src/diff.ts`; update `webapp/src/ops.test.ts`, `webapp/src/diff.test.ts`.

**Consumes:** Task 2 types + mutators.
**Produces:** `node.*` op variants; `applyOps`, `diffDiagramContents`, `diffToOps` on the new model.

- [ ] **Step 1: Ops.** In `ops.ts`, replace the `entity.*` and `placement.*` variants with:
```ts
  | { t: 'node.add'; diagramId: string; node: Node }
  | { t: 'node.update'; diagramId: string; id: string; patch: Partial<Omit<Node, 'id'>> }
  | { t: 'node.remove'; diagramId: string; id: string }
  | { t: 'node.setFields'; diagramId: string; id: string; fields: Field[] }
```
Drop `placement.fieldShow` entirely. Retype `edge.add`(`edge: Edge`), etc. In `applyOps`, wire `node.*` to the Task 2 mutators; `template.applyTemplate` becomes node-scoped (`applyTemplate(node, template)` within a diagram). Keep `template.*`/`diagram.*`/`group.*`/`note.*`/`edge.*`/`flow.*`.

- [ ] **Step 2: Diff.** In `diff.ts`, DELETE `diffPlacements`; in `diffDiagramContents`, diff nodes with the generic helper:
```ts
  ops.push(...diffById<Node>(
    prev.nodes, next.nodes,
    (n) => ({ t: 'node.add', diagramId, node: n }),
    (id, patch) => ({ t: 'node.update', diagramId, id, patch }),
    (id) => ({ t: 'node.remove', diagramId, id }),
  ))
```
Keep the groups/notes/edges/flows `diffById` calls (retyped). `diffToOps` drops the `entities`-level diff (no `model.entities`); keep `templates` + `diagrams` diffs.

- [ ] **Step 3: Update `ops.test.ts` + `diff.test.ts`** to the new ops/shape: a `node.add`/`node.update`/`node.remove` round-trip; `diffDiagramContents` emits `node.*` when nodes change; a node move (position) emits `node.update`. Remove placement/fieldShow cases.

- [ ] **Step 4: Run scoped tests + commit** — `npx vitest run src/ops.test.ts src/diff.test.ts` → PASS. Commit (`feat: node.* ops + diff (drop entity/placement/fieldShow)`).

---

### Task 4: Store + history (`store.ts`, `history.ts`)

**Files:** Modify `webapp/server/store.ts`, `webapp/server/history.ts`; update `webapp/server/store.test.ts`, `webapp/server/history.test.ts`.

**Consumes:** Tasks 2-3. **Produces:** store/history on the new `DiagramContent`.

- [ ] **Step 1:** `history.ts` is type-generic over `DiagramContent` — update its import/type usage to the new `DiagramContent` (nodes-based). The reconcile/record/seed mechanism is unchanged. `store.ts` `recordHistory`/`navigate` already use `diagramContent`/`diffDiagramContents` — they work once those are retyped; verify no `entities`/`placement` references remain.

- [ ] **Step 2: Update `store.test.ts`/`history.test.ts`** fixtures to the new `DiagramContent` shape (`{nodes,groups,notes,edges,flows}`). The undo-durability tests keep their intent; swap `placements:[…]` for `nodes:[…]` in fixtures (a node needs `label`+`position`).

- [ ] **Step 3: Run scoped tests + commit** — `npx vitest run server/store.test.ts server/history.test.ts` → PASS. Commit (`feat: store/history on nodes-based DiagramContent`).

---

### Task 5: Finish the server chain — layout + authoring + MCP (`layout.ts`, `authoring.ts`, `mcp.ts`)

**Files:** Modify `webapp/server/layout.ts`, `webapp/server/authoring.ts`, `webapp/server/mcp.ts`; update `webapp/server/mcp.test.ts` (+ any `authoring`/`layout` tests present).

**Consumes:** Tasks 2-4. **Produces:** the whole server chain consistent with the new model — after this, `vite.config.ts` module-loads and plain vitest boots again.

- [ ] **Step 0 — layout.ts + authoring.ts (unblock vitest boot):** Retype `layout.ts` (`Placement`→`Node` with inline `position`; `entityId`→ node `id`; `DEdge`→`Edge`; return `{ nodes, groups, edges }`) and `authoring.ts` (`addEntity`+`addPlacement`→`addNode` building a `Node` with `position`; mint ids via `newId()`; `Placement`→`Node`). These are what break `vite.config.ts` today — they must compile-load for the plain suite to run.

- [ ] **Step 1:** Retype MCP handlers to the new model: node creation/placement collapses to a single "add node" (mint `newId()`, push to `diagram.nodes`); `set_edge`/`connect`/`remove`/flow tools operate on uuids; `resolveElementRef` resolves `{from,to}`→edge uuid and validates ids against `diagram.nodes/groups/notes/edges`. Rename `entity`→`node` in tool names/args/descriptions (e.g. `place_entity`→`add_node`, `list_entities`→`list_nodes`). **Creation/authoring tools return the created uuid(s)** in their result. `get_diagram` returns the new model (uuids + labels).

- [ ] **Step 2: Update `mcp.test.ts`** to the new tool shapes/names, asserting created uuids are returned and referenced.

- [ ] **Step 3: Verify the server chain module-loads (plain vitest boots again).** With layout/authoring/mcp all retyped, run the node/server suite with the NORMAL config: `npx vitest run server/ src/model.test.ts src/ops.test.ts src/diff.test.ts src/ids.test.ts` → all boot + PASS (this proves `vite.config.ts` loads again). Commit (`feat: server chain (layout/authoring/mcp) on the node model`).

- [ ] **Step 4 (note for the executor):** Tool renames change the agent-facing surface. That's acceptable (data + interface are disposable pre-Phase-2). The full resolution/search layer is Phase 2.

---

### Task 6: buildGraph on the new model (`buildGraph.ts`)

**Files:** Modify `webapp/src/buildGraph.ts`; update `webapp/src/buildGraph` tests if present (else browser-verified in Task 7).

**Consumes:** Task 2 types. **Produces:** `buildDiagramGraph(diagram, templates)` returning RF nodes/edges from `nodes[]`/`groups[]`/`notes[]`/`edges[]`.

- [ ] **Step 1:** Build RF nodes from `diagram.nodes` (each carries its own `position`/`parentId`/fields — no `entitiesById`, no placement join), `diagram.groups`, `diagram.notes`; build edges from `diagram.edges` (keep `edge.id = de.id`, waypoint data). Drop the `byId`/templates-catalog lookup that joined placements to entities; fields come straight off the node (apply `Template` defaults by `node.template` if still shown on-node).

- [ ] **Step 2: Topological parent ordering.** React Flow requires a parent node to appear before its children. Emit group nodes ordered outer-to-inner (a group with a `parentId` comes after its parent), then child nodes/notes. Implement a small stable topological sort over groups by `parentId`.

- [ ] **Step 3:** Type-check this module in isolation is not possible (whole-project tsc). Defer verification to Task 7 (tsc + browser). Commit (`feat: buildGraph on the node model + nested-group ordering`).

---

### Task 7: Client integration + delete catalog UI (whole-project green)

**Files:** Modify `webapp/src/App.tsx`, `webapp/src/Inspector.tsx`, `webapp/src/nodes.tsx`, `webapp/src/WaypointEdge.tsx`, `webapp/src/CanvasAddMenu.tsx`; delete `webapp/src/EntitiesPage.tsx`, `webapp/src/Palette.tsx`; remove their imports/refs/CSS.

**Consumes:** all prior tasks. **Produces:** a working app on the new model; whole-project `tsc` clean + full suite green.

- [ ] **Step 1: `App.tsx`** — replace the canvas↔model write-back (`nodesToDiagramParts`/`flushCanvasInto`) to map RF nodes→`diagram.nodes` (position/parentId/fields inline), RF groups→`groups`, notes→`notes`, edges→`edges`; delete all `entitiesById`/catalog/`placement`/`fieldShow` logic. Create handlers (`createEntityFromLabel`→`createNode`, `addGroup`, `addNote`, `onConnect`, reconnect) mint ids via `newId()`. Add a **reparent cycle guard**: when setting a node/group's `parentId`, reject if the target is a descendant. Remove the `EntitiesPage`/`Palette` imports, the `view` tab state (already single-view), and any `onCreateEntity`→catalog wiring (keep the ＋-menu create-node path).

- [ ] **Step 2: `Inspector.tsx` / `nodes.tsx` / `WaypointEdge.tsx`** — read fields/label/status directly off the `Node` (no placement/`fieldShow` indirection). Update the empty-state copy already touched earlier if it references removed concepts.

- [ ] **Step 3: Delete** `EntitiesPage.tsx` and `Palette.tsx`; remove dangling imports and their CSS blocks in `index.css`.

- [ ] **Step 4: Whole-project green** — `npx tsc --noEmit` (resolve every remaining reference to old types) then `npx vitest run` (full suite). Both must be clean/green. Delete any dead code the removals orphan (do not silence with eslint-disable).

- [ ] **Step 5: Browser-verify (Playwright; the user may run it if the browser is locked).** Fresh model (old data reset): create a node via ＋→Entity/Node; add a group and drag the node into it; **nest a group inside a group** and a **note inside a group** and confirm they move/clip with the parent; draw an edge and reconnect an endpoint; author a flow step and confirm it lights the element; reload and confirm persistence; confirm no `entities`/catalog UI remains and no console errors.

- [ ] **Step 6: Commit** (`feat: client on the node model; delete catalog UI`).

---

## Self-Review

**Spec coverage:** new types + base (Task 2) ✓; uuids everywhere via `newId` (Task 1, used in 2/5/7) ✓; drop catalog/`entities[]`/`entitiesById` (Task 2) ✓; merge `Placement` into `Node`, drop `fieldShow`/`Placement.note` (Tasks 2-3) ✓; containment `parentId` on Node/Group/Note + nested groups + grouped notes + `removeGroup` frees all kinds + cycle guard + topological build (Tasks 2, 6, 7) ✓; keep `Template` (Task 2) ✓; `node.*` ops replace `entity.*`/`placement.*` (Task 3) ✓; store/history on new content (Task 4) ✓; MCP on new model, returns uuids, `entity`→`node`, resolution layer deferred (Task 5) ✓; delete `EntitiesPage`/`Palette` (Task 7) ✓; data reset via `normalizeModel` (Task 2) ✓; MCP resolution layer NOT here (Phase 2) ✓.

**Placeholder scan:** Contracts (types, op variants, mutator bodies, `normalizeModel`, `removeGroup`, diff wiring) are given in full. Mechanical retyping and client integration point at concrete existing patterns/files rather than restating every line — consistent with prior client-heavy tasks in this repo (browser-verified). Test *cases* are enumerated per task.

**Type consistency:** `Node`/`Group`/`Note`/`Edge`/`Diagram`/`DiagramContent`/`Model` defined in Task 2 and consumed unchanged in 3-7. `newId(): string` (Task 1) used in 2/5/7. `node.*` op names match between Task 3 (ops) and Task 3 (diff) and Task 4/5 consumers. `applyTemplate(node, template)` signature (Task 2) matches its op use (Task 3).

**Note for the executor (verification cadence):** Tasks 1-5 verify with the **named scoped test files only** — do NOT run `tsc --noEmit` or the full `vitest run` until Task 7, because the client is intentionally broken mid-sequence. Task 7 is the barrier that restores whole-project green.
