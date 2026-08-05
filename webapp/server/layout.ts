import type { Diagram, Node, Group, Note, Edge, EdgeOrientation } from '../shared/model'
import { runElk } from './layout-elk'
import { runGraphviz } from './layout-graphviz'
import { contractEdges } from './layout-tree'
import {
  requiredGroupSize,
  reflowContainment,
  GROUP_PAD,
  GROUP_NEST_TOP_PAD,
} from '../shared/containment'

type HandleId = 'top' | 'right' | 'bottom' | 'left'

export const W = 180

export type LayoutEngine = 'elk' | 'graphviz'
export const DEFAULT_ENGINE: LayoutEngine = 'elk'

export interface FlatBox {
  id: string
  width: number
  height: number
}
export interface FlatEdge {
  from: string
  to: string
}
// Lay out a flat set of sized boxes; return each box's top-left position in
// engine coordinates (arbitrary origin — the orchestrator normalizes). No
// groups, no clusters, no hierarchy.
export type FlatEngine = (
  boxes: FlatBox[],
  edges: FlatEdge[],
) => Promise<Record<string, { x: number; y: number }>>

// Fallback node height, used only when the client hasn't measured a node yet
// (first layout of a freshly-imported diagram, or a headless MCP call).
const H = 64

// Real rendered heights, keyed by node id. The canvas pins every node to W
// pixels wide, so only height varies — it grows as a long label wraps inside
// that fixed width. React Flow measures this client-side; the server cannot,
// so it arrives with the layout request.
export type NodeSizes = Record<string, { height?: number }>

// Height the engine should reserve for a node. A measured height beats the
// fallback; a zero/negative measurement is ignored rather than collapsing the
// box (React Flow reports 0 for a node it has not rendered yet).
export function nodeHeight(n: Node, sizes?: NodeSizes): number {
  const measured = sizes?.[n.id]?.height
  return typeof measured === 'number' && measured > 0 ? measured : H
}

// Vertical gap between a subject and a satellite stacked against it. Small on
// purpose: the pair should read as one annotated step, not two steps.
export const SATELLITE_GAP = 16

export type SatelliteSide = 'above' | 'below'
export interface Satellite {
  subjectId: string
  side: SatelliteSide
}

