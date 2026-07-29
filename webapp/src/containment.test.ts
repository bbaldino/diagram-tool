import { describe, it, expect } from 'vitest'
import { reflowContainment, GROUP_MIN } from './containment'
import type { Diagram } from './model'

const diagram = (over: Partial<Diagram> = {}): Diagram => ({
  id: 'd', name: 'D', title: 'D', type: 'canvas', nodes: [], groups: [], notes: [], edges: [], flows: [], ...over,
})

describe('reflowContainment', () => {
  it('grows a parent group to contain a reparented child group with padding (no overlap, movable)', () => {
    const d = diagram({
      groups: [
        { id: 'outer', label: 'Outer', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
        { id: 'inner', label: 'Inner', color: '#000', position: { x: 16, y: 32 }, size: { width: 320, height: 200 }, parentId: 'outer' },
      ],
    })
    const out = reflowContainment(d)
    const outer = out.groups.find((g) => g.id === 'outer')!
    // outer grew to contain inner (16 + 320 + pad) x (32 + 200 + pad), plus slack, and is strictly bigger than inner
    expect(outer.size.width).toBeGreaterThan(320 + 16)
    expect(outer.size.height).toBeGreaterThan(200 + 16)
  })

  it('sizes inner groups before outer (inner-first cascade)', () => {
    const d = diagram({
      groups: [
        { id: 'a', label: 'A', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 }, parentId: 'b' },
        { id: 'b', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
        { id: 'c', label: 'C', color: '#000', position: { x: 16, y: 32 }, size: { width: 400, height: 260 }, parentId: 'a' },
      ],
    })
    const out = reflowContainment(d)
    const a = out.groups.find((g) => g.id === 'a')!
    const b = out.groups.find((g) => g.id === 'b')!
    expect(a.size.width).toBeGreaterThanOrEqual(400 + 16)     // a grew to hold c
    expect(b.size.width).toBeGreaterThanOrEqual(a.size.width) // b grew to hold the grown a
  })

  it('leaves a diagram with no containment unchanged (idempotent on flat content)', () => {
    const d = diagram({ groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }] })
    const out = reflowContainment(d)
    expect(out.groups[0].size).toEqual({ width: 300, height: 200 })
  })
})
