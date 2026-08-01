# Homelab Canvas

An interactive [React Flow](https://reactflow.dev) canvas for the homelab — a live,
editable version of `../homelab.d2`. Nodes are services (with icons + up/down status),
edges are **typed relationships** (`talks to`, `via`, `writes to`, `reads from`,
`proxies`, `monitors`), and you can drag things around, group them, and drop notes.

## Run

```bash
npm install      # first time
npm run dev      # http://localhost:5173  (also on the LAN: http://192.168.1.21:5173)
```

Other scripts: `npm run build`, `npm run typecheck`, `npm run preview`.

## Using the canvas

- **Drag** nodes to reposition; drag a **group** box to move its members with it.
- **Connect** two nodes by dragging from a node's right edge to another — creates a
  `talks to` edge (change its type in the Inspector).
- **Edge routing** — the **Edges** dropdown switches all edges between Curved /
  Angular / Straight. To hand-route one: **select it**, then **click the line** to drop
  a waypoint, **drag** the dot to route it, **double-click a dot** to remove.
  Dragging a dot **snaps subtly to line up** (vertical/horizontal) with its neighbor
  points/endpoints when it gets within a few pixels, so segments straighten on their own.
  Waypoints are absolute canvas points, so they stay put when you move a node.
- **Tidy** re-flows everything into roomy grids (spacing lives in `LAYOUT` in `graph.ts`).
- **Zoom shortcuts** — `+` / `-` zoom toward the cursor, `0` fits the whole diagram.
  They're modifier-free (no Ctrl/Cmd) so they don't trigger the browser's page zoom.
- **+ Note** drops a sticky note; select it to resize; type to edit.
- **Export JSON / Import** to save or load a layout file by hand; **Reset** rebuilds
  from the seed in `graph.ts`.
- Select an edge or node and press **Delete/Backspace** to remove it.

## Persistence — `graph.json` is the source of truth

Edits **autosave back to `webapp/graph.json`** via a small dev-server endpoint
(`GET`/`PUT /api/graph`, defined in `vite.config.ts`). On load the app reads that
file; on first run it seeds it from `graph.ts`. Because the file lives on the server,
every browser hitting the dev server sees the same graph (unlike per-browser
localStorage). The toolbar shows a `✓ saved to graph.json` indicator.

- `graph.ts` = the initial **seed** (used only when there's no `graph.json`, or on Reset).
- `graph.json` = your **live, saved** graph. Commit it to git if you want history.
- If you serve a static production build (no dev server), there's no write endpoint,
  so saving falls back to a `⚠ not saved` state — use Export JSON there.

## How it's structured

- `src/graph.ts` — the whole model: groups, service nodes (icon slug + port + status),
  the typed-edge list, the relationship color map (`REL`), and `buildSeed()` which
  shelf-packs the initial layout. **This is the file to edit** to change the diagram.
- `src/nodes.tsx` — the three custom node types: `ServiceNode`, `NoteNode`, `GroupNode`.
- `src/App.tsx` — the canvas: toolbar, legend, minimap, autosave/import/export.

The data model is deliberately tiny:

```ts
node: { id, label, icon?, sub?, status? }          // status: 'up' | 'down' | 'idle'
edge: { from, to, type, label?, inferred? }        // type is a RelType
```

The relationship _vocabulary_ (`RelType`) is just an enum you own — add your own
(`depends on`, `backs up to`, …) in `graph.ts` and give it a color in `REL`.

## Wiring in live status (next step)

`status` is currently seeded from a one-time Unraid snapshot. To make it live, fetch
container state from your `homelab-health` service (or the Unraid API) and map each
service `id` → `up`/`down`, then patch node `data.status`. The node component already
renders the colored dot, so it's just a data feed.

## Editing

Select any node, group, or edge to edit it in the **Inspector** (top-right):

- **Service** — label, sub/port, icon slug, status, and which group it belongs to.
- **Group** — label, color, **Width/Height** fields (type to resize the group — the
  easy alternative to grabbing its corners; applies on blur/Enter), and two layout actions:
  - **Space to fit** — keeps the group's current size; spreads its members evenly to
    fill it (resize the group, then Space to fit).
  - **Shrink to fit** — packs members at standard spacing and resizes the _group_ to
    wrap them tightly.
- **Edge** — relationship type, label, and the inferred (dashed) toggle.

Add things with **+ Service**, **+ Group**, **+ Note** — if a group is selected it
becomes the new node's parent. Delete via the Inspector button or Delete/Backspace.

## Known limitations (it's a prototype)

- You can move a node between groups via the Inspector's **Group** dropdown, but not
  yet by _dragging_ it across on the canvas (`extent: 'parent'` keeps it contained).
- No undo/redo yet (state lives in `App.tsx`; Reset reverts to the seed).
