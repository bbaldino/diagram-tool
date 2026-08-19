import { useEffect } from 'react'
import { Position, useReactFlow, useStore } from '@xyflow/react'
import { getSmartEdge, type SVGDrawFunction } from '@tisoap/react-flow-smart-edge'
import { PATHFINDERS, drawFor } from './smartRouting'
import { setEdgeRoutes } from './edgeRoutes'
import type { PathAlgo, DrawStyle } from '../shared/model'

export interface EdgeRoutingKnobs {
  algo: PathAlgo
  draw: DrawStyle
  gridRatio: number
  nodePadding: number
  eps: number
  obstacleGroups: boolean
  obstacleNotes: boolean
}
type Rect = { x: number; y: number; width: number; height: number }

const POS: Record<string, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

// Canvas-level coordinator for the edge-aware routing probe: after pathfinding
// edges render, route every `.react-flow__edge-smart` SEQUENTIALLY via
// getSmartEdge, each avoiding the corridors already claimed by earlier edges
// (their drawn `points`, inflated to half-width `separation`), and publish the
// result to the ephemeral edgeRoutes store for SmartTestEdge to read. No-op
// unless `active && separation > 0`. DOM measurement + sequential routing, so
// it only runs client side and is verified manually (see useLabelDeoverlap for
// the sibling pattern this mirrors).
export function useEdgeRouting(active: boolean, separation: number, knobs: EdgeRoutingKnobs): void {
  const { screenToFlowPosition } = useReactFlow()
  // Positions signal (same idea as useLabelDeoverlap): re-run when nodes move.
  const posKey = useStore((s) => {
    let k = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.nodeLookup.forEach((n: any) => {
      const p = n.internals?.positionAbsolute ?? n.position
      k += `${n.id}:${p?.x},${p?.y};`
    })
    return k
  })
  // Edge handle sides: id -> `${sourceHandle}>${targetHandle}`. `sourceHandle`/
  // `targetHandle` are top-level RF Edge fields in this app (see buildGraph.ts /
  // graph.ts makeEdge), not `data.sourceHandle` — read them off `s.edges`
  // directly.
  const handleKey = useStore((s) =>
    s.edges
      .map((e) => `${e.id}:${e.sourceHandle ?? 'right'}>${e.targetHandle ?? 'left'}`)
      .join('|'),
  )
  // Edge endpoints: id -> `${source}>${target}` node ids (to exclude from that
  // edge's own obstacle set — an edge can't route around its own endpoints).
  const srcTgtKey = useStore((s) => s.edges.map((e) => `${e.id}:${e.source}>${e.target}`).join('|'))

  useEffect(() => {
    if (!active || separation <= 0) {
      setEdgeRoutes(new Map())
      return
    }
    const timer = setTimeout(() => {
      const drawEdge: SVGDrawFunction | undefined = drawFor(knobs.draw, knobs.eps)
      // 1. endpoints from DOM path ends (flow coords — RF authors edge path `d`
      //    attributes in flow units, so getPointAtLength needs no CTM remapping).
      type EdgeInput = { id: string; sx: number; sy: number; tx: number; ty: number }
      const inputs: EdgeInput[] = []
      const handleById = new Map<string, { s: Position; t: Position }>()
      for (const pair of handleKey.split('|')) {
        if (!pair) continue
        const [id, sides] = pair.split(':')
        const [s, t] = sides.split('>')
        handleById.set(id, { s: POS[s] ?? Position.Right, t: POS[t] ?? Position.Left })
      }
      for (const g of document.querySelectorAll<SVGGElement>('.react-flow__edge-smart')) {
        const id = g.getAttribute('data-id')
        const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path')
        if (!id || !path) continue
        const len = path.getTotalLength()
        if (!len) continue
        const a = path.getPointAtLength(0)
        const b = path.getPointAtLength(len)
        inputs.push({ id, sx: a.x, sy: a.y, tx: b.x, ty: b.y })
      }
      // 2. obstacle boxes (flow units) from node DOM, per type toggle. Endpoint
      //    exclusion is by id below (groups are only obstacles when toggled on;
      //    for the probe we exclude only each edge's own source/target ids —
      //    ancestor-group exclusion matters only with obstacleGroups on and can
      //    be refined later).
      const nodeBox = (sel: string): { id: string; box: Rect }[] => {
        const out: { id: string; box: Rect }[] = []
        for (const n of document.querySelectorAll<HTMLElement>(sel)) {
          const id = n.getAttribute('data-id')
          if (!id) continue
          const r = n.getBoundingClientRect()
          const tl = screenToFlowPosition({ x: r.left, y: r.top })
          const br = screenToFlowPosition({ x: r.right, y: r.bottom })
          out.push({ id, box: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y } })
        }
        return out
      }
      const obstacles = [
        ...nodeBox('.react-flow__node-service'),
        ...(knobs.obstacleGroups ? nodeBox('.react-flow__node-group') : []),
        ...(knobs.obstacleNotes ? nodeBox('.react-flow__node-note') : []),
      ]
      // getSmartEdge wants Node-like obstacles: { id, position: {x,y}, width,
      // height, measured, data }. Synthesized from DOM boxes, so the shape is
      // narrower than a real RF Node — `as any` is scoped to this cast only.
      const asNode = (o: { id: string; box: Rect }) => ({
        id: o.id,
        position: { x: o.box.x, y: o.box.y },
        width: o.box.width,
        height: o.box.height,
        measured: { width: o.box.width, height: o.box.height },
        data: {},
      })
      // Endpoint node ids per edge, to drop from that edge's obstacle set (an
      // edge must not treat its own source/target as walls).
      const endpointsById = new Map<string, [string, string]>()
      for (const pair of srcTgtKey.split('|')) {
        if (!pair) continue
        const [id, st] = pair.split(':')
        const [s, t] = st.split('>')
        endpointsById.set(id, [s, t])
      }
      // Route shortest source→target distance first, ties by id — matches the
      // task-4 brief's ordering so shorter edges claim corridors before longer
      // ones have to detour around them.
      inputs.sort((e1, e2) => {
        const d1 = Math.hypot(e1.tx - e1.sx, e1.ty - e1.sy)
        const d2 = Math.hypot(e2.tx - e2.sx, e2.ty - e2.sy)
        return d1 - d2 || (e1.id < e2.id ? -1 : 1)
      })
      const avoid: Rect[] = []
      const routes = new Map<string, string>()
      for (const e of inputs) {
        const h = handleById.get(e.id) ?? { s: Position.Right, t: Position.Left }
        const ends = endpointsById.get(e.id) ?? ['', '']
        const myObstacles = obstacles.filter((o) => o.id !== ends[0] && o.id !== ends[1])
        const res = getSmartEdge({
          sourceX: e.sx,
          sourceY: e.sy,
          targetX: e.tx,
          targetY: e.ty,
          sourcePosition: h.s,
          targetPosition: h.t,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodes: myObstacles.map(asNode) as any,
          options: {
            gridRatio: knobs.gridRatio,
            nodePadding: knobs.nodePadding,
            generatePath: PATHFINDERS[knobs.algo],
            drawEdge,
            avoidAreas: avoid,
          },
        })
        if (res && !(res instanceof Error) && res.svgPathString) {
          routes.set(e.id, res.svgPathString)
          // Accumulate avoid-strips from this edge's raw points so later edges
          // in the sequence route around the corridor this one just claimed.
          const pts = res.points
          for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i]
            const [x2, y2] = pts[i + 1]
            avoid.push({
              x: Math.min(x1, x2) - separation,
              y: Math.min(y1, y2) - separation,
              width: Math.abs(x2 - x1) + 2 * separation,
              height: Math.abs(y2 - y1) + 2 * separation,
            })
          }
        }
      }
      setEdgeRoutes(routes)
    }, 150)
    return () => clearTimeout(timer)
    // Effect deps are knob PRIMITIVES (not the `knobs` object, which is a fresh
    // identity every render and would re-run the effect every render).
  }, [
    active,
    separation,
    posKey,
    handleKey,
    srcTgtKey,
    knobs.algo,
    knobs.draw,
    knobs.gridRatio,
    knobs.nodePadding,
    knobs.eps,
    knobs.obstacleGroups,
    knobs.obstacleNotes,
    screenToFlowPosition,
  ])
}
