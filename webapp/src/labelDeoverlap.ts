export interface Pt {
  x: number
  y: number
}
export interface LabelPlacement {
  labelPos: number
  offset: { x: number; y: number }
}
export interface LabelInput {
  id: string
  width: number
  height: number
  pinned: boolean
  placement: LabelPlacement // pinned = fixed; unpinned = seed (usually {0.5,{0,0}})
  anchorAt: (t: number) => { x: number; y: number }
  normalAt: (t: number) => { x: number; y: number }
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface DeoverlapOpts {
  minPos?: number
  maxPos?: number
  maxOffset?: number
  iterations?: number
}

// Min distance from a point to a line segment.
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

function interArea(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return ix * iy
}

// Resolve overlapping labels by sliding each unpinned label along its own line,
// and — where sliding cannot reduce the overlap (near-coincident lines) — nudging
// it perpendicular. Deterministic: labels processed in id order. Pinned labels
// and node boxes are static obstacles; only unpinned labels move. Returns a
// placement for every UNPINNED label.
export function resolveLabelPlacements(
  labels: LabelInput[],
  nodeBoxes: Rect[] = [],
  opts: DeoverlapOpts = {},
): Map<string, LabelPlacement> {
  const minPos = opts.minPos ?? 0.2
  const maxPos = opts.maxPos ?? 0.8
  const maxOffset = opts.maxOffset ?? 28
  const iterations = opts.iterations ?? 24
  const slideStep = 0.06
  const offStep = 6

  const place = new Map<string, LabelPlacement>()
  for (const l of labels) {
    place.set(l.id, { labelPos: l.placement.labelPos, offset: { ...l.placement.offset } })
  }
  const sorted = [...labels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const clampPos = (t: number) => Math.max(minPos, Math.min(maxPos, t))
  const clampOff = (o: { x: number; y: number }) => {
    const m = Math.hypot(o.x, o.y)
    return m > maxOffset ? { x: (o.x / m) * maxOffset, y: (o.y / m) * maxOffset } : o
  }
  const boxOf = (l: LabelInput, p: LabelPlacement): Rect => {
    const a = l.anchorAt(p.labelPos)
    return {
      x: a.x + p.offset.x - l.width / 2,
      y: a.y + p.offset.y - l.height / 2,
      width: l.width,
      height: l.height,
    }
  }
  const boxAtPos = (l: LabelInput, labelPos: number, offset: { x: number; y: number }): Rect =>
    boxOf(l, { labelPos, offset })

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false
    for (const l of sorted) {
      if (l.pinned) continue
      const p = place.get(l.id)!
      const myBox = boxOf(l, p)
      // first overlapping obstacle: node boxes, then any other label
      let hit: Rect | null = null
      for (const nb of nodeBoxes) {
        if (interArea(myBox, nb) > 0) {
          hit = nb
          break
        }
      }
      if (!hit) {
        for (const o of sorted) {
          if (o.id === l.id) continue
          const ob = boxOf(o, place.get(o.id)!)
          if (interArea(myBox, ob) > 0) {
            hit = ob
            break
          }
        }
      }
      if (!hit) continue

      // try sliding: pick the neighbor labelPos that most reduces overlap with hit
      const here = interArea(myBox, hit)
      let bestPos = p.labelPos
      let bestArea = here
      for (const cand of [clampPos(p.labelPos + slideStep), clampPos(p.labelPos - slideStep)]) {
        const area = interArea(boxAtPos(l, cand, p.offset), hit)
        if (area < bestArea - 1e-6) {
          bestArea = area
          bestPos = cand
        }
      }
      if (bestPos !== p.labelPos) {
        p.labelPos = bestPos
        moved = true
      } else {
        // sliding can't help → push perpendicular, away from the hit
        const n = l.normalAt(p.labelPos)
        const mc = { x: myBox.x + myBox.width / 2, y: myBox.y + myBox.height / 2 }
        const hc = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 }
        const sign = (mc.x - hc.x) * n.x + (mc.y - hc.y) * n.y >= 0 ? 1 : -1
        p.offset = clampOff({
          x: p.offset.x + sign * n.x * offStep,
          y: p.offset.y + sign * n.y * offStep,
        })
        moved = true
      }
    }
    if (!moved) break
  }

  const out = new Map<string, LabelPlacement>()
  for (const l of labels) if (!l.pinned) out.set(l.id, place.get(l.id)!)
  return out
}

// Min distance from a point to a polyline (Infinity for a degenerate polyline).
function pointToPolyline(p: Pt, poly: Pt[]): number {
  if (poly.length < 2) return Infinity
  let m = Infinity
  for (let i = 0; i < poly.length - 1; i++) m = Math.min(m, distToSeg(p, poly[i], poly[i + 1]))
  return m
}

// The label anchor fraction (0..1) at the center of the longest run of points where
// `path` is farther than `threshold` from every polyline in `others` — i.e. where
// this edge runs alone. 0.5 when there is no such run (coincident end-to-end) or the
// path is degenerate.
export function soloLabelPos(path: Pt[], others: Pt[][], threshold = 8): number {
  if (path.length < 2) return 0.5
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < path.length; i++) {
    const solo = others.every((o) => pointToPolyline(path[i], o) > threshold)
    if (solo) {
      if (curStart < 0) curStart = i
      curLen++
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  if (bestLen === 0) return 0.5
  return (bestStart + (bestLen - 1) / 2) / (path.length - 1)
}
