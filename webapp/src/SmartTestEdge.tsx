import { BaseEdge, useNodes, type EdgeProps, type Node } from '@xyflow/react'
import {
  getSmartEdge,
  isDirectPathBlocked,
  pathfindingAStarDiagonal,
  pathfindingAStarNoDiagonal,
  pathfindingJumpPointNoDiagonal,
  svgDrawSmoothStepLinePath,
  type PathFindingFunction,
  type SVGDrawFunction,
} from '@tisoap/react-flow-smart-edge'
import { useRoutingKnobs, type DrawStyle, type PathAlgo } from './routingKnobs'

type Pt = { x: number; y: number }

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Ramer-Douglas-Peucker: collapse the A* grid staircase down to the corners that
// actually carry the route. eps stays under nodePadding so it can't shortcut a
// line into a box the router went around.
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

// Catmull-Rom spline (uniform) -> cubic bezier, same curve family as WaypointEdge.
function catmull(points: Pt[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

const PATHFINDERS: Record<PathAlgo, PathFindingFunction> = {
  'no-diagonal': pathfindingAStarNoDiagonal,
  diagonal: pathfindingAStarDiagonal,
  'jump-point': pathfindingJumpPointNoDiagonal,
}

// Pick a draw function for the chosen style. 'stepped' returns undefined to use
// the library's default stepped renderer; 'straight'/'spline' simplify the grid
// path first, then draw as polyline or spline.
function drawFor(style: DrawStyle, eps: number): SVGDrawFunction | undefined {
  if (style === 'stepped') return undefined
  if (style === 'smoothstep') return svgDrawSmoothStepLinePath({ borderRadius: 8 })
  return (source, target, path) => {
    if (path.length < 2) return `M ${source.x},${source.y} L ${target.x},${target.y}`
    const pts: Pt[] = path.map(([x, y]) => ({ x, y }))
    pts[0] = { x: source.x, y: source.y }
    pts[pts.length - 1] = { x: target.x, y: target.y }
    const kept = simplify(pts, eps)
    return style === 'spline' ? catmull(kept) : 'M ' + kept.map((p) => `${p.x},${p.y}`).join(' L ')
  }
}

// DEMO: pathfinding edge. Routes with A* around a configurable obstacle set on
// the current node positions (no re-placement). Every knob comes from the shared
// routingKnobs store, so the RoutingKnobsPanel re-routes all edges live.
export function SmartTestEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
  } = props
  const k = useRoutingKnobs()
  const nodes = useNodes()
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Absolute top-left of a node (child coords are parent-relative).
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
  const ancestorsOf = (start: string) => {
    const out = new Set<string>()
    let p = byId.get(start)?.parentId
    while (p && !out.has(p)) {
      out.add(p)
      p = byId.get(p)?.parentId
    }
    return out
  }
  const sizeOf = (n: Node) => ({
    width: n.measured?.width ?? (typeof n.style?.width === 'number' ? n.style.width : 180),
    height: n.measured?.height ?? (typeof n.style?.height === 'number' ? n.style.height : 64),
  })

  // Never treat an endpoint — or a group that CONTAINS an endpoint — as an
  // obstacle, else the edge could never enter its own container.
  const exclude = new Set<string>([source, target, ...ancestorsOf(source), ...ancestorsOf(target)])
  const wanted = (n: Node) =>
    n.type === 'service'
      ? true
      : n.type === 'group'
        ? k.obstacleGroups
        : n.type === 'note'
          ? k.obstacleNotes
          : false
  const obstacles = nodes
    .filter((n) => wanted(n) && !exclude.has(n.id))
    .map((n) => ({ ...n, position: absPos(n), ...sizeOf(n) })) as Node[]

  const straight = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  let path = straight
  const directClear =
    k.directSkip &&
    !isDirectPathBlocked({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles, {
      nodePadding: k.nodePadding,
    })
  if (!directClear) {
    try {
      const res = getSmartEdge({
        sourcePosition,
        targetPosition,
        sourceX,
        sourceY,
        targetX,
        targetY,
        nodes: obstacles,
        options: {
          nodePadding: k.nodePadding,
          gridRatio: k.gridRatio,
          generatePath: PATHFINDERS[k.algo],
          drawEdge: drawFor(k.draw, k.eps),
        },
      })
      if (res && !(res instanceof Error) && res.svgPathString) path = res.svgPathString
    } catch {
      // fall back to the straight line
    }
  }
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
}
