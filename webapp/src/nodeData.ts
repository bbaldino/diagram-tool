// Typed `data` payloads for the three canvas node kinds.
//
// React Flow's Node defaults its data to Record<string, unknown>, so every read
// of `node.data.something` is unchecked. The codebase worked around that with
// `as any` at ~48 call sites, which means a field rename compiles cleanly and
// fails at runtime — exactly how the "In this diagram" quick-pick silently
// stopped listing nodes when `color` became `scheme`.
//
// These must be `type` aliases, not `interface`s: React Flow constrains its
// data parameter to Record<string, unknown>, and an interface has no implicit
// index signature, so an interface will not satisfy it.
import type { Node } from '@xyflow/react'
import type { Status } from './model'

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
}

export type NoteNodeData = {
  text: string
  scheme?: string // scheme name or custom hex
}

export type GroupNode = Node<GroupNodeData, 'group'>
export type ServiceNode = Node<ServiceNodeData, 'service'>
export type NoteNode = Node<NoteNodeData, 'note'>

// The discriminated union of everything that can be on the canvas. Narrowing on
// `node.type` gives the right `data` shape without a cast.
export type AppNode = GroupNode | ServiceNode | NoteNode

export const isGroupNode = (n: { type?: string }): n is GroupNode => n.type === 'group'
export const isServiceNode = (n: { type?: string }): n is ServiceNode => n.type === 'service'
export const isNoteNode = (n: { type?: string }): n is NoteNode => n.type === 'note'
