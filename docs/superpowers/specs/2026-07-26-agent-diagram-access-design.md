# Agent/Programmatic Diagram Access — Design

**Status:** proposed
**Date:** 2026-07-26

## Goal

Let agents (and any programmatic client) **create, edit, and iterate on
diagrams** in the homelab-diagram app — build logical flows, interaction maps,
etc. — through a clean operation API, exposed to agents as an **MCP**. Changes
appear **live** in an open app, and nothing clobbers anything.

## Background: how state works today, and why it must change

The whole model is a single `webapp/model.json` file. The React app loads it
into memory, mutates it locally, and autosaves the **entire file** back through
a dumb Vite dev-server endpoint (`/api/model` GET/PUT in `vite.config.ts`). The
**browser tab is the de-facto source of truth**; the file is just where it
saves.

This is a single-writer design used by multiple writers, which is the root of
the clobber bugs seen repeatedly in development (two tabs overwriting each
other; an external edit to `model.json` lost on the next autosave). Adding
agents as another writer on top of this would make it worse. The fix is to put
the source of truth where there is exactly one writer.

## Architecture: relocate the model into the dev server (one app, one process)

The app already ships a server — the Vite dev server that runs on `npm run
dev` and hosts `/api/model`. We make **that existing endpoint the owner of the
model**. No separate app, no separate process, no new thing to launch.

```
                    ┌─────────────────────────────────────────┐
   Browser app ───▶ │  Vite dev server (npm run dev)           │
     (client)  ◀─── │   • owns Model in memory                 │
        ▲   SSE     │   • applies operations (serialized)      │
        │           │   • persists model.json (single writer)  │
   MCP client ────▶ │   • broadcasts changes over SSE          │
   (agents)   ◀──── │   • hosts the MCP endpoint (HTTP)         │
                    └─────────────────────────────────────────┘
```

- The **dev-server middleware** holds the model in memory, applies every change
  as a discrete **operation**, persists `model.json`, and pushes a "model
  changed" stream (SSE) to all connected clients. It is the **only writer**.
- The **React app becomes a client**: it subscribes to the SSE stream and sends
  edits as operations, instead of owning the model and autosaving the whole
  file. From the user's seat nothing changes — same UI, same `npm run dev`.
- The **MCP is hosted by the same dev server** over MCP's HTTP transport, so
  agents point at `localhost:5173` and there is still one process running.

Because there is a single owner that serializes writes, the entire clobber
class of bug disappears, and agents get a clean, consistent create/edit/iterate
surface — the same one the UI uses.

## The operation model

