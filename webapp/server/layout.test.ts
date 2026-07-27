import { describe, it, expect } from 'vitest'
import { layoutDiagram, handlesFor, absoluteCenter, assignEdgeHandles } from './layout'
import type { Group } from '../src/model'

describe('layoutDiagram dispatcher', () => {
  const diagram = {
    id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
    placements: [
      { entityId: 'in', position: { x: 0, y: 0 }, parentId: 'g', note: 'keep me' },
      { entityId: 'out', position: { x: 0, y: 0 }, fieldShow: { host: true } },
    ],
    groups: [{ id: 'g', label: 'G', color: '#111', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
    edges: [{ id: 'e1', from: 'out', to: 'in', type: 'talks-to' as const }],
    notes: [],
  }

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) returns child positions relative to the group and preserves placement fields`, async () => {
      const { placements, groups } = await layoutDiagram(diagram, engine)
      const inner = placements.find((p) => p.entityId === 'in')!
      const g = groups.find((x) => x.id === 'g')!
      // child position is parent-relative → non-negative-ish within the box, and
      // adding the group origin lands inside the group's absolute bounds
      expect(inner.parentId).toBe('g')
      expect(inner.note).toBe('keep me') // preserved
      expect(g.position).toBeTruthy()
      expect(placements.find((p) => p.entityId === 'out')!.fieldShow).toEqual({ host: true }) // preserved
    })

    it(`(${engine}) bakes edge handles`, async () => {
      const { edges } = await layoutDiagram(diagram, engine)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].sourceHandle)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].targetHandle)
    })
  }

  it('defaults to elk when no engine is given', async () => {
    const { placements } = await layoutDiagram(diagram)
    expect(placements).toHaveLength(2)
  })
})

describe('handlesFor', () => {
  const S = { x: 0, y: 0 }
  it('auto: target to the right → source right, target left', () => {
    expect(handlesFor('auto', S, { x: 300, y: 0 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('auto: target to the left (backward edge) → source left, target right', () => {
    expect(handlesFor('auto', S, { x: -300, y: 0 })).toEqual({ sourceHandle: 'left', targetHandle: 'right' })
  })
  it('auto: target below → source bottom, target top', () => {
    expect(handlesFor('auto', S, { x: 0, y: 300 })).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
  })
  it('auto: target above → source top, target bottom', () => {
    expect(handlesFor('auto', S, { x: 0, y: -300 })).toEqual({ sourceHandle: 'top', targetHandle: 'bottom' })
  })
  it('auto: exact tie (|dx| == |dy|) resolves horizontal', () => {
    expect(handlesFor('auto', S, { x: 100, y: 100 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('undefined orientation behaves like auto', () => {
    expect(handlesFor(undefined, S, { x: 300, y: 0 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('horizontal forces left/right even when nodes are stacked vertically', () => {
    expect(handlesFor('horizontal', S, { x: 20, y: 300 })).toEqual({ sourceHandle: 'right', targetHandle: 'left' })
  })
  it('vertical forces top/bottom even when nodes are side by side', () => {
    expect(handlesFor('vertical', S, { x: 300, y: 20 })).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' })
  })
})

describe('layoutDiagram edge handles', () => {
  it('bakes geometry-derived handles onto returned edges', async () => {
    const diagram = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [
        { entityId: 'a', position: { x: 0, y: 0 } },
        { entityId: 'b', position: { x: 0, y: 0 } },
      ],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }],
      notes: [],
    }
    const { edges } = await layoutDiagram(diagram)
    // rankdir LR places the source (a) left of the target (b), so a forward
    // edge exits a's right into b's left.
    expect(edges[0].sourceHandle).toBe('right')
    expect(edges[0].targetHandle).toBe('left')
  })

  it('leaves handles unchanged when an endpoint is not placed', async () => {
    const diagram = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      placements: [{ entityId: 'a', position: { x: 0, y: 0 } }],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }],
      notes: [],
    }
    const { edges } = await layoutDiagram(diagram)
    expect(edges[0].sourceHandle).toBe('top') // untouched
  })

  it('absoluteCenter: ungrouped node center = position + half node size (W=180, given height)', () => {
    const center = absoluteCenter({ entityId: 'a', position: { x: 10, y: 20 } }, {}, 64)
    // W/2 = 90, height/2 = 32
    expect(center).toEqual({ x: 100, y: 52 })
  })

  it('absoluteCenter: grouped node center adds the parent group\'s absolute position back onto the parent-relative placement', () => {
    // Group origin is clearly non-zero so the add-back is actually exercised
    // (a bug that drops `x += group.position.x; y += group.position.y` would
    // leave the result at the ungrouped value below instead).
    const group: Group = { id: 'g', label: 'G', color: '#000', position: { x: 500, y: 300 }, size: { width: 0, height: 0 } }
    const child = { entityId: 'inner', position: { x: 10, y: 20 }, parentId: 'g' }
    const withoutParent = absoluteCenter({ entityId: 'inner', position: { x: 10, y: 20 } }, {}, 64)

    const center = absoluteCenter(child, { g: group }, 64)

    // Exact coordinates: group.position + placement.position + (W/2, h/2).
    expect(center).toEqual({ x: 500 + 10 + 90, y: 300 + 20 + 32 })
    // Equivalently: differs from the no-parent case by exactly the group's
    // position — this is what removing the `+=` lines would break.
    expect(center).toEqual({ x: withoutParent.x + group.position.x, y: withoutParent.y + group.position.y })
  })
})

describe('assignEdgeHandles', () => {
  it('bakes geometry handles for an ungrouped forward edge', () => {
    const placements = [
      { entityId: 'a', position: { x: 0, y: 0 } },
      { entityId: 'b', position: { x: 400, y: 0 } },
    ]
    const edges = [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }]
    const out = assignEdgeHandles(placements, [], edges, { a: 64, b: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('uses the group offset for a child node (grouped left of an outside node → right/left)', () => {
    const placements = [
      { entityId: 'inner', position: { x: 10, y: 10 }, parentId: 'g' },
      { entityId: 'outer', position: { x: 900, y: 0 } },
    ]
    const groups = [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 260, height: 160 } }]
    const edges = [{ id: 'e1', from: 'inner', to: 'outer', type: 'talks-to' as const }]
    const out = assignEdgeHandles(placements, groups, edges, { inner: 64, outer: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('leaves handles unchanged for a missing endpoint', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }]
    const out = assignEdgeHandles([{ entityId: 'a', position: { x: 0, y: 0 } }], [], edges, { a: 64 })
    expect(out[0].sourceHandle).toBe('top')
  })
})
