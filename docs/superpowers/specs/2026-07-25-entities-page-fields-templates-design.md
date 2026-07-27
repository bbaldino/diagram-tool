# Entities Page + Free-form Fields + Templates — Design

**Date:** 2026-07-25
**Status:** Draft for review
**Builds on:** the entity-catalog + multi-diagram restructure (branch `feat/entities-diagrams`,
spec `2026-07-24-entities-and-diagrams-design.md`). This is "Phase 2."

## Goal

Turn entities into a first-class, richly-editable catalog: give them **free-form fields**,
let **templates** predefine fields per type, add a dedicated **Entities management page**
(a second top-level tab), and let each diagram **choose which fields render on its nodes**.

## Data model changes

Extend the existing `Model`/`Entity`/`Placement` (in `webapp/src/model.ts`):

```ts
interface EntityField { key: string; value: string; showOnNode?: boolean }      // showOnNode = entity-level default
interface Entity {
  id: string; label: string; icon?: string; status?: Status; sub?: string       // first-class (rendered)
  template?: string                                                              // template id, if created from one
  fields: EntityField[]                                                          // free-form; ordered
}

interface TemplateField { key: string; showOnNode?: boolean; default?: string }
interface Template { id: string; name: string; icon?: string; fields: TemplateField[] }

interface Placement {
  entityId: string; position: {x,y}; parentId?: string | null
  fieldShow?: Record<string, boolean>   // per-diagram override: fieldKey -> show/hide (present = override)
}

interface Model { version: number; entities: Entity[]; diagrams: Diagram[]; templates: Template[] }
```

label / icon / status / sub stay first-class (they're specially rendered). Everything else
is a free-form `EntityField`.

## Field-visibility cascade (the heart of it)

For an entity's field `key`, in a specific diagram (via its placement), effective visibility
is the first defined of:

1. `placement.fieldShow[key]` — **per-diagram override**
2. `entity.field(key).showOnNode` — **entity default**
3. `template.field(key).showOnNode` (entity's template, matching key) — **template default**
4. `false`

Helper: `fieldVisible(placement, entity, template, key): boolean`. Field **values** always
come from the entity (`EntityField.value`); templates only seed keys + defaults at creation.

`buildDiagramGraph` resolves, per placement, the ordered list of `{ key, value }` shown
fields and passes them to the node as `data.shownFields`.

## Two editing surfaces

- **Entities page** — the catalog + **defaults**: entity field values, per-field entity
  default (`showOnNode`), templates and their field defaults. "Show this field wherever this
  entity appears."
- **Canvas Inspector** (node selected) — **per-diagram overrides only**: a checklist of the
  entity's fields with show/hide *for this diagram's node* (writes `placement.fieldShow[key]`).
  A checkbox reflects the current effective value; toggling writes an explicit override; a
  small **"reset"** per field clears the override back to inherit. (Field *values* are edited
  on the Entities page, not here.)

## App shell

- A top **tab bar: `Diagrams | Entities`**, driven by a simple `view: 'diagrams' | 'entities'`
  state — no router dependency.
- Refactor so **model state is lifted to the top-level `App`** (`model`, `setModel`, `loadModel`/
  `saveModel`, `activeId`); both the Diagrams view (the current `Flow`/canvas) and the Entities
  page consume it. `Flow` receives `model`/`setModel`/`activeId` as props instead of owning them.

## Entities page

- A **table** of all entities: icon · label · template · status · a short fields summary ·
  **"used in N diagrams"**. Clicking the usage cell lists the diagrams; clicking one jumps
  (switch to Diagrams tab + set that active diagram).
- **Search** (text over label/fields) + **filter by template**.
- Selecting a row opens a **detail editor** (side panel): label, icon (slug), status, sub,
  **template** picker, and the editable **fields** list — add/remove `key`/`value` rows, each
  with a "show on node (default)" checkbox (the entity-level default).
- **+ New entity** (optional template picker → prefills fields from the template's keys +
  defaults, and default icon). **Delete entity** — shows its usage count and warns before
  removing from the catalog + all diagrams (reuses `deleteEntity`).

## Templates

- A **Templates** section on the Entities page: create / edit / delete templates — name,
  default icon, and a list of field keys each with a default `showOnNode`.
- Templates are **soft presets**: creating an entity from (or switching it to) a template
  adds the template's fields to the entity (with `default` value, else empty), but the entity
  can freely add, remove, or override any field afterward. Templates are never enforced schemas.

## Node rendering

`ServiceNode` renders, in order: label + icon + status dot + `sub`, then each `data.shownFields`
entry as a small secondary line (`key: value`). Nodes with no shown fields look exactly as today.

## Migration (additive, automatic)

On load of an existing `model.json` (from Phase 1), fill in the new fields with safe defaults:
`Model.templates ??= []`; each `Entity.fields ??= []` (and `template` stays undefined);
placements get no `fieldShow`. Nothing is lost; existing nodes render unchanged. `graph.json`
remains the original backup.

## File structure

- `webapp/src/model.ts` — extend types; add `fieldVisible()`; `buildDiagramGraph` resolves
  `shownFields` per placement; add template CRUD helpers (`addTemplate`, `updateTemplate`,
  `deleteTemplate`) and entity-field helpers (`setEntityFields`, `applyTemplate`); extend
  `entity`/placement helpers as needed. Update `migrateFromGraph`/load defaults.
- `webapp/src/App.tsx` — lift model state; tab bar; render Diagrams view or Entities page.
- `webapp/src/DiagramsView.tsx` (or keep `Flow` in App) — the current canvas, now receiving
  model/activeId as props.
- `webapp/src/EntitiesPage.tsx` — the table + detail editor.
- `webapp/src/Templates.tsx` — template management (or a section within EntitiesPage).
- `webapp/src/nodes.tsx` — `ServiceNode` renders `shownFields`.
- `webapp/src/Inspector.tsx` — service branch gains the per-diagram field show/hide checklist.

## Scope guardrails (YAGNI)

- Field values are **strings** only (no number/url/date typing yet).
- No bulk edit; no field reordering beyond add/remove order.
- Templates are soft presets, not enforced.
- Free-form fields do **not** get their own icons or styling — just `key: value` text lines.

## Verification

vitest units for: `fieldVisible` cascade (all 4 levels), `buildDiagramGraph` shown-fields
resolution, template CRUD + `applyTemplate` prefill, migration defaults. Playwright for:
tab switch; entity table + detail edit persists to `model.json`; a template prefills a new
entity; a field with template/entity default shows on the node; a per-diagram Inspector
override flips it for one diagram only (and reset restores inherit).

## Non-goals (this phase)

- Typed fields, validation, bulk operations, field reordering UI, per-field icons.
- Topology / call-flow diagram *types* (still future).
