# Ad-hoc-first Entities — Design

**Status:** Approved (design), pending implementation plan.
**Date:** 2026-07-28
**Branch:** `feat/adhoc-entities` (off `main`; independent of the unmerged `feat/diagram-flows`).

## Problem

Entities are fully global today. Both the canvas **Palette** (bottom-left panel) and the
**Entities page** list every entity across every diagram, and creating an entity always
adds it to that shared pool (`createEntity` = `addPlacement(addEntity(...))`). The model
even tracks "used in N diagrams", so cross-diagram reuse is a designed-in feature.

That shared store becomes cluttered the moment you author a diagram for an unrelated
domain (e.g. a codebase map alongside the homelab diagrams): its entities now show up as
drop candidates in every other diagram's palette, and vice versa. There is also no
lightweight way to drop a genuinely one-off box (a "client" calling in) without minting a
permanent catalog entry.

## Decision

Make entity creation **ad-hoc-first** and **shelve the library UI**, reversibly.

Two concepts were untangled during design and only one is being shelved:

- **Templates** = the *type/class* layer (a field schema + default icon; `entity.template`
  keeps a live link driving field-visibility defaults). Useful either way. **Keep, unchanged.**
- **Shared identity / library** = one logical entity placed in N diagrams, browsable in a
  catalog. Its only load-bearing justification is *live status reflected everywhere* (wire
  once, lit on every diagram the entity appears in) — a someday feature, not a near-term
  one. Until that lands, shared identity is speculative infrastructure that produces the
  clutter. **Shelve the UI; keep the substrate.**

We deliberately chose to **keep the global store and hide the browser** (rather than
migrate entity storage onto each diagram). Rationale: the library may return, and hiding
is far less churn than migrating — entity lookup, `buildGraph`, MCP, ops/diff, and
persistence all stay untouched. Bringing the library back becomes "re-show the view", not
"un-migrate the data".

The one gap that hiding-only leaves — the hidden store slowly filling with dead entities —
is closed by an **orphan sweep** (below), not by a storage migration.

## Design

### 1. Model & lifecycle

- `model.entities[]` stays global. **No structural model change**; every existing lookup
  is untouched.
- **No `adhoc`/`library` flag yet.** With the library hidden, every entity is ad-hoc by
  definition, so a flag would be dead weight. Re-introducing the flag is the first step of
  the library's return (see Reversibility).
- **Orphan sweep (the one new rule):** when a diagram is deleted, remove any entity that is
  left with **zero placements across all diagrams**. While the library is hidden nothing is
  allowed to sit un-placed, so an unplaced entity is always garbage. This keeps the hidden
  store from silently accumulating dead entities.
  - A shared entity still placed in another diagram is **not** swept (it still has a
    placement elsewhere).
  - `removeDiagram` in `webapp/src/model.ts` gains this sweep. `deleteEntity` already
    cascades placement removal and is unaffected.

### 2. Creation UX

Creation currently lives *inside* the catalog panel, so shelving the library must relocate
it rather than delete it.

- **`CanvasAddMenu` "Entity" flips from search-existing → create-new:** click the on-canvas
  ＋ → **Entity** → name it (optional icon / template) → the entity is created and placed at
  that spot. This becomes the primary, ad-hoc-native creation path.
- **Remove the bottom-left Palette panel** (`webapp/src/Palette.tsx` usage in `App.tsx`).
  Its entire job was browsing the shared catalog to place existing entities — exactly the
  library behaviour being shelved. Its `onCreate` path is superseded by the ＋ menu flow.
- Templates remain selectable in the create form.

### 3. What gets shelved — and how it returns

Shelved (removed from the UI, reachable again by re-wiring):

- The **Entities page** nav tab + route (`view === 'entities'` in `App.tsx`). Leave
  `webapp/src/EntitiesPage.tsx` in the tree, unreferenced, so return is a re-wire not a
  rewrite.
- The **cross-diagram "place existing" pickers**: the Palette panel (removed) and
  `CanvasAddMenu`'s Entity search mode (repurposed to create-new).

**Reversibility checklist** (what bringing the library back entails):

1. Add a `library?: boolean` flag to `Entity` (ad-hoc = false/absent, shelf item = true).
2. Re-add the Entities-page nav tab + route.
3. Re-add a "place existing" picker (Palette panel or a ＋-menu browse mode).
4. Add a **"Save to library"** action that flips an ad-hoc entity's flag to `true`.
5. Teach the orphan sweep to **spare** entities with `library === true` (a shelf item is
   allowed to exist un-placed).

### 4. Out of scope

- **MCP tools** (`list_entities`, `place_entity`, authoring) keep working unchanged. MCP is
  the power/automation interface, not "the UI", and it still operates on the same model.
  Agents can still create and place entities.
- **Templates:** no change.
- **Live status:** unaffected (a field on `Entity`); this design neither adds nor blocks it.

### 5. Testing

Unit (vitest, `webapp/src/model.test.ts` or a sibling):

- Orphan sweep: deleting a diagram removes an entity placed only in that diagram; an entity
  also placed in another diagram survives.
- Create-new: the ＋-menu create path yields an entity present in `model.entities` with a
  placement on the active diagram.

Browser (Playwright):

- ＋ → Entity → name → entity appears placed on the canvas.
- The Entities nav tab and the bottom-left Palette panel are gone.
- Existing diagrams still render (no regression from removed catalog surfaces).

## Non-goals / explicitly deferred

- Migrating entity storage to be diagram-local.
- The `library`/`adhoc` flag and any "Save to library" affordance (parked in the
  Reversibility checklist).
- A "Common"/shared domain of always-available generic actors.
