# Entities Page + Free-form Fields + Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free-form entity fields + type templates + a dedicated Entities management page, with per-diagram control over which fields render on nodes.

**Architecture:** Extend the tested pure model layer (`model.ts`) with field/template types, a `fieldVisible` cascade, and CRUD helpers. Lift `model` state to the top-level `App`, add a `Diagrams | Entities` tab shell, and build the Entities page. `buildDiagramGraph` resolves each placement's shown fields; `ServiceNode` renders them; the canvas Inspector sets per-diagram overrides.

**Tech Stack:** Vite + React 18 + TypeScript (strict), `@xyflow/react` v12, vitest, file-backed `model.json`.

## Global Constraints

- Builds on branch `feat/entities-diagrams` (Phase 1). Create/work on `feat/entities-page` off its current HEAD.
- `npm run typecheck` (tsc --noEmit, strict) MUST pass at the end of every task; `npx vitest run` MUST stay green (add tests, never remove).
- New identifiers: only the first letter of a multi-letter acronym is capitalized (`Mcp`, not `MCP`).
- File-backed persistence stays via the existing `/api/model` middleware; whole-model debounced autosave.
- **Do not delete `graph.json`** (Phase-1 migration source/backup). Do not commit `model.json`.
- Field values are **strings**; templates are **soft** (never enforced); no bulk edit / typed fields / field-reordering UI this phase.
- Spec of record: `docs/superpowers/specs/2026-07-25-entities-page-fields-templates-design.md`.

## Current model.ts surface (Phase 1 — do not rewrite, extend)

Types: `Entity{id,label,icon?,sub?,status?,kind?}`, `Placement{entityId,position,parentId?}`, `Group`, `DEdge`, `Note`, `Diagram`, `Model{version,entities,diagrams}`, `Status`, `DiagramType`, `RelType`.
Functions: `entitiesById`, `migrateFromGraph`, `buildDiagramGraph`, `getDiagram`, `updateEntity`, `addEntity`, `deleteEntity`, `addPlacement`, `removePlacement`, `patchDiagram`, `addDiagram`, `renameDiagram`, `deleteDiagram`, `loadModel`, `saveModel`.

---

## File Structure

- Modify `webapp/src/model.ts` — new types (`EntityField`, `TemplateField`, `Template`), extend `Entity`/`Placement`/`Model`; add `fieldVisible`, template CRUD, entity-field + placement-override helpers; resolve `shownFields` in `buildDiagramGraph`; default new fields in `migrateFromGraph`/`loadModel`.
- Modify `webapp/src/model.test.ts` — unit tests for all of the above.
- Modify `webapp/src/nodes.tsx` — `ServiceNode` renders `data.shownFields`.
- Modify `webapp/src/App.tsx` — lift model state to `App`; tab bar; render Diagrams view or Entities page; the current `Flow` becomes a view taking model/activeId as props.
- Create `webapp/src/EntitiesPage.tsx` — table + detail editor.
- Create `webapp/src/Templates.tsx` — template management (rendered inside EntitiesPage).
- Modify `webapp/src/Inspector.tsx` — per-diagram field show/hide checklist for a selected service node.
- Modify `webapp/src/index.css` — tab bar, entities page, field-line, checklist styles.

---

## Task 1: Extend types + migration defaults

**Files:** Modify `webapp/src/model.ts`, `webapp/src/model.test.ts`

**Interfaces — Produces:**
- `EntityField { key: string; value: string; showOnNode?: boolean }`
- `TemplateField { key: string; showOnNode?: boolean; default?: string }`
- `Template { id: string; name: string; icon?: string; fields: TemplateField[] }`
- `Entity` gains `template?: string; fields: EntityField[]`
- `Placement` gains `fieldShow?: Record<string, boolean>`
- `Model` gains `templates: Template[]`
- `normalizeModel(m: any): Model` — fills defaults (`templates ??= []`, each entity `fields ??= []`).

