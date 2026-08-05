// Typed `data` payloads for everything on the canvas — the three node kinds and
// the edge.
//
// React Flow defaults `data` to Record<string, unknown>, so every read of
// `node.data.something` is unchecked. The codebase worked around that with
// `as any` at ~48 call sites, which means a field rename compiles cleanly and
// fails at runtime — exactly how the "In this diagram" quick-pick silently
// stopped listing nodes when `color` became `scheme`.
//
// These must be `type` aliases, not `interface`s: React Flow constrains its
// data parameter to Record<string, unknown>, and an interface has no implicit
// index signature, so an interface will not satisfy it.
import type { Edge, Node } from '@xyflow/react'
import type { EdgeDir, RelType } from './graph'
import type { Status } from '../shared/model'

// Both required, mirroring Group in model.ts. Typing them optional made the
// write-back in nodesToDiagramParts fail to compile, which is correct: a group
// round-tripping through the canvas must not come back without them.
export type GroupNodeData = {
  label: string
  color: string // a plain hex; groups are not part of the scheme system
}

export type ServiceNodeData = {
  label: string
  sub?: string
  icon?: string
  status?: Status
  scheme?: string // scheme name or custom hex
  kind?: 'actor'
  shownFields?: { key: string; value: string }[]
  note?: string
  // Set only while a flow is playing: the 1-based step number drawn on the
  // active node. Transient view state, never persisted to the model.
  flowBadge?: number
}

export type NoteNodeData = {
  text: string
  scheme?: string // scheme name or custom hex
}

// Mirrors the persisted Edge in model.ts.
//
// Every field is optional, deliberately. React Flow types `Edge<T>.data` as
// `T | undefined`, and the codebase builds edge data by spreading
// (`{ ...e.data, shape }`), so requiring a field would make each of those
// spreads fail to compile without making any read safer — every consumer
// already defaults (`?? 'talks-to'`, `?? 'default'`, `?? 'forward'`). What the
// type buys here is that field NAMES are checked, which is the bug this exists
// to catch.
//
// An absent `color` is meaningful rather than missing: it means "use the
// relationship type's colour", which is why edges stayed out of the scheme
// change.
export type EdgeData = {
  rel?: RelType
  inferred?: boolean
  shape?: 'default' | 'smoothstep' | 'straight'
  dir?: EdgeDir
  color?: string
  points?: { x: number; y: number }[]
  labelPos?: number // fraction along the path in [0,1]; absent = 0.5 (midpoint)
  // Transient view state while a flow plays; never persisted to the model.
  // Holds the CSS CLASS NAME from flowClassOf ('flow-active' / 'flow-lit'),
  // not a FlowElemState — the edge label renders in a portal outside the edge
  // <g>, so className alone cannot reach it and the value is stashed here.
  flowState?: string
}

export type GroupNode = Node<GroupNodeData, 'group'>
export type ServiceNode = Node<ServiceNodeData, 'service'>
export type NoteNode = Node<NoteNodeData, 'note'>
export type AppEdge = Edge<EdgeData>

// The discriminated union of everything that can be on the canvas. Narrowing on
// `node.type` gives the right `data` shape without a cast.
export type AppNode = GroupNode | ServiceNode | NoteNode

export const isGroupNode = (n: { type?: string }): n is GroupNode => n.type === 'group'
export const isServiceNode = (n: { type?: string }): n is ServiceNode => n.type === 'service'
export const isNoteNode = (n: { type?: string }): n is NoteNode => n.type === 'note'
