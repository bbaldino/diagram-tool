import { useRef } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
  type Position,
} from '@xyflow/react'

type Pt = { x: number; y: number }

// smooth spline (Catmull-Rom -> cubic bezier) through a list of points
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

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

// insert p into the polyline [s, ...pts, t] at the nearest segment, preserving order
function insertNearest(pts: Pt[], p: Pt, s: Pt, t: Pt): Pt[] {
  const chain = [s, ...pts, t]
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < chain.length - 1; i++) {
    const d = distToSeg(p, chain[i], chain[i + 1])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  const out = [...pts]
  out.splice(best, 0, p)
  return out
}

function edgePath(
  shape: string,
  sx: number,
  sy: number,
  sPos: Position,
  tx: number,
  ty: number,
  tPos: Position,
  points: Pt[],
): [string, number, number] {
  if (points.length) {
    const chain: Pt[] = [{ x: sx, y: sy }, ...points, { x: tx, y: ty }]
    const d = shape === 'default' ? catmull(chain) : 'M ' + chain.map((p) => `${p.x} ${p.y}`).join(' L ')
    const m = Math.floor((chain.length - 1) / 2)
    const a = chain[m]
    const b = chain[m + 1] || a
    return [d, (a.x + b.x) / 2, (a.y + b.y) / 2]
  }
  if (shape === 'smoothstep') {
    const [d, lx, ly] = getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })
    return [d, lx, ly]
  }
  if (shape === 'straight') {
    const [d, lx, ly] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
    return [d, lx, ly]
  }
  const [d, lx, ly] = getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })
  return [d, lx, ly]
}

export function WaypointEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, label, selected } = props
  const { setEdges, screenToFlowPosition, getZoom } = useReactFlow()
  const shape = (data?.shape as string) || 'default'
  const points = (data?.points as Pt[]) || []
  const [d, labelX, labelY] = edgePath(shape, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, points)
  const relColor = ((style as React.CSSProperties)?.stroke as string) || '#64748b'

  const setPoints = (updater: (pts: Pt[]) => Pt[]) =>
    setEdges((es) =>
      es.map((e) => (e.id === id ? { ...e, data: { ...e.data, points: updater((e.data?.points as Pt[]) || []) } } : e)),
    )

  const addAt = (clientX: number, clientY: number) => {
    const p = screenToFlowPosition({ x: clientX, y: clientY })
    setPoints((pts) => insertNearest(pts, { x: p.x, y: p.y }, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }))
  }

  const dragging = useRef(false)
  const startDrag = (i: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    dragging.current = true
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer to capture (e.g. synthetic event) */
    }
    const snap = 8 / (getZoom() || 1) // ~8px on screen → flow units; subtle right-angle snapping
    const move = (ev: PointerEvent) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      setPoints((pts) => {
        const prev = i > 0 ? pts[i - 1] : { x: sourceX, y: sourceY }
        const next = i < pts.length - 1 ? pts[i + 1] : { x: targetX, y: targetY }
        let nx = p.x
        let ny = p.y
        // snap x to a neighbor's x (makes that segment vertical), y to a neighbor's y (horizontal)
        if (Math.abs(nx - prev.x) < snap) nx = prev.x
        else if (Math.abs(nx - next.x) < snap) nx = next.x
        if (Math.abs(ny - prev.y) < snap) ny = prev.y
        else if (Math.abs(ny - next.y) < snap) ny = next.y
        return pts.map((pt, idx) => (idx === i ? { x: nx, y: ny } : pt))
      })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setTimeout(() => {
        dragging.current = false
      }, 60)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const removeAt = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setPoints((pts) => pts.filter((_, idx) => idx !== i))
  }

  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} style={style} interactionWidth={26} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="wp-label"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, color: relColor }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {selected ? (
        <>
          {/* wide invisible path (painted UNDER the dots): click the line to add a waypoint */}
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={22}
            style={{ cursor: 'copy' }}
            onClick={(e) => {
              e.stopPropagation()
              if (dragging.current) return
              addAt(e.clientX, e.clientY)
            }}
          />
          {/* draggable dots as SVG circles, painted on top so they win the pointer */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={7}
              fill="#ffffff"
              stroke={relColor}
              strokeWidth={2}
              style={{ cursor: 'grab', pointerEvents: 'all' }}
              onPointerDown={startDrag(i)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                removeAt(i)(e)
              }}
            >
              <title>drag to move · double-click to remove</title>
            </circle>
          ))}
        </>
      ) : null}
    </>
  )
}

export const edgeTypes = { waypoint: WaypointEdge }