Every mutation — from the UI or from an agent — is an **operation** the server
applies to its in-memory model, then persists and broadcasts. Operations reuse
the existing pure functions in `webapp/src/model.ts` (which are Node-safe; only
the `fetch`-based `loadModel`/`saveModel` are client-only and move to the
client's transport layer).

Operation categories (each maps to an existing/parallel `model.ts` function):

- **Entities:** create, update, delete; applyTemplate; setFields; template CRUD.
- **Diagram lifecycle:** createDiagram(name, type), rename, delete.
- **Placements:** add (place an entity), remove, move (position/parent),
  setFieldShow, setNote (the per-placement inline note).
- **Groups / notes / edges** within a diagram: add / update / remove. Edge
  updates carry label, direction (forward|backward|both), color, and the side
  handles.
- **layout(diagramId):** auto-position (see Layout).

**Serialization & reconciliation.** The Node event loop applies operations one
at a time. The model carries a monotonically increasing `rev`; each applied
operation bumps it and the SSE broadcast includes the new `rev`. Clients render
the authoritative state they receive. The app may apply edits **optimistically**
for responsiveness and reconcile when the authoritative broadcast arrives.

## Layout (server-side, automatic)

Agents never supply coordinates. When a diagram is authored or explicitly
re-laid-out, the **server computes positions** and stores them in the model, so
every client just renders. Layout reuses the existing pure `relayout` from
`webapp/src/graph.ts` (a Node-safe grid of groups and their members). Because
`relayout` is a plain grid and not flow-aware, an **edge-directed layout**
(left-to-right by connections, better for flow diagrams) is a recommended
fast-follow — the layout function is pluggable behind the `layout` operation.

## The app as a client

The app's state flow changes from "own + autosave whole file" to "subscribe +
send operations":

- **On load:** fetch the current model (or receive the initial SSE snapshot).
- **On remote change:** an SSE event carries the new model/`rev`; the canvas
  re-seeds from it (the existing re-seed path, now driven by the server rather
  than local `setModel`).
- **On user edit:** send the corresponding operation to the server. High-
  frequency interactions (node drag, waypoint drag) apply locally and send a
  single **move** operation on settle — the same debounce boundary the current
  write-back already uses, so this is a redirection of existing logic, not new
  chattiness.

This is the largest single piece of work: moving "who holds the model" out of
the React tree and into the server client boundary. It is an internal refactor
of the existing app, not a rewrite.

## MCP surface (layered)

Hosted by the dev server; agents connect over HTTP. Tools are layered so the
common "make me a diagram" path is one atomic call, with primitives for
iteration:

- **Reads:** `list_entities`, `list_diagrams`, `get_diagram(id)` — so an agent
  can orient before acting.
- **Workhorse:** `author_diagram(spec)` — builds a whole diagram in one atomic
  call: creates any missing entities, adds placements, groups, edges, and
  notes, then auto-lays-out. Shape:

  ```
  author_diagram({
    name: "Media request flow",
    type: "call-flow",
    nodes: ["users", "npm", "plex", { new: "Grafana", icon: "grafana" }],
    edges: [["users","npm"], ["npm","plex",{ label:"proxy", dir:"both" }]],
    groups: [{ label: "Media", members: ["plex","radarr"] }],
    notes:  { plex: "primary 4K server" }
  })
  ```

- **Edit primitives (iterate):** `connect`, `place_entity`, `remove`,
  `set_note`, `set_edge` (label/dir/color), `layout`, plus entity/template ops.
  These make incremental editing first-class — agents refine an existing
  diagram, they don't only create from scratch.

**Entity creation is free:** a `{ new: "…" }` node (or a `create_entity` call)
just creates the entity in the shared catalog, indistinguishable from a
human-created one. (Accepted trade-off: possible catalog drift/dupes; can be
revisited with a review/merge affordance later.)

## Persistence

No database. The server owns the model in memory and persists to
`webapp/model.json` (the existing file, unchanged schema) with serialized,
single-writer writes. Because storage sits behind the operation layer, moving
to SQLite later — if history/versioning or querying is ever wanted — is a
localized change. `graph.json` remains untouched as the legacy migration source.

## Error handling & edge cases

- **App offline when an agent writes:** fine — the server is the authority; the
  change is applied and persisted, and shows up when a tab connects.
- **Stale/invalid operation** (e.g. reference to a deleted entity): the server
  validates and returns a structured error; the model is unchanged.
- **Concurrent clients:** serialized application + `rev`-stamped broadcasts keep
  everyone converged on the server's authoritative state.
- **Unknown MCP inputs:** validated at the tool boundary with clear messages
  (bad diagram id, malformed spec, etc.).

## Testing

- **Server operation layer:** vitest unit tests over the pure apply-operation
  functions (create/edit/delete across entities, diagrams, placements, edges,
  layout), including validation/error paths. Extends the existing model tests.
- **App-as-client:** the existing Playwright canvas checks, retargeted to the
  SSE/operation flow (edit → op → broadcast → re-seed round-trip).
- **MCP tools:** tests that each tool maps to the right operation(s) and that
  `author_diagram` produces a laid-out, valid diagram atomically.

## Phasing

The two pieces are sequential; the first is independently valuable (it fixes
clobber even before any agent exists).

1. **State service + app-as-client** — dev-server middleware owns the model,
   operation API, SSE broadcast, server-side layout; migrate the React app to a
   client of it.
2. **MCP server** — hosted by the dev server; reads + `author_diagram` + edit
   primitives over the operation API.

## Out of scope (for now)

- A real database, history/versioning, multi-user auth.
- Edge-directed (dagre/ELK) flow layout — recommended fast-follow, but the grid
  `relayout` ships first behind the pluggable `layout` operation.
- Rendering that branches on diagram `type` (topology vs call-flow) — the type
  is stored and settable; visual differentiation is separate work.
