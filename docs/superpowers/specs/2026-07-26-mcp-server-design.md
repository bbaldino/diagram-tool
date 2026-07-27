# Phase 2 — MCP Server (agent tools over the op API) — Design

**Status:** proposed
**Date:** 2026-07-26
**Builds on:** Phase 1 (branch `feat/agent-access-phase1`) — the dev server owns the model, applies `Op`s, persists, and broadcasts over SSE.
**Parent design:** `docs/superpowers/specs/2026-07-26-agent-diagram-access-design.md`

## Goal

Expose the Phase-1 operation API to agents as an **MCP**, so any agent (Claude Code, Desktop, etc.) can create and iterate on diagrams — logical flows, interaction maps — through well-typed tools, with changes appearing live in an open app. Agents describe *structure*; the server handles *layout*.

## Architecture — MCP hosted inside the dev server

The MCP is served **by the existing Vite dev server** over MCP's Streamable-HTTP transport, mounted as middleware at `/mcp`. No separate process; still one `npm run dev`. Agents connect by adding one MCP entry (URL `http://localhost:5173/mcp`, or the LAN host) to their client config.

Tool handlers are **thin**: validate input → build `Op[]` → apply through the **same in-memory store** the app uses (`server/store.ts`, in-process — no self-HTTP hop) → the store persists and broadcasts over SSE, so every agent action shows up live in the open app. Reads call `store.getState()`. The MCP contains **no model logic of its own** beyond assembling ops and running layout.

```
Agent (MCP client) ──HTTP /mcp──▶ dev server MCP handlers
                                    │  build Op[] + (layout)
                                    ▼
                                 store.apply(ops, writerId='mcp')
                                    │  persist model.json + SSE broadcast
                                    ▼
                                 open app tab updates live
```

Writes are tagged with a writer id (`"mcp"` or a per-connection id) so the app applies them (they aren't its own echo). Concurrency stays **last-writer-wins** (Phase 1 policy); no reconciliation is added.

## Server-side layout (`webapp/server/layout.ts`)

A new Node module using **dagre** (`@dagrejs/dagre`, pure JS). Input: a diagram's placements/groups/edges (model data). Output: the same placements/groups with computed positions (and group box sizes).

- **Flow-directed**: build a dagre graph (`rankdir: 'LR'` — upstream on the left, downstream on the right), one dagre node per placement using fixed node dimensions (service node ≈ 180×64), one dagre edge per model edge; run layout; read back `x/y` (converting dagre's center coords to React-Flow top-left).
- **Groups as clusters**: model groups map to dagre compound clusters (`setParent`) so members lay out together; after layout, size each group box to wrap its members plus padding and position it. Ungrouped nodes rank normally.
- **Invocation**: run automatically inside `author_diagram` when a node has no explicit position; exposed as a `layout(diagramId)` tool to re-run on demand. **Agent-supplied positions always win** — layout only fills in the ones left unset.
- Pure and Node-safe (imports only model types); unit-testable headlessly.

(Phase 1's client-side grid `relayout`/**Tidy** stays as-is; wiring Tidy to this engine is optional future polish, not part of this phase.)

## Tools (layered)

**Reads** (orientation before acting):
- `list_entities` → `[{id, label, icon?, status?}]`
- `list_diagrams` → `[{id, name, type}]`
- `get_diagram(id)` → the diagram's placements/groups/edges/notes (resolved with entity labels)

**Granular editing** (the backbone — create + iterate):
- `place_entity(diagramId, entityId|{new}, position?)`
- `connect(diagramId, from, to, {label?, dir?, color?})`
- `set_edge(diagramId, edgeId, {label?, dir?, color?})`
- `set_note(diagramId, entityId, note)`
- `remove(diagramId, {entity?|edge?|group?|note? id})`
- `layout(diagramId)` — re-run flow-directed layout

**One-shot** (thin sugar over the above, for the common create-from-scratch case):
- `author_diagram({ name, type?, nodes, edges?, groups?, notes? })`
  - `nodes`: array of existing entity ids or `{ new: "Label", icon? }` (new-by-name creates the entity — free creation, per parent design)
  - `edges`: `[from, to, { label?, dir?, color? }?]`
  - `groups`: `[{ label, members: [entityId…] }]`
  - `notes`: `{ entityId: "note text" }`
  - Assembles all ops, runs layout, applies as **one atomic `store.apply` batch** (one rev, one broadcast). Returns `{ diagramId, summary }`.

Each tool maps to the Phase-1 `Op` set; `author_diagram` is the only one that batches + lays out.

## Data flow & error handling

- Every tool validates before applying: referenced entity ids must exist (unless `{new}`), diagram ids must exist for edit tools; malformed input → a structured MCP tool error with a clear message; the model is left unchanged on error.
- `author_diagram` validates the **whole** spec first (all referenced ids resolvable, new entities well-formed), computes layout, then applies atomically — so it never leaves a half-built diagram.
- Unknown op / bad shape is caught at the op layer (Phase 1 `applyOp` throws on unknown; the store/tool surfaces it as an error, never a crash).

## Testing

- **Layout module** (vitest, headless): sensible ranks for a known flow (source left of target), no overlapping node boxes, group boxes wrap their members, agent-supplied positions preserved.
- **`author_diagram` assembly**: a spec with existing + `{new}` nodes, edges, a group, and notes produces a valid, laid-out diagram; is atomic (one rev); creates exactly the intended entities.
- **Tool → op mapping**: each granular tool emits the expected `Op`(s); validation errors on bad ids.
- **MCP smoke**: connect an MCP client to `/mcp`, `list_tools`, call `author_diagram`, confirm the diagram appears via `get_diagram` and in `model.json`.
- Reuses the Phase-1 op/store tests; keeps `tsc --noEmit` clean and the suite green.

## Dependencies

- `@dagrejs/dagre` (layout) and `@modelcontextprotocol/sdk` (MCP server + Streamable-HTTP transport) — installed via npm at latest. Both run in the Node dev server; neither is imported by client code, so the server-safety boundary (`model.ts`/`ops.ts`/`diff.ts` free of `@xyflow`) is unaffected.

## Out of scope (this phase)

- Multi-agent / real-time reconciliation (last-writer-wins stands; the `writerId` seam is the foundation if it's ever wanted).
- Diagram-type-specific rendering (topology vs call-flow) — the `type` is stored/settable only.
- Auth, remote/hosted MCP, wiring the app's Tidy button to the server layout engine.
