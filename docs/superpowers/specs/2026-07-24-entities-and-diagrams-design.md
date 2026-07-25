# Homelab Canvas — Entity Catalog + Multi-Diagram — Design

**Date:** 2026-07-24
**Status:** Draft for review
**Context:** Restructure the React Flow app in `webapp/` (currently a single `graph.json`
of nodes+edges) into a shared **entity catalog** with multiple **diagrams** that are
views over it.

## Motivation

Today a "node" bundles identity, data, position, and group membership into one object,
and there is exactly one diagram. As the user organizes and thinks about "flows," a
cleaner model emerged: **define entities once; place them selectively into many diagrams.**

- The current logical diagram is one view.
- A "Voice Satellite flow" is another view (a curated subset + its own extra detail).
- Groups differ per view (Plex may be in "Media" in one diagram, "Playback path" in another).

This is a model/view split. It also **subsumes the deferred flows/layers feature** — a
flow is just another diagram — and gives one place for **live status** to update every view.

## Concepts & Data Model

Three levels with clear ownership:

- **Entity (catalog, shared across all diagrams)**
  ```
  Entity { id, label, icon?, sub?, status?, kind?, meta? }
  ```
  Editing any of these changes the entity everywhere it appears. This is where a future
  live-status feed writes `status`.

- **Placement (per-diagram)** — where/how an entity sits in one diagram
  ```
  Placement { entityId, position {x,y}, parentId?: groupId | null }
  ```

- **Diagram (a view)**
  ```
  Diagram {
    id, name, title, type,          // type: 'canvas' now; 'topology' | 'call-flow' later
    placements: Placement[],
    groups: Group[],                // Group { id, label, color, position, size {w,h} }
    edges: Edge[],                  // Edge { id, from(entityId), to(entityId), type, label?, inferred?, shape, points? }
    notes: Note[],                  // Note { id, position, size, text }
  }
  ```

- **Model (the whole file)**
  ```
  Model { version, entities: Entity[], diagrams: Diagram[] }
  ```

**Decisions locked (from brainstorming):**
- Curated flows (entities are tagged into a diagram by placing them), not auto-highlight.
- **Edges are per-diagram** — each diagram draws its own edges between its placed entities.
- **Groups are per-diagram.**
- Focus/flow behavior (dim non-members) is deferred; a flow is realized as its own diagram.

**Diagram `type`:** stored from day one so the model is future-proof. Only `type: 'canvas'`
(the current free-form node/group/edge canvas — used for both the logical diagram and
flows) is *rendered* in this phase. `topology` (network-oriented) and `call-flow`
(sequence-oriented) are future types that reuse the same entity catalog and get their own
rendering/layout in later specs. Unknown types fall back to the canvas renderer.

**Identity constraint:** an entity appears **at most once per diagram**. The React Flow
node id within a diagram is the `entityId`. (Supporting the same entity twice in one
diagram would require separate placement ids; explicitly out of scope.)

## Rendering: building the canvas from the model

A pure function assembles the active diagram into React Flow nodes/edges:

```
buildDiagramGraph(diagram, entitiesById) -> { nodes, edges }
```
- Group nodes from `diagram.groups`.
- Service/actor nodes from `diagram.placements`, merging **entity** fields (label, icon,
  sub, status, kind) for `data` with **placement** `position` + `parentId`. RF node id = entityId.
- Edges from `diagram.edges` (carrying `shape`/`points`, styled via existing `restyleEdge`).

Edits map back to the right level:
- Move node → `placement.position`. Change group → `placement.parentId`.
- Edit label/icon/sub/status → **entity** (all diagrams).
- Add/edit/delete edge, group, note → **active diagram**.

## Persistence

- Replace `/api/graph` + `graph.json` with `/api/model` + `model.json` (same Vite
  middleware pattern; whole-model debounced autosave).
