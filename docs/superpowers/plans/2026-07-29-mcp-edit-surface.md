# MCP Edit-Surface Completion + Shared Containment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the MCP incremental edit surface (`edit_node` incl. reparent, `add_group`/`edit_group`, `add_note`/`edit_note`, diagram lifecycle; rename `set_*`→`edit_*`) and extract the group containment/sizing invariants into a shared server-safe module enforced on the MCP mutation paths.

**Architecture:** Extract the pure containment geometry from `src/graph.ts` into `src/containment.ts` (no `@xyflow`), add a model-level `reflowContainment(diagram)`, and have the new MCP handlers apply it after containment-affecting changes so agent edits get the same padded/sized result as human interaction. Ops for every new tool already exist; handlers just validate + `store.apply` + return ids.

**Tech Stack:** Vite + React + TypeScript, `@modelcontextprotocol/sdk` + zod, Vitest (node env). Root: `webapp/`. The whole node/server chain compiles and the full suite runs normally (no scratch-config needed).

**Spec:** `docs/superpowers/specs/2026-07-29-mcp-edit-surface-design.md`

## Global Constraints

- Commands run from `webapp/`. Types: `npx tsc --noEmit`. Tests: `npx vitest run`. Every task keeps the whole project `tsc` clean and the full suite green (unlike the last plan, there is no broken intermediate).
- No native `window.alert/prompt/confirm`. App served over plain-HTTP LAN — no secure-context-only APIs (ids already use the `uuid` lib, not `crypto.randomUUID()`).
- Capitalize only the first letter of multi-letter acronyms.
- Don't commit `model.json`/`history.json` (git-ignored).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Verb scheme:** create = `add_*`/`connect`/`new_diagram`; edit = `edit_*`; delete = `remove`/`delete_diagram`. Rename `set_edge`→`edit_edge`, `set_note`→`edit_note` (split its create path into `add_note`).
- **Client behavior must not change** — interactive nesting/sizing renders identically after the containment extraction (existing `graph.test.ts`/`buildGraph.test.ts` stay green).
- **Out of scope (follow-ups):** the Tidy-respects-nesting fix, a `find`/search tool, and `author_diagram` upsert. `author_diagram`/`connect`/`remove`/`layout`/flow tools are unchanged except where a rename is listed.

## File Map

- `webapp/src/containment.ts` **(new)** — moved pure geometry (`requiredGroupSize`, `paddedExtent`, `placeInGroup`, constants) + `reflowContainment(diagram)`.
- `webapp/src/containment.test.ts` **(new)**.
- `webapp/src/graph.ts` — re-export the moved symbols (so existing imports/tests keep working); RF-node `reflowGroups`/`growGroupsToFitChildren` become thin adapters over the shared logic (client behavior identical).
- `webapp/server/mcp.ts` — new/renamed handlers + tool registrations; apply `reflowContainment` on containment changes.
- `webapp/server/mcp.test.ts` — tests for the new/renamed tools.

---

### Task 1: Shared containment module + model-level `reflowContainment`

**Files:** Create `webapp/src/containment.ts`, `webapp/src/containment.test.ts`; modify `webapp/src/graph.ts` (re-export + adapters).

**Interfaces (produced):**
- Move verbatim from `graph.ts`: `GROUP_PAD`, `GROUP_MIN`, `GROUP_NEST_TOP_PAD`, `GROUP_SLACK`, `requiredGroupSize`, `paddedExtent`, `placeInGroup` (unchanged signatures/behavior).
- New: `NODE_EST_SIZE = { width: 170, height: 64 }` (node children carry no model size; used only for containment math). New: `reflowContainment(diagram: Diagram): Diagram`.

**Consumes:** model types (`Diagram`, `Group`, `Node`, `Note`) from `./model`. **Must NOT import `@xyflow/react`/React/DOM** (server-safe).

- [ ] **Step 1: Move the pure geometry + constants** out of `webapp/src/graph.ts` into `webapp/src/containment.ts` (cut/paste the existing `requiredGroupSize`, `paddedExtent`, `placeInGroup` and the four constants verbatim). In `graph.ts`, replace them with a re-export so nothing else breaks:
```ts
export { GROUP_PAD, GROUP_MIN, GROUP_NEST_TOP_PAD, GROUP_SLACK, requiredGroupSize, paddedExtent, placeInGroup } from './containment'
```
Point `graph.ts`'s `reflowGroups`/`growGroupsToFitChildren` at the imported helpers (they already use these; just fix the import source). Do NOT change their behavior.

