import dagre from '@dagrejs/dagre'
import type { Diagram, Placement, Group, DEdge, EdgeOrientation } from '../src/model'

type HandleId = 'top' | 'right' | 'bottom' | 'left'

const W = 180
// Base node height (icon row + label/sub) — the box before any inline note.
const H = 64
const PAD = 24
const HEADER = 28
// Clearance kept between an ungrouped node and a group box, so it doesn't end
// up flush against the border/title. Also the margin within which a node is
// treated as "too close" and nudged away (not just on strict overlap).
const CLEAR = 48

// Inline-note sizing (matches .node__note in index.css): the note wraps inside
// the 180px box (~160px content at 11px/line-height 1.35 ≈ 15px per line, plus
// ~11px of top border + vertical padding). Estimated so dagre reserves real
// vertical room for boxes that carry a note instead of assuming a flat 64px.
const NOTE_CHARS_PER_LINE = 25
const NOTE_LINE_H = 15
const NOTE_CHROME = 12

// Edge-label sizing (matches .wp-label: 10px bold, single-line/nowrap pill with
// ~5px side padding). Passed to dagre as a label box so ranks/edges spread to
// make room instead of piling labels on top of each other and the nodes.
const LABEL_CHAR_W = 5.8
const LABEL_PAD = 12
const LABEL_MAX_W = 240
const LABEL_H = 16

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