- **Active diagram** is a per-browser view preference → `localStorage` (so two tabs/people
  can view different diagrams without autosave churn), defaulting to the first diagram; if
  the stored id no longer exists (diagram deleted), fall back to the first diagram.
- Export/Import operates on the whole `model.json`.

## Migration (one-time, automatic)

On load, if `model.json` is absent but `graph.json` exists, migrate:
- Each service/actor node → an **Entity** (`id`, `label`, `icon`, `sub`, `status`, `kind`).
- Its `position` + `parentId` → a **Placement** in a diagram named **"Logical"** (`type: 'canvas'`).
- Group nodes → `diagram.groups`. Edges → `diagram.edges` (already reference node ids =
  entity ids). Notes → `diagram.notes`.
- Result: `model.json = { version, entities, diagrams: [Logical] }`.
- Keep `graph.json` untouched as a backup.

## UI

- **Diagram switcher** (toolbar): pick the active diagram; **New** (name + type), **Rename**,
  **Delete diagram**. A new diagram starts **empty** (no placements) — you build it up from
  the palette. Deleting a diagram never touches the entity catalog.
- **Entity palette** (collapsible side panel): searchable list of catalog entities
  (icon + label + status dot); click to place into the active diagram at viewport center;
  entities already in this diagram are marked. **＋ New entity** creates a catalog entity
  and places it.
- **Inspector** (updated): for a selected node, show **Entity** fields (labeled *shared
  across diagrams*) and **Placement** (group dropdown), with **two delete scopes**:
  - *Remove from this diagram* → deletes the placement (+ its edges in this diagram) only.
  - *Delete entity* → removes from the catalog and every diagram (confirm dialog).
  Group / edge / note inspectors are per-diagram, unchanged.
- Everything else — waypoints (+ snapping), curved/angular/straight, group resize + Space/
  Shrink to fit, Tidy, zoom shortcuts, opaque labels — carries over, scoped to the active diagram.

## Component / file structure

- `src/model.ts` — types (Entity, Diagram, Placement, Group, Edge, Note, Model), model
  load/save, `migrateFromGraph()`, and `buildDiagramGraph(diagram, entitiesById)`.
- `src/graph.ts` — keep `REL`, `restyleEdge`, `LAYOUT`, `relayout`, `distributeGroupChildren`,
  `shrinkGroupToChildren`, `makeEdge`; adapt to operate on the active diagram's arrays.
- `src/App.tsx` — model + activeDiagramId state; renders active diagram via
  `buildDiagramGraph`; maps edits back to entity/placement/diagram; hosts palette + switcher.
- `src/Palette.tsx` — entity palette. `src/DiagramBar.tsx` — diagram switcher.
- `src/Inspector.tsx` — entity/placement split + two delete scopes.
- `src/nodes.tsx`, `src/WaypointEdge.tsx` — largely unchanged (data is assembled upstream).
- `vite.config.ts` — `/api/model` endpoint (rename of `/api/graph`).

## Scope & phasing

- **Phase 1 (this spec):** model split; migration; `model.json` persistence; diagram
  switcher (create/rename/delete); entity palette (place existing / create new); scoped
  editing with shared-vs-local clarity + two delete scopes. `type` stored; only `canvas` rendered.
- **Phase 2+ (future, separate specs):** additional diagram types (`topology` auto-layout
  from network data; `call-flow` sequence view); live status feed from `homelab-health`;
  any cross-diagram niceties (e.g., "copy placement to another diagram").

## Verification

Consistent with the project's approach: `npm run typecheck` clean per step, plus Playwright-
driven checks (migration produces the expected entities + Logical diagram; placing an entity
adds a placement; editing a shared field changes it in a second diagram; remove-from-diagram
vs delete-entity scopes behave correctly; switching diagrams renders the right subset).

## Non-goals (this phase)

- Same entity placed twice in one diagram.
- Topology / call-flow specific rendering.
- Global relationship catalog (edges stay per-diagram).
- Live status wiring (model supports it; feed is later).
