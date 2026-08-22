import type { Diagram, Node, Group, Note, Edge, EdgeOrientation, ElkConfig } from '../shared/model'
import { DEFAULT_ELK } from '../shared/model'
import ELK from 'elkjs/lib/elk.bundled.js'
import { runElk } from './layout-elk'
import { runGraphviz } from './layout-graphviz'
import { contractEdges } from './layout-tree'
import {
  requiredGroupSize,
  reflowContainment,
  GROUP_PAD,
  GROUP_NEST_TOP_PAD,
} from '../shared/containment'

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

// Choose which side of each node an edge attaches to.
//
// Geometry-first: the axis follows the actual laid-out positions, so a handle
// always faces the other box. `orientation` is a modeling hint fixed at
// authoring time (horizontal = I/O, vertical = peer/side-channel); after a
// re-layout it is often stale, and honouring it against the geometry forces the
// handle onto the side facing AWAY from the other box — the edge then has to
// loop back through the box to reach it. So the hint only decides the axis when
// the two boxes are near-diagonal, where geometry itself is ambiguous. The
// specific side is always derived from the centers, so it tracks the nodes on
// every layout.
export function handlesFor(
  orientation: EdgeOrientation | undefined,
  s: { x: number; y: number },
  t: { x: number; y: number },
): { sourceHandle: HandleId; targetHandle: HandleId } {
  const dx = t.x - s.x
  const dy = t.y - s.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  // Ambiguous only when neither axis dominates: the longer delta is within 1.3x
  // of the shorter. Outside that band, geometry is clear and the hint yields.
  const nearDiagonal = Math.min(ax, ay) > 0 && Math.max(ax, ay) <= 1.3 * Math.min(ax, ay)
  const axis =
    nearDiagonal && orientation === 'horizontal'
      ? 'h'
      : nearDiagonal && orientation === 'vertical'
        ? 'v'
        : ax >= ay
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

// One-pass hierarchical ELK layout with edge routing. Builds the whole nested
// group/node tree as one ELK graph with every real edge and edgeRouting=
// ORTHOGONAL, so ELK (a) places nodes edge-aware, (b) can un-cross edges that
// span group boundaries, and (c) hands back a routed path (bend points) for
// each edge that goes AROUND boxes instead of through them. Fills the caller's
// position maps and the `routes` map (routed handles + waypoints, in absolute
// canvas coordinates — which line up with the node positions because both come
// from this same ELK run and nothing is shifted afterward).
// Rough width of a rendered edge label. The server can't measure text; this
// only needs to be close enough for ELK to reserve believable space.
function labelWidth(text: string): number {
  return Math.min(240, Math.max(24, text.length * 6.2 + 10))
}

// Fraction along a polyline (by arc length) nearest to point p. Used to turn
// ELK's absolute label position into the app's labelPos (0..1 along the edge).
function fractionAlong(path: { x: number; y: number }[], p: { x: number; y: number }): number {
  let best = 0.5
  let bestD = Infinity
  let acc = 0
  const total =
    path.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - path[i].x, q.y - path[i].y), 0) || 1
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const t =
      L === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)),
          )
    const cx = a.x + (b.x - a.x) * t
    const cy = a.y + (b.y - a.y) * t
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d < bestD) {
      bestD = d
      best = (acc + t * L) / total
    }
    acc += L
  }
  return best
}

