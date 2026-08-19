import {
  pathfindingAStarDiagonal,
  pathfindingAStarNoDiagonal,
  pathfindingJumpPointNoDiagonal,
  svgDrawSmoothStepLinePath,
  type PathFindingFunction,
  type SVGDrawFunction,
} from '@tisoap/react-flow-smart-edge'
import type { DrawStyle, PathAlgo } from '../shared/model'

export type Pt = { x: number; y: number }

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
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
export function simplify(pts: Pt[], eps: number): Pt[] {
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
export function catmull(points: Pt[]): string {
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

export const PATHFINDERS: Record<PathAlgo, PathFindingFunction> = {
  'no-diagonal': pathfindingAStarNoDiagonal,
  diagonal: pathfindingAStarDiagonal,
  'jump-point': pathfindingJumpPointNoDiagonal,
}

// Pick a draw function for the chosen style. 'stepped' returns undefined to use
// the library's default stepped renderer; 'straight'/'spline' simplify the grid
// path first, then draw as polyline or spline.
export function drawFor(style: DrawStyle, eps: number): SVGDrawFunction | undefined {
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
