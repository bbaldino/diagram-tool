# ELK Layout Knobs in Diagram Settings — Design (Feature A)

**Date:** 2026-08-19
**Branch:** `edge-routing-experiments`

## Goal

Expose ELK's layout options as per-diagram, tunable knobs in the Diagram Settings
dialog (shown when the **Waypoint (ELK)** router is selected), so ELK's line/node
placement can be tuned and compared without editing server code. Purpose:
evaluate whether tuned ELK gives acceptable results before deciding on the deeper
"preserve ELK ports" work (Feature B, out of scope here).

## Background

`server/layout.ts`'s `layoutHierarchical` (the ELK path for `type: 'topology'`
diagrams — confirmed at `layout.ts:535-536`) hardcodes ELK options:

```
elk.direction: RIGHT · elk.edgeRouting: ORTHOGONAL
elk.layered.spacing.nodeNodeBetweenLayers: 70 · elk.spacing.nodeNode: 40
elk.spacing.edgeNode: 20 · elk.spacing.edgeEdge: 12
elk.edgeLabels.placement: CENTER · elk.spacing.edgeLabel: 6
```

The per-diagram routing config + settings dialog already exist (from the
per-diagram routing feature): `DiagramRouting` on `Diagram.routing`, persisted via
the `diagram.setRouting` op, edited in `DiagramSettingsDialog` with
`PathfindingControls` shown for the pathfinding router. This feature adds the ELK
equivalent.

## Key UX fact

ELK runs **server-side, on Tidy** — there is no live preview (unlike the
client-side pathfinding knobs). So the loop is: adjust knobs → **Apply & Tidy**
(one button: commit the config, then re-run layout) → compare.

## Global Constraints

- Prettier: `{ "singleQuote": true, "semi": false, "printWidth": 100 }`.
- Do not regress the suite (670 tests at design time). Branch `edge-routing-experiments`; nothing pushed.
- `DEFAULT_ELK` must equal today's hardcoded values, so a diagram with no ELK
  override lays out exactly as it does now.
- Only capitalize the first letter of multi-letter acronyms in identifiers.
- Waypoint routing on non-topology diagrams (which use `layoutContainer`, not
  `layoutHierarchical`) is unchanged — the ELK knobs only bind into the
  hierarchical/topology path for now.

## Data model

`shared/model.ts`:

```ts
export type ElkDirection = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'
export type ElkEdgeRouting = 'ORTHOGONAL' | 'POLYLINE' | 'SPLINE'
export type ElkNodePlacement = 'BRANDES_KOEPF' | 'NETWORK_SIMPLEX' | 'SIMPLE' | 'LINEAR_SEGMENTS'
export type ElkCrossingMin = 'LAYER_SWEEP' | 'INTERACTIVE'

export interface ElkConfig {
  direction: ElkDirection
  edgeRouting: ElkEdgeRouting
  nodePlacement: ElkNodePlacement
  crossingMin: ElkCrossingMin
  nodeNodeBetweenLayers: number
  nodeNode: number
  edgeEdge: number
  edgeNode: number
}

export const DEFAULT_ELK: ElkConfig = {
  direction: 'RIGHT',
  edgeRouting: 'ORTHOGONAL',
  nodePlacement: 'BRANDES_KOEPF', // ELK layered default
  crossingMin: 'LAYER_SWEEP', // ELK layered default
  nodeNodeBetweenLayers: 70,
  nodeNode: 40,
  edgeEdge: 12,
  edgeNode: 20,
}
```

- `DiagramRouting` gains `elk?: ElkConfig`; `DEFAULT_ROUTING.elk = DEFAULT_ELK`.
- Read everywhere as `routing.elk ?? DEFAULT_ELK` (diagrams whose stored routing
  predates the field still lay out with defaults).

## Server: config → ELK options

Extract a **pure, testable** helper in `server/layout.ts`:

