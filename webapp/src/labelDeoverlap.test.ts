import { describe, expect, it } from 'vitest'
import { resolveLabelPlacements, type LabelInput, type Rect } from './labelDeoverlap'

// A label riding a horizontal line y=c: anchor moves in x with t, normal is vertical.
function hLine(id: string, c: number, pinned = false, seedPos = 0.5): LabelInput {
  return {
    id,
    width: 60,
    height: 18,
    pinned,
    placement: { labelPos: seedPos, offset: { x: 0, y: 0 } },
    anchorAt: (t) => ({ x: t * 200, y: c }),
    normalAt: () => ({ x: 0, y: 1 }),
  }
}
function boxAt(l: LabelInput, p: { labelPos: number; offset: { x: number; y: number } }): Rect {
  const a = l.anchorAt(p.labelPos)
  return {
    x: a.x + p.offset.x - l.width / 2,
    y: a.y + p.offset.y - l.height / 2,
    width: l.width,
    height: l.height,
  }
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

describe('resolveLabelPlacements', () => {
  it('separates two labels stacked on the same line by sliding them apart', () => {
    const a = hLine('a', 0)
    const b = hLine('b', 0)
    const out = resolveLabelPlacements([a, b])
    const ra = boxAt(a, out.get('a')!)
    const rb = boxAt(b, out.get('b')!)
    expect(overlaps(ra, rb)).toBe(false)
  })

  it('never moves a pinned label; the unpinned one moves around it', () => {
    const pinned = hLine('p', 0, true)
    const free = hLine('f', 0)
    const out = resolveLabelPlacements([pinned, free])
    expect(out.has('p')).toBe(false) // pinned not returned
    const rf = boxAt(free, out.get('f')!)
    const rp = boxAt(pinned, pinned.placement)
    expect(overlaps(rf, rp)).toBe(false)
  })

  it('uses a perpendicular offset when the lines are coincident (sliding cannot separate)', () => {
    // both anchors are the SAME fixed point regardless of t → sliding does nothing
    const mk = (id: string, pinned = false): LabelInput => ({
      id,
      width: 60,
      height: 18,
      pinned,
      placement: { labelPos: 0.5, offset: { x: 0, y: 0 } },
      anchorAt: () => ({ x: 100, y: 0 }),
      normalAt: () => ({ x: 0, y: 1 }),
    })
    const a = mk('a'),
      b = mk('b')
    const out = resolveLabelPlacements([a, b])
    // at least one got a non-zero vertical offset, and they no longer overlap
    const oa = out.get('a')!,
      ob = out.get('b')!
    expect(Math.abs(oa.offset.y) + Math.abs(ob.offset.y)).toBeGreaterThan(0)
    expect(overlaps(boxAt(a, oa), boxAt(b, ob))).toBe(false)
  })

  it('keeps labelPos within [minPos,maxPos] and |offset| within maxOffset', () => {
    const a = hLine('a', 0),
      b = hLine('b', 0)
    const out = resolveLabelPlacements([a, b], [], { minPos: 0.3, maxPos: 0.7, maxOffset: 10 })
    for (const p of out.values()) {
      expect(p.labelPos).toBeGreaterThanOrEqual(0.3)
      expect(p.labelPos).toBeLessThanOrEqual(0.7)
      expect(Math.hypot(p.offset.x, p.offset.y)).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it('pushes a label out of an overlapping node box', () => {
    const a = hLine('a', 0)
    const node: Rect = { x: 100 - 30, y: -9, width: 60, height: 18 } // centered on a at t=0.5
    const out = resolveLabelPlacements([a], [node])
    expect(overlaps(boxAt(a, out.get('a')!), node)).toBe(false)
  })
})

import { soloLabelPos } from './labelDeoverlap'

// horizontal polyline y=0 from x=x0 to x=x1, sampled at n points
function hSeg(x0: number, x1: number, n = 21): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: 0 }))
}

describe('soloLabelPos', () => {
  it('returns 0.5 for an edge with no other edges', () => {
    expect(soloLabelPos(hSeg(0, 100), [])).toBeCloseTo(0.5, 5)
  })

  it('anchors in the LEFT region when the edge is coincident on its right half', () => {
    // path spans x 0..100; other overlaps x 40..140 → path is solo only on the left
    const pos = soloLabelPos(hSeg(0, 100), [hSeg(40, 140)])
    expect(pos).toBeLessThan(0.4)
  })

  it('anchors in the RIGHT region when the edge is coincident on its left half', () => {
    const pos = soloLabelPos(hSeg(0, 100), [hSeg(-40, 60)])
    expect(pos).toBeGreaterThan(0.6)
  })

  it('falls back to 0.5 when fully coincident with another edge', () => {
    expect(soloLabelPos(hSeg(0, 100), [hSeg(0, 100)])).toBeCloseTo(0.5, 5)
  })

  it('respects the threshold (a parallel edge just beyond it leaves this edge solo)', () => {
    // other is a parallel line 12px away everywhere; threshold 8 → path is solo throughout → 0.5
    const other = hSeg(0, 100).map((p) => ({ x: p.x, y: p.y + 12 }))
    expect(soloLabelPos(hSeg(0, 100), [other], 8)).toBeCloseTo(0.5, 5)
  })
})