- [ ] **Step 1: Write failing test**

Add to `model.test.ts`:
```ts
import { normalizeModel } from './model'
describe('normalizeModel', () => {
  it('fills new fields with safe defaults', () => {
    const m = normalizeModel({ version: 1, entities: [{ id: 'plex', label: 'Plex' }], diagrams: [] })
    expect(m.templates).toEqual([])
    expect(m.entities[0].fields).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`normalizeModel` not exported): `cd webapp && npx vitest run src/model.test.ts`

- [ ] **Step 3: Implement**

In `model.ts`, add the type members and:
```ts
export interface EntityField { key: string; value: string; showOnNode?: boolean }
export interface TemplateField { key: string; showOnNode?: boolean; default?: string }
export interface Template { id: string; name: string; icon?: string; fields: TemplateField[] }
```
Extend the existing interfaces: add `template?: string` and `fields: EntityField[]` to `Entity`; `fieldShow?: Record<string, boolean>` to `Placement`; `templates: Template[]` to `Model`.
Add:
```ts
export function normalizeModel(m: any): Model {
  return {
    version: m.version ?? 1,
    templates: Array.isArray(m.templates) ? m.templates : [],
    entities: (m.entities ?? []).map((e: any) => ({ ...e, fields: Array.isArray(e.fields) ? e.fields : [] })),
    diagrams: m.diagrams ?? [],
  }
}
```
Update `migrateFromGraph`'s returned model to include `templates: []` and each entity `fields: []`. Update `loadModel` to `return normalizeModel(m)` for the 200 branch and to include `templates: []` in the empty fallback.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Typecheck + commit**

`cd webapp && npm run typecheck`
```bash
git add webapp/src/model.ts webapp/src/model.test.ts
git commit -m "feat(model): free-form fields + templates types; normalizeModel defaults

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `fieldVisible` cascade

**Files:** Modify `webapp/src/model.ts`, `webapp/src/model.test.ts`

**Interfaces — Produces:** `fieldVisible(placement: Placement | undefined, entity: Entity, template: Template | undefined, key: string): boolean` — resolves placement override → entity default → template default → false.

