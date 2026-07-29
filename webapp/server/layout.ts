import type { Diagram, Node, Group, Edge, EdgeOrientation } from '../src/model'
import { runElk } from './layout-elk'
import { runGraphviz } from './layout-graphviz'

type HandleId = 'top' | 'right' | 'bottom' | 'left'

export const W = 180

export type LayoutEngine = 'elk' | 'graphviz'
export const DEFAULT_ENGINE: LayoutEngine = 'elk'

export interface EngineNode { id: string; x: number; y: number; parentId?: string | null }
export interface EngineGroup { id: string; x: number; y: number; width: number; height: number }
export interface EngineResult { nodes: EngineNode[]; groups: EngineGroup[] }

export interface FlatBox { id: string; width: number; height: number }
export interface FlatEdge { from: string; to: string }
// Lay out a flat set of sized boxes; return each box's top-left position in
// engine coordinates (arbitrary origin — the orchestrator normalizes). No
// groups, no clusters, no hierarchy.
export type FlatEngine = (boxes: FlatBox[], edges: FlatEdge[]) => Promise<Record<string, { x: number; y: number }>>

// The engine adapters (layout-elk.ts / layout-graphviz.ts) are untouched by
// the node-model migration — they still speak the old placement-shaped
// diagram (`placements: { entityId, position, parentId }[]`). layoutDiagram
// adapts the new node-shaped Diagram to that shape at the boundary and back,
// so the engines don't need to change.
export interface EngineDiagram {
  id: string
  groups: Group[]
  edges: Edge[]
  placements: { entityId: string; position: { x: number; y: number }; parentId?: string | null }[]
}
export type EngineAdapter = (diagram: EngineDiagram, heightById: Record<string, number>) => Promise<EngineResult>

// Base node height (icon row + label/sub) — the box before any inline note.
const H = 64

function nodeHeight(_n: Node): number {
  return H
}

// Absolute center of a node's box: child coords are parent-relative, so add
// the parent group's absolute position back before adding half the node
// size. Pure function of its inputs — no closure over layout state — so it
// can be exercised directly with exact numeric assertions.
export function absoluteCenter(
  n: { position: { x: number; y: number }; parentId?: string },
  groupById: Record<string, Group>,
  height: number,
): { x: number; y: number } {
  let x = n.position.x
  let y = n.position.y
  let parentId = n.parentId
  const seen = new Set<string>()
  while (parentId && groupById[parentId] && !seen.has(parentId)) {
    seen.add(parentId)
    const g = groupById[parentId]
    x += g.position.x
    y += g.position.y
    parentId = g.parentId
  }
  return { x: x + W / 2, y: y + height / 2 }
}

// Choose which side of each node an edge attaches to. `orientation` fixes the
// axis (horizontal → left/right, vertical → top/bottom); `auto` picks the
// dominant axis from the centers (tie → horizontal). The specific side is
// always derived from geometry, so it tracks the nodes on every layout.
export function handlesFor(
  orientation: EdgeOrientation | undefined,
  s: { x: number; y: number },
  t: { x: number; y: number },
): { sourceHandle: HandleId; targetHandle: HandleId } {
  const dx = t.x - s.x
  const dy = t.y - s.y
  const axis =
    orientation === 'horizontal'
      ? 'h'
      : orientation === 'vertical'
        ? 'v'
        : Math.abs(dx) >= Math.abs(dy)
          ? 'h'
          : 'v'
  if (axis === 'h') {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left', targetHandle: 'right' }
  }
  return dy >= 0
    ? { sourceHandle: 'bottom', targetHandle: 'top' }
    : { sourceHandle: 'top', targetHandle: 'bottom' }
}

// Bake each edge's connection-point handles from the final laid-out geometry.
// `orientation` fixes the axis; the side follows the node centers. Missing
// endpoints leave the edge unchanged. Shared by every layout engine.
export function assignEdgeHandles(
  nodes: Node[],
  groups: Group[],
  edges: Edge[],
  heightById: Record<string, number>,
): Edge[] {
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))
  const nodeById: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const centerOf = (id: string): { x: number; y: number } | null => {
    const n = nodeById[id]
    if (!n) return null
    return absoluteCenter(n, groupById, heightById[id] ?? H)
  }
  return edges.map((e) => {
    const s = centerOf(e.from)
    const t = centerOf(e.to)
    if (!s || !t) return e
    return { ...e, ...handlesFor(e.orientation, s, t) }
  })
}

// Multi-engine layout dispatcher: delegates to the chosen engine adapter for
// raw absolute placement, then converts child node coords to parent-relative
// (React Flow child coords are relative to their parent group) and bakes edge
// handles from the final geometry. Pure — does not mutate `diagram`.
export async function layoutDiagram(
  diagram: Diagram,
  engine: LayoutEngine = DEFAULT_ENGINE,
): Promise<{ nodes: Node[]; groups: Group[]; edges: Edge[] }> {
  const heightById: Record<string, number> = {}
  for (const n of diagram.nodes) heightById[n.id] = nodeHeight(n)

  const engineDiagram: EngineDiagram = {
    id: diagram.id,
    groups: diagram.groups,
    edges: diagram.edges,
    placements: diagram.nodes.map((n) => ({ entityId: n.id, position: n.position, parentId: n.parentId ?? null })),
  }

  const result = await (engine === 'graphviz' ? runGraphviz : runElk)(engineDiagram, heightById)

  const groupAbsById: Record<string, EngineGroup> = Object.fromEntries(result.groups.map((g) => [g.id, g]))
  const nodeAbsById: Record<string, EngineNode> = Object.fromEntries(result.nodes.map((n) => [n.id, n]))

  const groups: Group[] = diagram.groups.map((g) => {
    const eg = groupAbsById[g.id]
    if (!eg) return g
    return { ...g, position: { x: Math.round(eg.x), y: Math.round(eg.y) }, size: { width: Math.round(eg.width), height: Math.round(eg.height) } }
  })
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))

  const nodes: Node[] = diagram.nodes.map((n) => {
    const en = nodeAbsById[n.id]
    if (!en) return n
    let x = en.x
    let y = en.y
    if (n.parentId && groupById[n.parentId]) {
      x -= groupById[n.parentId].position.x
      y -= groupById[n.parentId].position.y
    }
    return { ...n, position: { x: Math.round(x), y: Math.round(y) } }
  })

  const edges = assignEdgeHandles(nodes, groups, diagram.edges, heightById)
  return { nodes, groups, edges }
}
