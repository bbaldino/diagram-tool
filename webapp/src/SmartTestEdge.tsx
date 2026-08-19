import { BaseEdge, useNodes, type EdgeProps, type Node } from '@xyflow/react'
import { getSmartEdge, type SVGDrawFunction } from '@tisoap/react-flow-smart-edge'

type Pt = { x: number; y: number }

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Ramer-Douglas-Peucker: drop points within `eps` of the chord between their
// kept neighbours. A* returns a dense grid path with a stair-step at every
// diagonal; this collapses each staircase back to the few corners that actually
// carry the route. eps stays well under the router's 14px node padding, so
// simplifying can't pull the line into a box it was routed around.
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts
  let maxD = 0
  let idx = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= eps) return [a, b]
  const left = simplify(pts.slice(0, idx + 1), eps)
  const right = simplify(pts.slice(idx), eps)
  return [...left.slice(0, -1), ...right]
}

// Custom draw: simplify the A* grid path, then join the surviving corners with
// straight segments — no spline. Collapses the diagonal staircases into clean
// straight/diagonal runs while keeping every real corner crisp. Endpoints are
// pinned to the real source/target so the line meets the handles exactly.
const straightSimplifiedDraw: SVGDrawFunction = (source, target, path) => {
  if (path.length < 2) return `M ${source.x},${source.y} L ${target.x},${target.y}`
  const pts: Pt[] = path.map(([x, y]) => ({ x, y }))
  pts[0] = { x: source.x, y: source.y }
  pts[pts.length - 1] = { x: target.x, y: target.y }
  const kept = simplify(pts, 8)
  return 'M ' + kept.map((p) => `${p.x},${p.y}`).join(' L ')
}

// DEMO: pathfinding edge. Routes around SERVICE-node boxes (groups/notes are not
// obstacles, so edges may cross group boundaries) using A* on a grid, on the
// current node positions — no re-placement. Replaces WaypointEdge for the trial.
export function SmartTestEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
  } = props
  const nodes = useNodes()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const absPos = (n: Node) => {
    let x = n.position.x
    let y = n.position.y
    let p = n.parentId
    const seen = new Set<string>()
    while (p && !seen.has(p)) {
      seen.add(p)
      const g = byId.get(p)
      if (!g) break
      x += g.position.x
      y += g.position.y
      p = g.parentId
    }
    return { x, y }
  }
  const obstacles = nodes
    .filter((n) => n.type === 'service' && n.id !== props.source && n.id !== props.target)
    .map((n) => ({
      ...n,
      position: absPos(n),
      width: n.measured?.width ?? 180,
      height: n.measured?.height ?? 64,
    })) as Node[]

  const straight = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  let path = straight
  try {
    const res = getSmartEdge({
      sourcePosition,
      targetPosition,
      sourceX,
      sourceY,
      targetX,
      targetY,
      nodes: obstacles,
      options: { nodePadding: 14, gridRatio: 12, drawEdge: straightSimplifiedDraw },
    })
    if (res && !(res instanceof Error) && res.svgPathString) path = res.svgPathString
  } catch {
    // fall back to the straight line
  }
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
}