- [ ] **Step 2: Write the failing test** — `webapp/src/containment.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { reflowContainment, GROUP_MIN } from './containment'
import type { Diagram } from './model'

const diagram = (over: Partial<Diagram> = {}): Diagram => ({
  id: 'd', name: 'D', title: 'D', type: 'canvas', nodes: [], groups: [], notes: [], edges: [], flows: [], ...over,
})

describe('reflowContainment', () => {
  it('grows a parent group to contain a reparented child group with padding (no overlap, movable)', () => {
    const d = diagram({
      groups: [
        { id: 'outer', label: 'Outer', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
        { id: 'inner', label: 'Inner', color: '#000', position: { x: 16, y: 32 }, size: { width: 320, height: 200 }, parentId: 'outer' },
      ],
    })
    const out = reflowContainment(d)
    const outer = out.groups.find((g) => g.id === 'outer')!
    // outer grew to contain inner (16 + 320 + pad) x (32 + 200 + pad), plus slack, and is strictly bigger than inner
    expect(outer.size.width).toBeGreaterThan(320 + 16)
    expect(outer.size.height).toBeGreaterThan(200 + 16)
  })

  it('sizes inner groups before outer (inner-first cascade)', () => {
    const d = diagram({
      groups: [
        { id: 'a', label: 'A', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 }, parentId: 'b' },
        { id: 'b', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
        { id: 'c', label: 'C', color: '#000', position: { x: 16, y: 32 }, size: { width: 400, height: 260 }, parentId: 'a' },
      ],
    })
    const out = reflowContainment(d)
    const a = out.groups.find((g) => g.id === 'a')!
    const b = out.groups.find((g) => g.id === 'b')!
    expect(a.size.width).toBeGreaterThanOrEqual(400 + 16)     // a grew to hold c
    expect(b.size.width).toBeGreaterThanOrEqual(a.size.width) // b grew to hold the grown a
  })

  it('leaves a diagram with no containment unchanged (idempotent on flat content)', () => {
    const d = diagram({ groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }] })
    const out = reflowContainment(d)
    expect(out.groups[0].size).toEqual({ width: 300, height: 200 })
  })
})
```

- [ ] **Step 3: Run to confirm failure** — `cd webapp && npx vitest run src/containment.test.ts` → FAIL (`reflowContainment` not defined).

- [ ] **Step 4: Implement `reflowContainment`** in `containment.ts`. Operate on model data (not React Flow nodes): a child's size is `group.size`/`note.size` for group/note children, and `NODE_EST_SIZE` for node children. Grow each group to contain its children with padding + `GROUP_SLACK`, floored at `GROUP_MIN`, processing groups **inner-first** (a group nested in another is sized before its parent) so an outer group contains the grown inner one. Reuse `requiredGroupSize` for the sizing math. Return a new `Diagram` (immutable). Mirror the logic of the existing `growGroupsToFitChildren` in `graph.ts` but over `Diagram.groups`/`nodes`/`notes` instead of RF `Node[]`.

- [ ] **Step 5: Verify** — `cd webapp && npx vitest run src/containment.test.ts src/graph.test.ts src/buildGraph.test.ts && npx tsc --noEmit`. New tests PASS; the moved-helper and client tests stay green (behavior unchanged); tsc clean.

