import { useLayoutEffect, useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  useNodes,
  useReactFlow,
  type EdgeProps,
  type Node,
} from '@xyflow/react'
import { getSmartEdge, isDirectPathBlocked } from '@tisoap/react-flow-smart-edge'
import { useActiveRouting } from './routingKnobs'
import { useLabelPlacement } from './labelPlacement'
import { PATHFINDERS, drawFor } from './smartRouting'

// Pathfinding edge: routes with A* around a configurable obstacle set on the
// current node positions (no re-placement). Reads its knobs from the
// active-diagram routing store, so the Diagram Settings dialog re-routes
// edges live.
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
    markerStart,
    label,
    data,
    selected,
  } = props
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const k = useActiveRouting().pathfinding
  const nodes = useNodes()
  const auto = useLabelPlacement(id)
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
  const pinned = data?.labelPinned === true
  const labelPos = Math.max(
    0,
    Math.min(1, pinned ? ((data?.labelPos as number) ?? 0.5) : (auto?.labelPos ?? 0.5)),
  )
  const offset = pinned
    ? ((data?.labelOffset as { x: number; y: number }) ?? { x: 0, y: 0 })
    : (auto?.offset ?? { x: 0, y: 0 })

  const measureRef = useRef<SVGPathElement>(null)
  const [labelPt, setLabelPt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const total = el.getTotalLength()
    if (!total) {
      setLabelPt(null)
      return
    }
    const p = el.getPointAtLength(labelPos * total)
    setLabelPt({ x: p.x, y: p.y })
  }, [path, labelPos])

  const setPlacement = (pos: number, off: { x: number; y: number }) =>
    setEdges((es) =>
      es.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, labelPos: pos, labelOffset: off, labelPinned: true } }
          : e,
      ),
    )
  const unpin = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    setEdges((es) =>
      es.map((e) =>
        e.id === id
          ? {
              ...e,
              data: { ...e.data, labelPinned: false, labelOffset: undefined, labelPos: undefined },
            }
          : e,
      ),
    )
  }

  const startLabelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic event with no active pointer */
    }
    const move = (ev: PointerEvent) => {
      const measure = measureRef.current
      if (!measure) return
      const total = measure.getTotalLength()
      if (!total) return
      const cursor = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      // nearest point on the path (flow coords) by sampling
      const N = 100
      let bestT = 0
      let bestD = Infinity
      let bestPt = { x: 0, y: 0 }
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const p = measure.getPointAtLength(t * total)
        const d = (p.x - cursor.x) ** 2 + (p.y - cursor.y) ** 2
        if (d < bestD) {
          bestD = d
          bestT = t
          bestPt = { x: p.x, y: p.y }
        }
      }
      setPlacement(bestT, { x: cursor.x - bestPt.x, y: cursor.y - bestPt.y })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const relColor = ((style as React.CSSProperties)?.stroke as string) || '#64748b'
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} />
      {label ? (
        <>
          <path
            ref={measureRef}
            d={path}
            fill="none"
            stroke="none"
            style={{ pointerEvents: 'none' }}
          />
          {labelPt ? (
            <EdgeLabelRenderer>
              <div
                className={['wp-label', selected ? 'nopan nodrag' : ''].filter(Boolean).join(' ')}
                data-edge-id={id}
                data-pinned={pinned ? 'true' : 'false'}
                data-label-pos={labelPos}
                data-offx={offset.x}
                data-offy={offset.y}
                style={{
                  transform: `translate(-50%,-50%) translate(${labelPt.x + offset.x}px,${labelPt.y + offset.y}px)`,
                  color: relColor,
                  pointerEvents: selected ? 'all' : 'none',
                  cursor: selected ? 'grab' : 'default',
                }}
                onPointerDown={selected ? startLabelDrag : undefined}
                onDoubleClick={selected ? unpin : undefined}
                title={selected ? 'drag to place · double-click to auto-place' : undefined}
              >
                {label}
              </div>
            </EdgeLabelRenderer>
          ) : null}
        </>
      ) : null}
    </>
  )
}