```ts
export function elkLayoutOptions(elk: ElkConfig): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': elk.direction,
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': elk.edgeRouting,
    'elk.layered.nodePlacement.strategy': elk.nodePlacement,
    'elk.layered.crossingMinimization.strategy': elk.crossingMin,
    'elk.layered.spacing.nodeNodeBetweenLayers': String(elk.nodeNodeBetweenLayers),
    'elk.spacing.nodeNode': String(elk.nodeNode),
    'elk.spacing.edgeNode': String(elk.edgeNode),
    'elk.spacing.edgeEdge': String(elk.edgeEdge),
    'elk.edgeLabels.placement': 'CENTER',
    'elk.spacing.edgeLabel': '6',
  }
}
```

`layoutHierarchical` uses `elkLayoutOptions(diagram.routing?.elk ?? DEFAULT_ELK)`
for the root graph's `layoutOptions` (replacing the hardcoded block at
`layout.ts:262-275`). The nested-group `elk.padding` option at `layout.ts:253`
stays as-is. Because `layoutHierarchical` reads the stored `diagram`, no
`/api/layout` request plumbing changes — the config is already persisted when
Tidy runs.

## Client store

`src/routingKnobs.ts` (already holds the active `DiagramRouting`) gains:

```ts
export function patchElk(patch: Partial<ElkConfig>): void
// merges into state.elk, defaulting from DEFAULT_ELK when absent:
// setActiveRouting({ ...state, elk: { ...(state.elk ?? DEFAULT_ELK), ...patch } })
```

## UI

- New `src/ElkControls.tsx` (mirrors `PathfindingControls`): reads
  `useActiveRouting().elk ?? DEFAULT_ELK`, writes via `patchElk`. Four selects
  (direction, edgeRouting, nodePlacement, crossingMin) and four sliders
  (`nodeNodeBetweenLayers` 20–200, `nodeNode` 10–120, `edgeEdge` 2–40,
  `edgeNode` 2–40).
- `DiagramSettingsDialog`:
  - When `router === 'waypoint'`, render `<ElkControls />` (currently it renders
    nothing for waypoint).
  - Add an **Apply & Tidy** button (only meaningful for waypoint/ELK): commits the
    routing via `diagram.setRouting` (`await sendOps(...)` so the server has the
    config first), then calls a new `onTidy` prop, then closes. The existing
    Apply/Cancel remain.
  - New prop: `onTidy: () => void`.
- `App.tsx`: pass `onTidy={tidy}` to `DiagramSettingsDialog` (App's existing
  `tidy` callback POSTs `/api/layout` with measured sizes; for a topology diagram
  that runs `layoutHierarchical` with the just-committed ELK config).

## Sequencing (Apply & Tidy)

`await sendOps([{ t: 'diagram.setRouting', diagramId, routing }])` MUST resolve
(server has applied the op) **before** `onTidy()` fires, so the layout reads the
new ELK config rather than the previous one.

## Testing

- `shared/model`: `DEFAULT_ELK` matches the current hardcoded values (direction
  `RIGHT`, edgeRouting `ORTHOGONAL`, spacings 70/40/12/20); `DEFAULT_ROUTING.elk`
  deep-equals `DEFAULT_ELK`.
- `server/layout` `elkLayoutOptions`: maps each `ElkConfig` field to the right
  `elk.*` key with stringified numbers; a non-default config (e.g. edgeRouting
  `POLYLINE`, edgeEdge 30) shows through.
- `routingKnobs` `patchElk`: updates one ELK field, defaulting the rest from
  `DEFAULT_ELK`, without touching `router`/`pathfinding`.
- Manual (browser): with Waypoint selected, the dialog shows ELK controls; change
  edge-edge spacing / edge-routing → Apply & Tidy → the topology diagram re-lays
  out with the new options; a diagram with no override lays out identically to
  before.

## Out of scope / deferred

- **Feature B — preserving ELK's ports** (fanning converging edges to distinct
  points): the actual attribution fix, decided separately after seeing tuned ELK.
- ELK knobs for non-topology (`layoutContainer`) diagrams.
- Any live preview of ELK (it is inherently a server-side batch layout).