- [ ] **Step 6: Commit**
```bash
cd webapp && git add src/containment.ts src/containment.test.ts src/graph.ts
git commit -m "feat: shared containment module + model-level reflowContainment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: MCP node + group edit tools (with containment)

**Files:** Modify `webapp/server/mcp.ts`, `webapp/server/mcp.test.ts`.

**Consumes:** `reflowContainment` (Task 1); existing ops `node.update`, `group.add`, `group.update`; model mutators; `newId`; the `handlers`/`registerTool` pattern already in `mcp.ts`.

**Produces:** handlers + tools `edit_node`, `add_group`, `edit_group`.

- [ ] **Step 1: A containment-applying apply helper.** Add to `mcp.ts` a small helper so a containment-affecting change is followed by a reflow in the same logical write:
```ts
// Apply ops, then reflow the diagram's containment (padding/sizing) and persist
// the result — so an MCP grouping/reparent lands padded+sized like a human edit.
function applyWithReflow(store: Store, diagramId: string, ops: Op[]): void {
  const before = store.getState().model
  const stepped = applyOps(before, ops)
  const d = getDiagram(stepped, diagramId)
  const reflowed = d ? mapDiagram(stepped, diagramId, reflowContainment) : stepped
  store.apply(diffToOps(before, reflowed), 'mcp')
}
```
(Import `applyOps`/`diffToOps`/`mapDiagram`/`reflowContainment` as needed. This yields one op batch = one write. Handlers that don't touch containment keep using `store.apply` directly.)

- [ ] **Step 2: Add the handlers** to the `handlers` object (mirror the existing `setEdge`/`addNode` shape — validate diagram + element exist, then apply):
```ts
editNode(store: Store, a: { diagramId: string; id: string; patch: Partial<{ label: string; icon: string; sub: string; status: string; actor: boolean; fields: Field[]; parentId: string | null }> }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  if (!diagram.nodes.some((n) => n.id === a.id)) return err(`unknown node "${a.id}" in diagram "${a.diagramId}"`)
  if (a.patch.parentId != null && !diagram.groups.some((g) => g.id === a.patch.parentId)) return err(`unknown group "${a.patch.parentId}"`)
  const touchesContainment = 'parentId' in a.patch
  const op = { t: 'node.update' as const, diagramId: a.diagramId, id: a.id, patch: a.patch }
  if (touchesContainment) applyWithReflow(store, a.diagramId, [op]); else store.apply([op], 'mcp')
  return { ok: true }
},
addGroup(store: Store, a: { diagramId: string; label: string; color?: string; parentId?: string | null; position?: { x: number; y: number }; size?: { width: number; height: number } }): { id: string } | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  if (a.parentId != null && !diagram.groups.some((g) => g.id === a.parentId)) return err(`unknown group "${a.parentId}"`)
  const group = { id: newId(), label: a.label, color: a.color ?? '#64748b', position: a.position ?? { x: 40, y: 40 }, size: a.size ?? { width: 320, height: 200 }, parentId: a.parentId ?? undefined }
  applyWithReflow(store, a.diagramId, [{ t: 'group.add', diagramId: a.diagramId, group }])
  return { id: group.id }
},
editGroup(store: Store, a: { diagramId: string; id: string; patch: Partial<{ label: string; color: string; size: { width: number; height: number }; parentId: string | null }> }): OkResult | ErrorResult {
  const diagram = getDiagram(store.getState().model, a.diagramId); if (!diagram) return err(`unknown diagram "${a.diagramId}"`)
  if (!diagram.groups.some((g) => g.id === a.id)) return err(`unknown group "${a.id}" in diagram "${a.diagramId}"`)
  if (a.patch.parentId != null && !diagram.groups.some((g) => g.id === a.patch.parentId)) return err(`unknown group "${a.patch.parentId}"`)
  applyWithReflow(store, a.diagramId, [{ t: 'group.update', diagramId: a.diagramId, id: a.id, patch: a.patch }])
  return { ok: true }
},
```

- [ ] **Step 3: Register the tools** (3-arg `registerTool` form used in the file), with zod input shapes matching the handler args and descriptions stating what they do + that create returns the id. `edit_node`'s `parentId` doc: "set to a group id to move the node into that group, or null to un-parent."

- [ ] **Step 4: Tests** in `mcp.test.ts`: `edit_node` renames a node (label patch) and reparents it (parentId patch → node's parentId set AND the target group grew to contain it via reflow); `add_group` returns a uuid and the group exists; `edit_group` updates label + reparents (nesting). Use `getDiagram(store.getState().model, 'd')` to assert model state.

- [ ] **Step 5: Verify + commit** — `cd webapp && npx vitest run server/mcp.test.ts && npx tsc --noEmit`. Commit `server/mcp.ts server/mcp.test.ts` (`feat: MCP edit_node/add_group/edit_group + containment`).

---

### Task 3: MCP note tools + `edit_edge` rename

**Files:** Modify `webapp/server/mcp.ts`, `webapp/server/mcp.test.ts`.

**Consumes:** Task 2 (`applyWithReflow`); existing ops `note.add`/`note.update`, `edge.update`.

**Produces:** `add_note`, `edit_note` (split from `set_note`), `edit_edge` (renamed from `set_edge`).

- [ ] **Step 1:** Split the current `setNote` handler into `addNote(store, a)` (create — mint `newId()`, `note.add`, returns `{ id }`; supports `text`/`position`/`size`/`parentId`; applies via `applyWithReflow` when `parentId` set) and `editNote(store, a)` (update by id — `note.update`; `applyWithReflow` when `parentId` in patch). Rename `setEdge`→`editEdge` (identical body). Remove the old `setNote`/`setEdge` handlers.

- [ ] **Step 2:** Update tool registrations: register `add_note`, `edit_note`, `edit_edge`; REMOVE the `set_note` and `set_edge` registrations. Descriptions updated (note `parentId` doc mirrors `edit_node`).

- [ ] **Step 3: Tests** in `mcp.test.ts`: `add_note` returns a uuid + note exists; `edit_note` updates text and reparents a note into a group (group grows via reflow); `edit_edge` updates an edge; assert the old `set_note`/`set_edge` tools are NOT registered and the new names ARE (mirror the existing "old name not registered" regression style already in the test file).

- [ ] **Step 4: Verify + commit** — `cd webapp && npx vitest run server/mcp.test.ts && npx tsc --noEmit`. Commit (`feat: MCP add_note/edit_note + rename set_edge->edit_edge`).

---

### Task 4: MCP diagram lifecycle (`new_diagram`/`rename_diagram`/`delete_diagram`)

**Files:** Modify `webapp/server/mcp.ts`, `webapp/server/mcp.test.ts`.

**Consumes:** existing ops `diagram.add`, `diagram.rename`, `diagram.delete`; model mutators `addDiagram`/`renameDiagram`/`deleteDiagram`.

**Produces:** `new_diagram`, `rename_diagram`, `delete_diagram`.

- [ ] **Step 1: Handlers:**
```ts
newDiagram(store: Store, a: { name: string; type?: 'canvas' | 'topology' | 'call-flow' }): { id: string } {
  const { model, id } = addDiagram(store.getState().model, a.name, a.type ?? 'canvas')
  store.apply(diffToOps(store.getState().model, model), 'mcp')
  return { id }
},
```
(Note: `addDiagram` returns `{model,id}`; emit its diff as ops so it flows through the store, matching how other handlers persist. Alternatively apply a `diagram.add` op directly if that op mints the id — check `ops.ts`; use whichever the op layer supports and keep it one write.)
```ts
renameDiagram(store: Store, a: { id: string; name: string }): OkResult | ErrorResult {
  if (!getDiagram(store.getState().model, a.id)) return err(`unknown diagram "${a.id}"`)
  store.apply([{ t: 'diagram.rename', id: a.id, name: a.name }], 'mcp'); return { ok: true }
},
deleteDiagram(store: Store, a: { id: string }): OkResult | ErrorResult {
  if (!getDiagram(store.getState().model, a.id)) return err(`unknown diagram "${a.id}"`)
  store.apply([{ t: 'diagram.delete', id: a.id }], 'mcp'); return { ok: true }
},
```
(Confirm the exact `diagram.add` op shape in `ops.ts` — if `diagram.add` takes `{name, kind}` and mints the id server-side, `new_diagram` can apply that op and then read back the new id from the resulting model; keep it a single write and return `{ id }`.)

- [ ] **Step 2: Register** `new_diagram`, `rename_diagram`, `delete_diagram` with zod shapes; `new_diagram` returns the id.

- [ ] **Step 3: Tests** in `mcp.test.ts`: `new_diagram` returns a uuid'd empty diagram (nodes/groups/notes/edges all empty); `rename_diagram` changes the name; `delete_diagram` removes it (and `list_diagrams` no longer shows it).

- [ ] **Step 4: Verify (whole suite) + commit** — `cd webapp && npx vitest run && npx tsc --noEmit` (full suite green). Commit (`feat: MCP diagram lifecycle tools`).

- [ ] **Step 5: Browser sanity (Playwright, optional / may need the user):** drive an agent-style MCP sequence — `new_diagram` → `add_node`s → `connect` → `add_group` → `edit_node` reparent — and confirm in the app the group is padded/sized and the child sits inside without overlap (matching a human-built equivalent). If the browser is locked, note it for a human pass.

---

## Self-Review

**Spec coverage:** edit surface — `edit_node`(+parentId) / `add_group` / `edit_group` (Task 2); `add_note` / `edit_note` / `edit_edge` rename (Task 3); `new_diagram` / `rename_diagram` / `delete_diagram` (Task 4). ✓ Shared containment — `containment.ts` + `reflowContainment`, client re-exports/adapters, applied on MCP paths via `applyWithReflow` (Task 1 + used in 2/3). ✓ Consistent verb scheme + `set_*`→`edit_*` renames (Tasks 2-3). ✓ Client behavior unchanged (Task 1 Step 5 re-runs graph/buildGraph tests). ✓ Tidy fix / find tool / author_diagram upsert explicitly out of scope. ✓ POC/scratch diagram cleanup — `delete_diagram` (Task 4) is the tool that makes MCP cleanup possible; the leftover diagrams get removed during finishing.

**Placeholder scan:** contracts (containment signatures, handler bodies, tool set, test cases) are given in full; mechanical tool registration points at the existing `registerTool` pattern in the file. The two "confirm the exact op shape in ops.ts" notes are genuine (the op layer is the source of truth for `diagram.add`'s id handling) — the implementer verifies against `ops.ts` and uses the supported form, single-write.

**Type consistency:** `reflowContainment(diagram: Diagram): Diagram` (Task 1) used by `applyWithReflow` (Task 2) and Task 3. Handler arg/patch field names match the model's `Node`/`Group`/`Note` fields. New op names are not introduced — all handlers use existing ops (`node.update`, `group.add/update`, `note.add/update`, `edge.update`, `diagram.add/rename/delete`), so no ops.ts change is needed.