// Find the annotation nodes that should ride with a subject rather than take a
// rank of their own. A satellite is a LEAF joined to exactly one other node by
// a single edge the author marked `orientation: 'vertical'` — "hang this label
// off that step". Layered engines have no concept of that; handed the edge as
// ordinary graph structure they push the annotation a full rank sideways, so
// the arrow ends up drawn top-to-bottom between two boxes sitting side by side.
//
// The leaf test is what keeps this conservative: a node that participates in
// the flow at all (any second edge) stays in the flow and gets ranked normally.
export function findSatellites(nodes: Node[], edges: Edge[]): Map<string, Satellite> {
  const ids = new Set(nodes.map((n) => n.id))
  const degree = new Map<string, number>()
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const out = new Map<string, Satellite>()
  for (const e of edges) {
    if (e.orientation !== 'vertical') continue
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue
    if ((degree.get(e.to) ?? 0) !== 1) continue
    // Which side the author anchored it on. The stored handles carry that
    // intent; final handles are re-derived from geometry afterwards, so
    // honouring them here keeps the arrow pointing the way it was drawn.
    const side: SatelliteSide =
      e.sourceHandle === 'top' || e.targetHandle === 'bottom' ? 'above' : 'below'
    out.set(e.to, { subjectId: e.from, side })
  }
  return out
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

// Leaf-first recursive layout orchestrator: lays out each container (group,
// or the canvas root) as its own flat box-packing problem, recursing into
// child groups FIRST so their required sizes are known before the parent
// packs them as boxes alongside its own direct-child nodes/notes. Every
// container's children come out parent-relative to THAT container's own
// padded top-left, so there's no separate global recomposition pass — the
// per-container result already is the final (parent-relative) position.
// Preserves nesting depth (unlike the old flatten-everything dispatcher) and
// carries grouped notes through as first-class laid-out entities. Pure —
// does not mutate `diagram`.
export async function layoutDiagram(
  diagram: Diagram,
  engine: LayoutEngine = DEFAULT_ENGINE,
  sizes?: NodeSizes,
): Promise<{ nodes: Node[]; groups: Group[]; notes: Note[]; edges: Edge[] }> {
  const flat = engine === 'graphviz' ? runGraphviz : runElk
  const heightById: Record<string, number> = {}
  for (const n of diagram.nodes) heightById[n.id] = nodeHeight(n, sizes)

  const nodeById: Record<string, Node> = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const satelliteOf = findSatellites(diagram.nodes, diagram.edges)

  const nodeIds = new Set(diagram.nodes.map((n) => n.id))
  const groupIds = new Set(diagram.groups.map((g) => g.id))
  const edgesByLca = contractEdges(diagram)

  const nodePos = new Map<string, { x: number; y: number }>()
  const notePos = new Map<string, { x: number; y: number }>()
  const groupPos = new Map<string, { x: number; y: number }>()
  const groupSize = new Map<string, { width: number; height: number }>()

  // Lay out one container (a group id, or null for the canvas root). Recurses
  // into child groups FIRST (leaf-first) so their sizes are known before this
  // container is packed. Records each direct child's parent-relative position.
  const layoutContainer = async (
    containerId: string | null,
  ): Promise<{ width: number; height: number }> => {
    const childGroups = diagram.groups.filter((g) => (g.parentId ?? null) === containerId)
    for (const cg of childGroups) await layoutContainer(cg.id)

    const childNodes = diagram.nodes.filter((n) => (n.parentId ?? null) === containerId)
    // Top-level notes are left where they are; only grouped notes are arranged.
    const childNotes =
      containerId === null ? [] : diagram.notes.filter((n) => n.parentId === containerId)

    // Satellites ride with their subject instead of being packed themselves,
    // but only when both sit in THIS container — a pair straddling a group
    // boundary has no single box to merge into, so it lays out normally.
    const childIds = new Set(childNodes.map((n) => n.id))
    const riders = new Map<string, Satellite>()
    for (const n of childNodes) {
      const s = satelliteOf.get(n.id)
      if (s && childIds.has(s.subjectId)) riders.set(n.id, s)
    }
    const ridersBySubject = new Map<string, { above: Node[]; below: Node[] }>()
    for (const [satId, s] of riders) {
      const entry = ridersBySubject.get(s.subjectId) ?? { above: [], below: [] }
      entry[s.side].push(nodeById[satId])
      ridersBySubject.set(s.subjectId, entry)
    }
    // Height of the merged subject+satellites stack. Passing this to the engine
    // (rather than dropping satellites outright) is what reserves the vertical
    // room, so a satellite can't land on top of a neighbour in the same rank.
    const blockHeight = (id: string): number => {
      const own = heightById[id] ?? H
      const r = ridersBySubject.get(id)
      if (!r) return own
      const stack = [...r.above, ...r.below]
      return own + stack.reduce((sum, s) => sum + (heightById[s.id] ?? H) + SATELLITE_GAP, 0)
    }

    const packedNodes = childNodes.filter((n) => !riders.has(n.id))
    const boxes: FlatBox[] = [
      ...packedNodes.map((n) => ({ id: n.id, width: W, height: blockHeight(n.id) })),
      ...childGroups.map((g) => ({ id: g.id, ...groupSize.get(g.id)! })),
      ...childNotes.map((n) => ({ id: n.id, ...n.size })),
    ]

    if (boxes.length === 0) {
      const existing = containerId
        ? diagram.groups.find((g) => g.id === containerId)!.size
        : { width: 0, height: 0 }
      if (containerId) groupSize.set(containerId, existing)
      return existing
    }

    // A satellite edge is internal to its merged box — handing it to the engine
    // would reintroduce the rank it exists to avoid.
    const rawEdges = (edgesByLca.get(containerId) ?? []).filter(
      (e) => !riders.has(e.from) && !riders.has(e.to),
    )
    const pos = await flat(boxes, rawEdges)

    // Normalize the engine's arbitrary origin: shift the bbox top-left to the
    // container's padded top-left (root → (0,0)).
    const originX = Math.min(...boxes.map((b) => pos[b.id].x))
    const originY = Math.min(...boxes.map((b) => pos[b.id].y))
    const padX = containerId === null ? 0 : GROUP_PAD
    const padY = containerId === null ? 0 : GROUP_NEST_TOP_PAD

    const placed: {
      position: { x: number; y: number }
      size: { width: number; height: number }
    }[] = []
    for (const b of boxes) {
      const p = {
        x: Math.round(pos[b.id].x - originX + padX),
        y: Math.round(pos[b.id].y - originY + padY),
      }
      placed.push({ position: p, size: { width: b.width, height: b.height } })
      if (nodeIds.has(b.id)) {
        // Unpack the merged block top-down: above-satellites, then the subject,
        // then below-satellites — each sharing the subject's column.
        const r = ridersBySubject.get(b.id)
        if (!r) {
          nodePos.set(b.id, p)
        } else {
          let cursor = p.y
          for (const s of r.above) {
            nodePos.set(s.id, { x: p.x, y: cursor })
            cursor += (heightById[s.id] ?? H) + SATELLITE_GAP
          }
          nodePos.set(b.id, { x: p.x, y: cursor })
          cursor += heightById[b.id] ?? H
          for (const s of r.below) {
            cursor += SATELLITE_GAP
            nodePos.set(s.id, { x: p.x, y: cursor })
            cursor += heightById[s.id] ?? H
          }
        }
      } else if (groupIds.has(b.id)) groupPos.set(b.id, p)
      else notePos.set(b.id, p)
    }

    if (containerId === null) return { width: 0, height: 0 }
    const size = requiredGroupSize(placed)
    groupSize.set(containerId, size)
    return size
  }

  await layoutContainer(null)

  const groups: Group[] = diagram.groups.map((g) => ({
    ...g,
    position: groupPos.get(g.id) ?? g.position,
    size: groupSize.get(g.id) ?? g.size,
  }))
  const nodes: Node[] = diagram.nodes.map((n) => ({
    ...n,
    position: nodePos.get(n.id) ?? n.position,
  }))
  const notes: Note[] = diagram.notes.map((n) => ({
    ...n,
    position: notePos.get(n.id) ?? n.position,
  }))

  // Backstop: enforce padding/slack/grow-to-fit invariants (grow-only).
  const reflowed = reflowContainment({ ...diagram, nodes, groups, notes })

  const edges = assignEdgeHandles(reflowed.nodes, reflowed.groups, diagram.edges, heightById)
  return { nodes: reflowed.nodes, groups: reflowed.groups, notes: reflowed.notes, edges }
}