function labelSize(label: string | undefined): { width: number; height: number } | null {
  const text = (label ?? '').trim()
  if (!text) return null
  const width = Math.min(LABEL_MAX_W, Math.round(text.length * LABEL_CHAR_W + LABEL_PAD))
  return { width, height: LABEL_H }
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

// Flow-directed layout: builds a dagre compound graph (rankdir LR), lets
// dagre place nodes/clusters, then converts center coords to top-left and
// makes grouped-member positions parent-relative (React Flow child coords
// are relative to their parent group). Pure — does not mutate `diagram`.
export function layoutDiagram(diagram: Diagram): { placements: Placement[]; groups: Group[]; edges: DEdge[] } {
  const g = new dagre.graphlib.Graph({ compound: true })
  g.setGraph({ rankdir: 'LR', nodesep: 55, ranksep: 110, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  // Per-node height (base box + inline note). Used both to size dagre nodes and
  // to convert dagre center coords back to top-left below — they must agree, or
  // tall notes would be placed as if the box were 64px and overlap neighbors.
  const heightById: Record<string, number> = {}
  for (const p of diagram.placements) heightById[p.entityId] = nodeHeight(p)

  // Register group nodes first so dagre treats them as compound clusters.
  // Give clusters a non-zero minimum size (+ padding for a header strip and
  // border) so dagre's cluster-sizing logic reliably produces a box that
  // wraps its members instead of collapsing to the member extents exactly.
  for (const grp of diagram.groups) {
    g.setNode(grp.id, { width: W + PAD * 2, height: H + PAD * 2 + HEADER })
  }
  for (const p of diagram.placements) {
    g.setNode(p.entityId, { width: W, height: heightById[p.entityId] })
    if (p.parentId) g.setParent(p.entityId, p.parentId)
  }
  for (const e of diagram.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue
    // Reserve space for the edge's label so dagre spreads ranks/edges to fit it.
    const ls = labelSize(e.label)
    g.setEdge(e.from, e.to, ls ? { ...ls, labelpos: 'c' } : {})
  }

  dagre.layout(g)

  // Group bounding boxes (absolute), from dagre cluster nodes. Expand around
  // the actual member extents (+ padding) so the box always wraps its
  // members regardless of how dagre sized the cluster node itself.
  const groups: Group[] = diagram.groups.map((grp) => {
    const n = g.node(grp.id) as { x: number; y: number; width: number; height: number } | undefined
    if (!n) return grp

    let minX = n.x - n.width / 2
    let minY = n.y - n.height / 2
    let maxX = n.x + n.width / 2
    let maxY = n.y + n.height / 2

    for (const p of diagram.placements) {
      if (p.parentId !== grp.id) continue
      const pn = g.node(p.entityId) as { x: number; y: number } | undefined
      if (!pn) continue
      const h = heightById[p.entityId] ?? H
      minX = Math.min(minX, pn.x - W / 2 - PAD)
      minY = Math.min(minY, pn.y - h / 2 - PAD - HEADER)
      maxX = Math.max(maxX, pn.x + W / 2 + PAD)
      maxY = Math.max(maxY, pn.y + h / 2 + PAD)
    }

    return {
      ...grp,
      position: { x: Math.round(minX), y: Math.round(minY) },
      size: { width: Math.round(maxX - minX), height: Math.round(maxY - minY) },
    }
  })

  const groupById: Record<string, Group> = Object.fromEntries(groups.map((grp) => [grp.id, grp]))

  const placements: Placement[] = diagram.placements.map((p) => {
    const n = g.node(p.entityId) as { x: number; y: number } | undefined
    if (!n) return p
    const h = heightById[p.entityId] ?? H
    let x = Math.round(n.x - W / 2)
    let y = Math.round(n.y - h / 2)
    if (p.parentId && groupById[p.parentId]) {
      // React Flow child coords are parent-relative; convert absolute -> relative.
      x -= groupById[p.parentId].position.x
      y -= groupById[p.parentId].position.y
    } else if (!p.parentId) {
      // Collision resolution: dagre only keeps same-rank siblings clear of
      // each other using the CLUSTER node's own (tighter) box; our group
      // boxes above are then padded/expanded with a header strip, which can
      // grow a box past the footprint dagre actually reserved and swallow a
      // neighboring ungrouped node. Nudge any ungrouped node that ends up
      // overlapping a group box clear of it, out whichever vertical edge is
      // closer (rankdir is LR, so vertical is the free axis). Re-scan all
      // groups after every nudge (bounded) — clearing one box can push the
      // node into another when groups are stacked/adjacent.
      for (let pass = 0; pass < groups.length + 1; pass++) {
        let movedThisPass = false
        for (const grp of groups) {
          const gLeft = grp.position.x
          const gTop = grp.position.y
          const gRight = grp.position.x + grp.size.width
          const gBottom = grp.position.y + grp.size.height
          const right = x + W
          const bottom = y + h
          // Inflate the box by CLEAR vertically so a node that's merely too
          // close (e.g. sitting just above the title) is nudged to a full gap,
          // not only ones that strictly overlap.
          const overlapsX = x < gRight && right > gLeft
          const tooCloseY = y < gBottom + CLEAR && bottom > gTop - CLEAR
          if (!overlapsX || !tooCloseY) continue
          const distUp = bottom - gTop // distance to clear out the top edge
          const distDown = gBottom - y // distance to clear out the bottom edge
          y = distUp <= distDown ? gTop - CLEAR - h : gBottom + CLEAR
          movedThisPass = true
        }
        if (!movedThisPass) break
      }
    }
    return { ...p, position: { x, y } }
  })

  // Absolute center of an entity's node: child coords are parent-relative, so
  // add the parent group's absolute position. Height matches nodeHeight above.
  const placementByEntity: Record<string, Placement> = Object.fromEntries(
    placements.map((p) => [p.entityId, p]),
  )
  const centerOf = (entityId: string): { x: number; y: number } | null => {
    const p = placementByEntity[entityId]
    if (!p) return null
    return absoluteCenter(p, groupById, heightById[entityId] ?? H)
  }

  const edges: DEdge[] = diagram.edges.map((e) => {
    const s = centerOf(e.from)
    const t = centerOf(e.to)
    if (!s || !t) return e
    return { ...e, ...handlesFor(e.orientation, s, t) }
  })

  return { placements, groups, edges }
}