const hierElk = new ELK()
async function layoutHierarchical(
  diagram: Diagram,
  heightById: Record<string, number>,
  satelliteOf: Map<string, Satellite>,
  nodePos: Map<string, { x: number; y: number }>,
  notePos: Map<string, { x: number; y: number }>,
  groupPos: Map<string, { x: number; y: number }>,
  groupSize: Map<string, { width: number; height: number }>,
  routes: Map<
    string,
    {
      sourceHandle: HandleId
      targetHandle: HandleId
      points: { x: number; y: number }[]
      labelPos?: number
      route?: { x: number; y: number }[]
    }
  >,
): Promise<void> {
  const groupById = Object.fromEntries(diagram.groups.map((g) => [g.id, g]))
  const nodeById = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const noteIds = new Set(diagram.notes.map((n) => n.id))
  const parentOf = (id: string): string | null => nodeById[id]?.parentId ?? null

  // Satellites ride with their subject (same technique as layoutContainer): drop
  // them from ELK's children, inflate the subject's box to reserve the stack
  // height so nothing else takes that room, then unpack them into the subject's
  // column afterwards. Only merge when both sit in the same container.
  const riders = new Map<string, Satellite>()
  for (const [satId, s] of satelliteOf) {
    if (nodeById[satId] && nodeById[s.subjectId] && parentOf(satId) === parentOf(s.subjectId))
      riders.set(satId, s)
  }
  const ridersBySubject = new Map<string, { above: Node[]; below: Node[] }>()
  for (const [satId, s] of riders) {
    const entry = ridersBySubject.get(s.subjectId) ?? { above: [], below: [] }
    entry[s.side].push(nodeById[satId])
    ridersBySubject.set(s.subjectId, entry)
  }
  const blockHeight = (id: string): number => {
    const own = heightById[id] ?? H
    const r = ridersBySubject.get(id)
    if (!r) return own
    return (
      own +
      [...r.above, ...r.below].reduce((sum, s) => sum + (heightById[s.id] ?? H) + SATELLITE_GAP, 0)
    )
  }

  const cg = (cid: string | null) => diagram.groups.filter((g) => (g.parentId ?? null) === cid)
  const cn = (cid: string | null) =>
    diagram.nodes.filter((n) => (n.parentId ?? null) === cid && !riders.has(n.id))
  // Only grouped notes are arranged; top-level notes are left where they are.
  const cnote = (cid: string | null) =>
    cid === null ? [] : diagram.notes.filter((n) => n.parentId === cid)
  const buildGroup = (id: string): Record<string, unknown> => ({
    id,
    layoutOptions: {
      'elk.padding': `[top=${GROUP_NEST_TOP_PAD},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
    },
    children: [
      ...cg(id).map((g) => buildGroup(g.id)),
      ...cn(id).map((n) => ({ id: n.id, width: W, height: blockHeight(n.id) })),
      ...cnote(id).map((n) => ({ id: n.id, width: n.size.width, height: n.size.height })),
    ],
  })
  const root = {
    id: 'root',
    // Edge labels are real boxes the renderer draws mid-edge. Feeding them so
    // ELK reserves routing space is the point of this pass — otherwise it
    // routes bare lines and the labels land on top of nodes and each other.
    layoutOptions: elkLayoutOptions(diagram.routing?.elk ?? DEFAULT_ELK),
    children: [
      ...cg(null).map((g) => buildGroup(g.id)),
      ...cn(null).map((n) => ({ id: n.id, width: W, height: blockHeight(n.id) })),
    ],
    // A satellite edge is internal to its merged box — feeding it to ELK would
    // reintroduce the rank it exists to avoid. `he${i}` keeps the ORIGINAL edge
    // index so the routed sections map back to diagram.edges[i] below.
    edges: diagram.edges
      .map((e, i) =>
        riders.has(e.from) || riders.has(e.to)
          ? null
          : {
              id: `he${i}`,
              sources: [e.from],
              targets: [e.to],
              ...(e.label && e.label.trim()
                ? { labels: [{ text: e.label, width: labelWidth(e.label), height: 18 }] }
                : {}),
            },
      )
      .filter((e): e is NonNullable<typeof e> => e !== null),
  }
  const res = await hierElk.layout(root as never)

  // Record parent-relative positions (what elkjs returns) and accumulate an
  // absolute-position map for deriving handle sides from the routed endpoints.
  const abs = new Map<string, { x: number; y: number; w: number; h: number }>()
  const walk = (
    node: {
      children?: {
        id: string
        x?: number
        y?: number
        width?: number
        height?: number
        children?: unknown[]
      }[]
    },
    ox: number,
    oy: number,
  ) => {
    for (const c of node.children ?? []) {
      const rel = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }
      const ax = ox + (c.x ?? 0)
      const ay = oy + (c.y ?? 0)
      abs.set(c.id, { x: ax, y: ay, w: c.width ?? W, h: c.height ?? H })
      if (groupById[c.id]) {
        groupPos.set(c.id, rel)
        groupSize.set(c.id, { width: Math.round(c.width ?? 0), height: Math.round(c.height ?? 0) })
      } else if (noteIds.has(c.id)) {
        notePos.set(c.id, rel)
      } else {
        nodePos.set(c.id, rel)
      }
      walk(c as never, ax, ay)
    }
  }
  walk(res as never, 0, 0)

  // Unpack each merged block top-down: above-satellites, then the subject, then
  // below-satellites — all sharing the subject's column. ELK reserved the full
  // block height at the subject's box, so this only redistributes within it.
  for (const [subjectId, r] of ridersBySubject) {
    const box = nodePos.get(subjectId)
    if (!box) continue
    let cursor = box.y
    for (const s of r.above) {
      nodePos.set(s.id, { x: box.x, y: cursor })
      cursor += (heightById[s.id] ?? H) + SATELLITE_GAP
    }
    nodePos.set(subjectId, { x: box.x, y: cursor })
    cursor += heightById[subjectId] ?? H
    for (const s of r.below) {
      cursor += SATELLITE_GAP
      nodePos.set(s.id, { x: box.x, y: cursor })
      cursor += heightById[s.id] ?? H
    }
  }

  // Which side of a box a routed endpoint sits on.
  const sideOf = (
    p: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): HandleId => {
    const d = {
      left: Math.abs(p.x - b.x),
      right: Math.abs(p.x - (b.x + b.w)),
      top: Math.abs(p.y - b.y),
      bottom: Math.abs(p.y - (b.y + b.h)),
    }
    return (Object.keys(d) as HandleId[]).reduce((a, k) => (d[k] < d[a] ? k : a), 'right')
  }

  // Capture each edge's routed handles + interior waypoints. ELK returns every
  // root-declared edge's sections relative to the deepest group that contains
  // BOTH endpoints (a black-box hierarchy quirk): group-local coords for an
  // intra-group edge, absolute for a cross-group/root one. Add that LCA group's
  // absolute origin back so every route lands in absolute (flow) coords, matching
  // the node positions.
  const groupChain = (nodeId: string): string[] => {
    const chain: string[] = []
    let p = nodeById[nodeId]?.parentId ?? null
    while (p) {
      chain.push(p)
      p = groupById[p]?.parentId ?? null
    }
    return chain // deepest-first
  }
  const lcaOffset = (from: string, to: string): { x: number; y: number } => {
    const fa = new Set(groupChain(from))
    for (const g of groupChain(to)) if (fa.has(g)) return abs.get(g) ?? { x: 0, y: 0 }
    return { x: 0, y: 0 }
  }
  type ElkEdge = {
    id: string
    sections?: {
      startPoint: { x: number; y: number }
      endPoint: { x: number; y: number }
      bendPoints?: { x: number; y: number }[]
    }[]
    labels?: { x?: number; y?: number; width?: number; height?: number }[]
  }
  const collectEdges = (
    node: { edges?: ElkEdge[]; children?: unknown[] },
    out: ElkEdge[],
  ) => {
    for (const e of node.edges ?? []) out.push(e)
    for (const c of (node.children ?? []) as (typeof node)[]) collectEdges(c, out)
  }
  const elkEdges: ElkEdge[] = []
  collectEdges(res as never, elkEdges)
  for (const ee of elkEdges) {
    const i = Number(ee.id.slice(2))
    const de = diagram.edges[i]
    const sec = ee.sections?.[0]
    if (!de || !sec) continue
    const sb = abs.get(de.from)
    const tb = abs.get(de.to)
    if (!sb || !tb) continue
    const { x: ox, y: oy } = lcaOffset(de.from, de.to)
    const at = (p: { x: number; y: number }) => ({ x: Math.round(p.x + ox), y: Math.round(p.y + oy) })
    const start = at(sec.startPoint)
    const end = at(sec.endPoint)
    const points = (sec.bendPoints ?? []).map(at)
    // Where ELK ended up placing the label → labelPos along the routed path, so
    // the app draws the label in the gap ELK reserved for it.
    const lab = ee.labels?.[0]
    let labelPos: number | undefined
    if (lab && typeof lab.x === 'number' && typeof lab.y === 'number') {
      const center = { x: lab.x + ox + (lab.width ?? 0) / 2, y: lab.y + oy + (lab.height ?? 0) / 2 }
      labelPos = fractionAlong([start, ...points, end], center)
    }
    routes.set(de.id, {
      sourceHandle: sideOf(start, sb),
      targetHandle: sideOf(end, tb),
      points,
      labelPos,
      // Full routed polyline incl. ELK's true endpoints, so the app can draw the
      // edge exactly where ELK routed it instead of snapping to a center handle.
      route: [start, ...points, end],
    })
  }
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

  // Topology: one-pass hierarchical layout so ELK sees every cross-group edge
  // (the per-group path above contracts them away) — which lets it route each
  // edge AROUND the boxes and hand back the bend points. Everything else keeps
  // the directional recursion. `routes` collects the routed handles+waypoints.
  const routes = new Map<
    string,
    {
      sourceHandle: HandleId
      targetHandle: HandleId
      points: { x: number; y: number }[]
      labelPos?: number
      route?: { x: number; y: number }[]
    }
  >()
  if (diagram.type === 'topology') {
    await layoutHierarchical(
      diagram,
      heightById,
      satelliteOf,
      nodePos,
      notePos,
      groupPos,
      groupSize,
      routes,
    )
  } else {
    await layoutContainer(null)
  }

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

  // The handle SIDE always comes from geometry (assignEdgeHandles), so an edge
  // exits the face pointing toward the other box. ELK's route only contributes
  // the waypoints and label position — never the handle side. ELK draws a
  // back-edge (target behind the source in layer order) by exiting the source's
  // FAR face and looping around; adopting that side would pin the edge to the
  // wrong face and make it wrap back through/behind its own box to reach the
  // target. Geometry-first keeps the attach point on the near face.
  const geomEdges = assignEdgeHandles(reflowed.nodes, reflowed.groups, diagram.edges, heightById)

  // Pin each route's endpoints to the FINAL (post-reflow) node borders. ELK's
  // routes are computed pre-reflow and against a satellite subject's inflated
  // block, so without this the endpoints float free of the boxes; the interior
  // bendpoints stay exactly as ELK routed them.
  const rGroupById = Object.fromEntries(reflowed.groups.map((g) => [g.id, g]))
  const nodeById2 = Object.fromEntries(reflowed.nodes.map((n) => [n.id, n]))
  const gAbs = (id: string): { x: number; y: number } => {
    const g = rGroupById[id]
    if (!g) return { x: 0, y: 0 }
    const p = g.parentId ? gAbs(g.parentId) : { x: 0, y: 0 }
    return { x: p.x + g.position.x, y: p.y + g.position.y }
  }
  const nodeBox = (id: string) => {
    const n = nodeById2[id]
    if (!n) return null
    const p = n.parentId ? gAbs(n.parentId) : { x: 0, y: 0 }
    return { x: p.x + n.position.x, y: p.y + n.position.y, w: W, h: heightById[id] ?? H }
  }
  const clampToBox = (
    p: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ) => ({
    x: Math.round(Math.max(b.x, Math.min(b.x + b.w, p.x))),
    y: Math.round(Math.max(b.y, Math.min(b.y + b.h, p.y))),
  })
  const pinRoute = (route: { x: number; y: number }[], from: string, to: string) => {
    const sb = nodeBox(from)
    const tb = nodeBox(to)
    if (!sb || !tb || route.length < 2) return route
    return [clampToBox(route[0], sb), ...route.slice(1, -1), clampToBox(route[route.length - 1], tb)]
  }

  const edges = geomEdges.map((e) => {
    const r = routes.get(e.id)
    if (!r) return e
    return {
      ...e,
      points: r.points,
      ...(r.labelPos !== undefined ? { labelPos: r.labelPos } : {}),
      ...(r.route ? { route: pinRoute(r.route, e.from, e.to) } : {}),
    }
  })
  return { nodes: reflowed.nodes, groups: reflowed.groups, notes: reflowed.notes, edges }
}