- [ ] **Step 1: Write failing tests**
```ts
import { fieldVisible, type Entity, type Template, type Placement } from './model'
describe('fieldVisible cascade', () => {
  const tmpl: Template = { id: 't', name: 'Container', fields: [{ key: 'image', showOnNode: true }, { key: 'port' }] }
  const ent: Entity = { id: 'e', label: 'E', template: 't', fields: [{ key: 'image', value: 'x' }, { key: 'ip', value: '1.2.3.4', showOnNode: true }, { key: 'port', value: '80' }] }
  it('template default applies when nothing overrides', () => {
    expect(fieldVisible(undefined, ent, tmpl, 'image')).toBe(true)   // template says show
    expect(fieldVisible(undefined, ent, tmpl, 'port')).toBe(false)   // template default false
  })
  it('entity default overrides template', () => {
    expect(fieldVisible(undefined, ent, tmpl, 'ip')).toBe(true)      // entity showOnNode
  })
  it('placement override wins', () => {
    const p: Placement = { entityId: 'e', position: { x: 0, y: 0 }, fieldShow: { image: false, port: true } }
    expect(fieldVisible(p, ent, tmpl, 'image')).toBe(false)          // placement hides what template showed
    expect(fieldVisible(p, ent, tmpl, 'port')).toBe(true)           // placement shows what template hid
  })
  it('defaults to false with no signal', () => {
    expect(fieldVisible(undefined, { id: 'x', label: 'X', fields: [{ key: 'a', value: 'b' }] }, undefined, 'a')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**
```ts
export function fieldVisible(placement: Placement | undefined, entity: Entity, template: Template | undefined, key: string): boolean {
  const po = placement?.fieldShow?.[key]
  if (po !== undefined) return po
  const ef = entity.fields.find((f) => f.key === key)?.showOnNode
  if (ef !== undefined) return ef
  const tf = template?.fields.find((f) => f.key === key)?.showOnNode
  if (tf !== undefined) return tf
  return false
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Typecheck + commit** (`feat(model): fieldVisible cascade helper`)

---

## Task 3: `buildDiagramGraph` resolves `shownFields`

**Files:** Modify `webapp/src/model.ts`, `webapp/src/model.test.ts`

**Interfaces — Consumes:** `fieldVisible`. **Produces:** each service node's `data.shownFields: { key: string; value: string }[]` (ordered as `entity.fields`), resolved against its placement + entity template. `buildDiagramGraph` signature changes to also take the `Model` (for templates): `buildDiagramGraph(diagram, byId, templates: Template[] = [])`.

- [ ] **Step 1: Write failing test**
```ts
import { buildDiagramGraph } from './model'
describe('buildDiagramGraph shownFields', () => {
  const templates = [{ id: 't', name: 'C', fields: [{ key: 'image', showOnNode: true }] }]
  const byId = { plex: { id: 'plex', label: 'Plex', template: 't', fields: [{ key: 'image', value: 'lscr/plex' }, { key: 'ip', value: '10.0.0.5', showOnNode: true }, { key: 'note', value: 'hi' }] } }
  const diagram = { id: 'd', name: 'D', title: 'D', type: 'canvas' as const, groups: [], notes: [], edges: [],
    placements: [{ entityId: 'plex', position: { x: 0, y: 0 }, parentId: null, fieldShow: { ip: false } }] }
  it('passes only visible fields, in order', () => {
    const { nodes } = buildDiagramGraph(diagram as any, byId as any, templates as any)
    const plex = nodes.find((n) => n.id === 'plex')!
    expect((plex.data as any).shownFields).toEqual([{ key: 'image', value: 'lscr/plex' }]) // template shows image; placement hid ip; note default off
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — change `buildDiagramGraph(diagram, byId, templates: Template[] = [])`; when building each service node, compute:
```ts
const tmpl = e.template ? templates.find((t) => t.id === e.template) : undefined
const shownFields = (e.fields ?? []).filter((f) => fieldVisible(p, e, tmpl, f.key)).map((f) => ({ key: f.key, value: f.value }))
```
and include `shownFields` in the node `data`. (Existing callers pass 2 args → defaults to `[]` templates, so old tests still pass; App will pass `model.templates` in Task 7.)

- [ ] **Step 4: Run — expect PASS** (and existing buildDiagramGraph test still green)
- [ ] **Step 5: Typecheck + commit** (`feat(model): resolve per-placement shownFields in buildDiagramGraph`)

---

## Task 4: Template + entity-field helpers

**Files:** Modify `webapp/src/model.ts`, `webapp/src/model.test.ts`

**Interfaces — Produces (all pure):**
- `addTemplate(model, name): { model: Model; id: string }`
- `updateTemplate(model, id, patch: Partial<Omit<Template,'id'>>): Model`
- `deleteTemplate(model, id): Model` (also clears `entity.template` on entities that used it)
- `applyTemplate(entity, template): Entity` — adds the template's field keys not already on the entity (value = `default ?? ''`), sets `entity.template = template.id`, and `entity.icon ??= template.icon`.
- `setEntityFields(model, entityId, fields: EntityField[]): Model`

- [ ] **Step 1: Write failing tests**
```ts
import { addTemplate, deleteTemplate, applyTemplate, setEntityFields } from './model'
const base = { version: 1, templates: [], entities: [{ id: 'e', label: 'E', fields: [] }], diagrams: [] } as any
describe('template + field helpers', () => {
  it('addTemplate returns unique id and appends', () => {
    const { model, id } = addTemplate(base, 'Container')
    expect(model.templates.find((t: any) => t.id === id)?.name).toBe('Container')
  })
  it('applyTemplate seeds fields + icon + template id (soft, no dupes)', () => {
    const tmpl = { id: 't', name: 'C', icon: 'docker', fields: [{ key: 'image', default: 'nginx' }, { key: 'port' }] }
    const e = applyTemplate({ id: 'e', label: 'E', fields: [{ key: 'image', value: 'keep' }] } as any, tmpl as any)
    expect(e.template).toBe('t'); expect(e.icon).toBe('docker')
    expect(e.fields).toEqual([{ key: 'image', value: 'keep' }, { key: 'port', value: '' }]) // existing image kept, port added
  })
  it('deleteTemplate clears entity.template references', () => {
    const m = { ...base, templates: [{ id: 't', name: 'C', fields: [] }], entities: [{ id: 'e', label: 'E', template: 't', fields: [] }] }
    const out = deleteTemplate(m as any, 't')
    expect(out.templates).toHaveLength(0)
    expect(out.entities[0].template).toBeUndefined()
  })
  it('setEntityFields replaces an entity\'s fields immutably', () => {
    const out = setEntityFields(base, 'e', [{ key: 'a', value: 'b', showOnNode: true }])
    expect(out.entities[0].fields).toEqual([{ key: 'a', value: 'b', showOnNode: true }])
    expect(base.entities[0].fields).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**
```ts
export function addTemplate(model: Model, name: string): { model: Model; id: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const existing = new Set(model.templates.map((t) => t.id))
  let id = `t-${slug}`
  for (let n = 2; existing.has(id); n++) id = `t-${slug}-${n}`
  const t: Template = { id, name, fields: [] }
  return { model: { ...model, templates: [...model.templates, t] }, id }
}
export function updateTemplate(model: Model, id: string, patch: Partial<Omit<Template, 'id'>>): Model {
  return { ...model, templates: model.templates.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)) }
}
export function deleteTemplate(model: Model, id: string): Model {
  return {
    ...model,
    templates: model.templates.filter((t) => t.id !== id),
    entities: model.entities.map((e) => (e.template === id ? { ...e, template: undefined } : e)),
  }
}
export function applyTemplate(entity: Entity, template: Template): Entity {
  const have = new Set(entity.fields.map((f) => f.key))
  const added = template.fields.filter((tf) => !have.has(tf.key)).map((tf) => ({ key: tf.key, value: tf.default ?? '' }))
  return { ...entity, template: template.id, icon: entity.icon ?? template.icon, fields: [...entity.fields, ...added] }
}
export function setEntityFields(model: Model, entityId: string, fields: EntityField[]): Model {
  return { ...model, entities: model.entities.map((e) => (e.id === entityId ? { ...e, fields } : e)) }
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Typecheck + commit** (`feat(model): template CRUD + applyTemplate + setEntityFields`)

---

## Task 5: Placement field-show override helper

**Files:** Modify `webapp/src/model.ts`, `webapp/src/model.test.ts`

**Interfaces — Produces:** `setFieldShow(model, diagramId, entityId, key, value: boolean | undefined): Model` — sets `placement.fieldShow[key]=value`, or removes the key (reset to inherit) when `value === undefined`.

- [ ] **Step 1: Write failing test**
```ts
import { setFieldShow } from './model'
describe('setFieldShow', () => {
  const m = { version: 1, templates: [], entities: [], diagrams: [{ id: 'd', name: 'D', title: 'D', type: 'canvas', groups: [], edges: [], notes: [],
    placements: [{ entityId: 'e', position: { x: 0, y: 0 } }] }] } as any
  it('sets and clears an override', () => {
    const on = setFieldShow(m, 'd', 'e', 'ip', true)
    expect(on.diagrams[0].placements[0].fieldShow).toEqual({ ip: true })
    const cleared = setFieldShow(on, 'd', 'e', 'ip', undefined)
    expect(cleared.diagrams[0].placements[0].fieldShow).toEqual({})
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**
```ts
export function setFieldShow(model: Model, diagramId: string, entityId: string, key: string, value: boolean | undefined): Model {
  return {
    ...model,
    diagrams: model.diagrams.map((d) =>
      d.id !== diagramId ? d : {
        ...d,
        placements: d.placements.map((p) => {
          if (p.entityId !== entityId) return p
          const fs = { ...(p.fieldShow ?? {}) }
          if (value === undefined) delete fs[key]
          else fs[key] = value
          return { ...p, fieldShow: fs }
        }),
      },
    ),
  }
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Typecheck + commit** (`feat(model): per-diagram setFieldShow override helper`)

---

## Task 6: `ServiceNode` renders `shownFields`

**Files:** Modify `webapp/src/nodes.tsx`, `webapp/src/index.css`. Verify: typecheck + Playwright.

- [ ] **Step 1: Implement** — in `ServiceNode`, after the existing sub line, render:
```tsx
{Array.isArray((d as any).shownFields) && (d as any).shownFields.length > 0 && (
  <div className="node__fields">
    {(d as any).shownFields.map((f: { key: string; value: string }) => (
      <div className="node__field" key={f.key}><span className="node__field-k">{f.key}</span>{f.value}</div>
    ))}
  </div>
)}
```
Add to `index.css`:
```css
.node__fields { padding: 0 10px 6px 40px; }
.node__field { font-size: 10px; color: #475569; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node__field-k { color: #94a3b8; margin-right: 4px; }
```

- [ ] **Step 2: Typecheck** — `cd webapp && npm run typecheck` (exit 0).
- [ ] **Step 3: Verify (Playwright, by controller after commit)** — with a temporary entity field marked showOnNode, the node shows a `key value` line; with none, nodes look unchanged. (No behavior change to existing nodes since none have `shownFields` yet.)
- [ ] **Step 4: Commit** (`feat(nodes): render entity shownFields as node lines`)

---

## Task 7: App shell — lift model state, `Diagrams | Entities` tabs

**Files:** Modify `webapp/src/App.tsx`, `webapp/src/index.css`. Verify: typecheck + Playwright regression.

**Interfaces — Produces:** `App` owns `model`/`setModel`/`activeId`/`setActiveId` (moved out of `Flow`) + `loadModel`/`saveModel` autosave; renders a tab bar and either the Diagrams view (`Flow`, receiving `model, setModel, activeId, setActiveId` as props) or `<EntitiesPage model setModel onJump={(diagramId)=>{setActiveId(diagramId); setView('diagrams')}} />`.

- [ ] **Step 1: Refactor** — move the model/activeId `useState`, the `loadModel` mount effect, and the debounced `saveModel` effect from `Flow()` up into `App()`. Keep `<ReactFlowProvider>` wrapping only the Diagrams view. Add `const [view, setView] = useState<'diagrams'|'entities'>('diagrams')`. `Flow` now takes `{ model, setModel, activeId, setActiveId }` props and drops its own model loading/saving; it still owns canvas state (`useNodesState`/`useEdgesState`), the re-seed effect, write-back, and all handlers. Pass `model.templates` into every `buildDiagramGraph(active, byId, model.templates)` call.
- [ ] **Step 2: Tab bar** — render at top: `<div className="tabbar"><button className={view==='diagrams'?'active':''} onClick={()=>setView('diagrams')}>Diagrams</button><button className={view==='entities'?'active':''} onClick={()=>setView('entities')}>Entities</button></div>`; below it, `view==='diagrams' ? <ReactFlowProvider><Flow .../></ReactFlowProvider> : <EntitiesPage .../>`. Add `.tabbar` styles.
- [ ] **Step 3: Typecheck** (exit 0), `npx vitest run` green.
- [ ] **Step 4: Verify (Playwright, controller)** — Diagrams tab renders the canvas exactly as before (44 nodes / 7 groups on Logical, editing + switching still work, autosaves to model.json); Entities tab switch works (page mounts). No console errors.
- [ ] **Step 5: Commit** (`feat(app): lift model state; Diagrams | Entities tab shell`)

Note: `EntitiesPage` is created in Task 8 — for this task, a minimal placeholder `EntitiesPage` (renders a heading) is acceptable so the shell compiles; Task 8 fills it in.

---

## Task 8: Entities page — table + detail editor

**Files:** Create `webapp/src/EntitiesPage.tsx`; Modify `webapp/src/index.css`, `webapp/src/App.tsx` (pass props). Verify: typecheck + Playwright.

**Interfaces — Consumes:** `model`, `setModel`, `onJump(diagramId)`, and model helpers (`entitiesById`, `updateEntity`, `addEntity`, `deleteEntity`, `setEntityFields`, `applyTemplate`, `ICON_BASE`). **Produces:** `EntitiesPage` component.

- [ ] **Step 1: Implement the table + detail editor.** `EntitiesPage`:
  - Left: a **table** of `model.entities` — columns: icon (`${ICON_BASE}/${icon}.svg` or initials), label, template name, status, `fields.length` summary, and **used-in count** = number of `model.diagrams` whose `placements` include the entity id (clickable → a small popover listing those diagram names, each calling `onJump(diagram.id)`).
  - A **search** input (filter by label/field keys/values) and a **template filter** select.
  - A **+ New entity** button (prompt label → `addEntity(model, { id: slug, label, fields: [] })`, dedupe slug), and optional template pick that runs `applyTemplate` before adding.
  - Right: a **detail editor** for the selected row — inputs for label (`updateEntity`), icon, status, sub; a **template** `<select>` (choosing one runs `setModel(m => ({...m, entities: m.entities.map(e => e.id===id ? applyTemplate(e, template) : e)}))`); an editable **fields** list: rows of `key` / `value` inputs + a "show on node (default)" checkbox, an add-row (`+ field`) and per-row remove, all writing via `setEntityFields`. A **Delete entity** button that shows the used-in count and confirms, then `deleteEntity`.
  - Full component code lives here; use controlled inputs bound to the selected entity, and `setModel` for every change (whole-model autosave persists it).
- [ ] **Step 2: Styles** — add `.entities-page`, table, and `.detail` editor styles to `index.css` (match the existing panel look).
- [ ] **Step 3: Typecheck** (exit 0).
- [ ] **Step 4: Verify (Playwright, controller)** — Entities tab shows all entities; editing a label/adding a field persists to `model.json`; used-in count is correct; jump switches to the Diagrams tab + that diagram; delete removes from catalog + diagrams. Restore any test edits.
- [ ] **Step 5: Commit** (`feat(entities): management page table + detail editor`)

---

## Task 9: Templates management

**Files:** Create `webapp/src/Templates.tsx`; Modify `webapp/src/EntitiesPage.tsx` (mount it), `webapp/src/index.css`. Verify: typecheck + Playwright.

**Interfaces — Consumes:** `model`, `setModel`, helpers `addTemplate`, `updateTemplate`, `deleteTemplate`. **Produces:** `Templates` section component.

- [ ] **Step 1: Implement** `Templates` — a section on the Entities page listing `model.templates`; each editable: name, default icon slug, and a list of field rows (`key` + "show on node (default)" checkbox + optional default value), add/remove row via `updateTemplate`. `+ New template` (prompt name → `addTemplate`). Delete template (confirm; `deleteTemplate` — reminds it clears the type from entities that used it). Mount `<Templates model setModel />` in `EntitiesPage` (e.g., a collapsible section or side column).
- [ ] **Step 2: Styles** for the templates section.
- [ ] **Step 3: Typecheck** (exit 0).
- [ ] **Step 4: Verify (Playwright, controller)** — create a template with a field (showOnNode default true); apply it to an entity on the Entities page → the entity gains the field; on a diagram, that entity's node shows the field (template default). Delete the template → entities keep their fields but lose the `template` link. Restore test edits.
- [ ] **Step 5: Commit** (`feat(entities): template management`)

---

## Task 10: Inspector per-diagram field overrides

**Files:** Modify `webapp/src/Inspector.tsx`, `webapp/src/App.tsx`. Verify: typecheck + Playwright.

**Interfaces — Consumes (Inspector new props):** `fields: { key: string; value: string; effective: boolean; overridden: boolean }[]`, `onFieldShow(key, value: boolean | undefined)`. App computes `fields` for the selected service node from its entity + placement + template via `fieldVisible`, and wires `onFieldShow` → `setModel(setFieldShow(model, activeId, selNode, key, value))`.

- [ ] **Step 1: Inspector** — in the service-node branch, if the entity has fields, add a "Fields on this node" checklist: each field a checkbox (`checked = effective`) that calls `onFieldShow(key, e.target.checked)`; when `overridden`, show a small **reset** button calling `onFieldShow(key, undefined)`. (Values are read-only here — edited on the Entities page.)
- [ ] **Step 2: App wiring** — compute the `fields` prop for the selected node:
```ts
const selEntity = selNode ? byId[selNode] : undefined
const selPlacement = active?.placements.find((p) => p.entityId === selNode)
const selTemplate = selEntity?.template ? model?.templates.find((t) => t.id === selEntity.template) : undefined
const inspectorFields = selEntity ? selEntity.fields.map((f) => ({
  key: f.key, value: f.value,
  effective: fieldVisible(selPlacement, selEntity, selTemplate, f.key),
  overridden: selPlacement?.fieldShow?.[f.key] !== undefined,
})) : []
const onFieldShow = (key: string, value: boolean | undefined) => activeId && setModel(setFieldShow(model!, activeId, selNode!, key, value))
```
Pass `fields={inspectorFields}` and `onFieldShow` to `<Inspector>`.
- [ ] **Step 3: Typecheck** (exit 0), vitest green.
- [ ] **Step 4: Verify (Playwright, controller)** — an entity placed in two diagrams: toggling a field's checkbox in the Inspector on diagram A shows it on A's node only (B unaffected, and `placement.fieldShow` written); reset clears the override so it falls back to the entity/template default. Restore test edits.
- [ ] **Step 5: Commit** (`feat(inspector): per-diagram field show/hide overrides`)

---

## Self-Review

**Spec coverage:** free-form fields (T1), templates + types (T1,T4), field-visibility cascade (T2), shownFields resolution (T3), placement override helper (T5), node rendering (T6), tab shell + lifted state (T7), Entities page table+editor+usage/jump (T8), template management (T9), Inspector per-diagram overrides with reset (T10), migration defaults (T1), verification per task. Two editing surfaces (page defaults vs Inspector per-diagram) map to T8/T9 vs T10. Non-goals (typed fields, bulk, enforced templates, per-field icons) excluded. **No gaps.**

**Placeholder scan:** model tasks (T1–T5) carry complete code + tests; UI tasks (T6–T10) give component responsibilities + the load-bearing code (node render block, cascade wiring, override wiring) with typecheck+Playwright gates — consistent with Phase 1's plan. No "TBD"/"handle edge cases"/"similar to Task N".

**Type consistency:** `EntityField`/`TemplateField`/`Template` and the extended `Entity`/`Placement`/`Model` are used consistently; `buildDiagramGraph(diagram, byId, templates=[])` keeps the 2-arg default so Phase-1 tests pass while App passes `model.templates`; `fieldVisible(placement, entity, template, key)`, `setFieldShow(model, diagramId, entityId, key, value)`, `applyTemplate(entity, template)`, `setEntityFields(model, entityId, fields)`, `addTemplate/updateTemplate/deleteTemplate`, `normalizeModel` are stable across tasks.
