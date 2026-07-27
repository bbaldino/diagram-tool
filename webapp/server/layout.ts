import type { Diagram, Placement, Group, DEdge, EdgeOrientation } from '../src/model'
import { runElk } from './layout-elk'
import { runGraphviz } from './layout-graphviz'

type HandleId = 'top' | 'right' | 'bottom' | 'left'

export const W = 180

export type LayoutEngine = 'elk' | 'graphviz'
export const DEFAULT_ENGINE: LayoutEngine = 'elk'

export interface EngineNode { id: string; x: number; y: number; parentId?: string | null }
export interface EngineGroup { id: string; x: number; y: number; width: number; height: number }
export interface EngineResult { nodes: EngineNode[]; groups: EngineGroup[] }
export type EngineAdapter = (diagram: Diagram, heightById: Record<string, number>) => Promise<EngineResult>

// Base node height (icon row + label/sub) — the box before any inline note.
const H = 64

// Inline-note sizing (matches .node__note in index.css): the note wraps inside
// the 180px box (~160px content at 11px/line-height 1.35 ≈ 15px per line, plus
// ~11px of top border + vertical padding). Estimated so each engine reserves
// real vertical room for boxes that carry a note instead of assuming a flat
// 64px.
const NOTE_CHARS_PER_LINE = 25
const NOTE_LINE_H = 15
const NOTE_CHROME = 12

function noteHeight(note: string | undefined | null): number {
  const text = (note ?? '').trim()
  if (!text) return 0
  const lines = text
    .split('\n')
    .reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / NOTE_CHARS_PER_LINE)), 0)
  return NOTE_CHROME + lines * NOTE_LINE_H
}

function nodeHeight(p: Placement): number {
  return H + noteHeight(p.note)
}

// Absolute center of a placement's node: child coords are parent-relative, so
// add the parent group's absolute position back before adding half the node
// size. Pure function of its inputs — no closure over layout state — so it
// can be exercised directly with exact numeric assertions.
export function absoluteCenter(
  p: Placement,
  groupById: Record<string, Group>,
  height: number,
): { x: number; y: number } {
  let x = p.position.x
  let y = p.position.y
  if (p.parentId && groupById[p.parentId]) {
    x += groupById[p.parentId].position.x
    y += groupById[p.parentId].position.y
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
  placements: Placement[],
  groups: Group[],
  edges: DEdge[],
  heightById: Record<string, number>,
): DEdge[] {
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))
  const placementByEntity: Record<string, Placement> = Object.fromEntries(placements.map((p) => [p.entityId, p]))
  const centerOf = (entityId: string): { x: number; y: number } | null => {
    const p = placementByEntity[entityId]
    if (!p) return null
    return absoluteCenter(p, groupById, heightById[entityId] ?? H)
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
): Promise<{ placements: Placement[]; groups: Group[]; edges: DEdge[] }> {
  const heightById: Record<string, number> = {}
  for (const p of diagram.placements) heightById[p.entityId] = nodeHeight(p)

  const result = await (engine === 'graphviz' ? runGraphviz : runElk)(diagram, heightById)

  const groupAbsById: Record<string, EngineGroup> = Object.fromEntries(result.groups.map((g) => [g.id, g]))
  const nodeById: Record<string, EngineNode> = Object.fromEntries(result.nodes.map((n) => [n.id, n]))

  const groups: Group[] = diagram.groups.map((g) => {
    const eg = groupAbsById[g.id]
    if (!eg) return g
    return { ...g, position: { x: Math.round(eg.x), y: Math.round(eg.y) }, size: { width: Math.round(eg.width), height: Math.round(eg.height) } }
  })
  const groupById: Record<string, Group> = Object.fromEntries(groups.map((g) => [g.id, g]))

  const placements: Placement[] = diagram.placements.map((p) => {
    const n = nodeById[p.entityId]
    if (!n) return p
    let x = n.x
    let y = n.y
    if (p.parentId && groupById[p.parentId]) {
      x -= groupById[p.parentId].position.x
      y -= groupById[p.parentId].position.y
    }
    return { ...p, position: { x: Math.round(x), y: Math.round(y) } }
  })

  const edges = assignEdgeHandles(placements, groups, diagram.edges, heightById)
  return { placements, groups, edges }
}
