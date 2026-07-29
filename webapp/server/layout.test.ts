import { describe, it, expect } from 'vitest'
import { layoutDiagram, handlesFor, absoluteCenter, assignEdgeHandles } from './layout'
import type { Diagram, Group } from '../src/model'
import { reflowContainment } from '../src/containment'

describe('layoutDiagram dispatcher', () => {
  const diagram = {
    id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
    nodes: [
      { id: 'in', label: 'In', fields: [], position: { x: 0, y: 0 }, parentId: 'g' },
      { id: 'out', label: 'Out', fields: [{ key: 'host', value: 'x', showOnNode: true }], position: { x: 0, y: 0 } },
    ],
    groups: [{ id: 'g', label: 'G', color: '#111', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
    edges: [{ id: 'e1', from: 'out', to: 'in', type: 'talks-to' as const }],
    notes: [],
    flows: [],
  }

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) returns child positions relative to the group and preserves node fields`, async () => {
      const { nodes, groups } = await layoutDiagram(diagram, engine)
      const inner = nodes.find((n) => n.id === 'in')!
      const g = groups.find((x) => x.id === 'g')!
      // child position is parent-relative → non-negative-ish within the box, and
      // adding the group origin lands inside the group's absolute bounds
      expect(inner.parentId).toBe('g')
      expect(g.position).toBeTruthy()
      expect(nodes.find((n) => n.id === 'out')!.fields).toEqual([{ key: 'host', value: 'x', showOnNode: true }]) // preserved
    })

    it(`(${engine}) bakes edge handles`, async () => {
      const { edges } = await layoutDiagram(diagram, engine)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].sourceHandle)
      expect(['left', 'right', 'top', 'bottom']).toContain(edges[0].targetHandle)
    })
  }

  it('defaults to elk when no engine is given', async () => {
    const { nodes } = await layoutDiagram(diagram)
    expect(nodes).toHaveLength(2)
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
      nodes: [
        { id: 'a', label: 'A', fields: [], position: { x: 0, y: 0 } },
        { id: 'b', label: 'B', fields: [], position: { x: 0, y: 0 } },
      ],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }],
      notes: [],
      flows: [],
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
      nodes: [{ id: 'a', label: 'A', fields: [], position: { x: 0, y: 0 } }],
      groups: [],
      edges: [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }],
      notes: [],
      flows: [],
    }
    const { edges } = await layoutDiagram(diagram)
    expect(edges[0].sourceHandle).toBe('top') // untouched
  })

  it('absoluteCenter: ungrouped node center = position + half node size (W=180, given height)', () => {
    const center = absoluteCenter({ position: { x: 10, y: 20 } }, {}, 64)
    // W/2 = 90, height/2 = 32
    expect(center).toEqual({ x: 100, y: 52 })
  })

  it('absoluteCenter: grouped node center adds the parent group\'s absolute position back onto the parent-relative placement', () => {
    // Group origin is clearly non-zero so the add-back is actually exercised
    // (a bug that drops `x += group.position.x; y += group.position.y` would
    // leave the result at the ungrouped value below instead).
    const group: Group = { id: 'g', label: 'G', color: '#000', position: { x: 500, y: 300 }, size: { width: 0, height: 0 } }
    const child = { position: { x: 10, y: 20 }, parentId: 'g' }
    const withoutParent = absoluteCenter({ position: { x: 10, y: 20 } }, {}, 64)

    const center = absoluteCenter(child, { g: group }, 64)

    // Exact coordinates: group.position + node.position + (W/2, h/2).
    expect(center).toEqual({ x: 500 + 10 + 90, y: 300 + 20 + 32 })
    // Equivalently: differs from the no-parent case by exactly the group's
    // position — this is what removing the `+=` lines would break.
    expect(center).toEqual({ x: withoutParent.x + group.position.x, y: withoutParent.y + group.position.y })
  })

  it('absoluteCenter: node in a nested group adds every ancestor group offset', () => {
    const groupById: Record<string, Group> = {
      outer: { id: 'outer', label: 'O', color: '#000', position: { x: 100, y: 200 }, size: { width: 400, height: 300 } },
      inner: { id: 'inner', label: 'I', color: '#000', position: { x: 20, y: 30 }, size: { width: 200, height: 150 }, parentId: 'outer' },
    }
    // node at (5,5) relative to inner; inner at (20,30) relative to outer; outer at (100,200) absolute.
    // center = (100+20+5 + W/2, 200+30+5 + h/2) with W=180, h=64 → (125+90, 235+32) = (215, 267)
    const c = absoluteCenter({ position: { x: 5, y: 5 }, parentId: 'inner' }, groupById, 64)
    expect(c).toEqual({ x: 215, y: 267 })
  })
})

describe('assignEdgeHandles', () => {
  it('bakes geometry handles for an ungrouped forward edge', () => {
    const nodes = [
      { id: 'a', label: 'A', fields: [], position: { x: 0, y: 0 } },
      { id: 'b', label: 'B', fields: [], position: { x: 400, y: 0 } },
    ]
    const edges = [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }]
    const out = assignEdgeHandles(nodes, [], edges, { a: 64, b: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('uses the group offset for a child node (grouped left of an outside node → right/left)', () => {
    const nodes = [
      { id: 'inner', label: 'Inner', fields: [], position: { x: 10, y: 10 }, parentId: 'g' },
      { id: 'outer', label: 'Outer', fields: [], position: { x: 900, y: 0 } },
    ]
    const groups = [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 260, height: 160 } }]
    const edges = [{ id: 'e1', from: 'inner', to: 'outer', type: 'talks-to' as const }]
    const out = assignEdgeHandles(nodes, groups, edges, { inner: 64, outer: 64 })
    expect(out[0].sourceHandle).toBe('right')
    expect(out[0].targetHandle).toBe('left')
  })

  it('leaves handles unchanged for a missing endpoint', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'ghost', type: 'talks-to' as const, sourceHandle: 'top' as const }]
    const out = assignEdgeHandles([{ id: 'a', label: 'A', fields: [], position: { x: 0, y: 0 } }], [], edges, { a: 64 })
    expect(out[0].sourceHandle).toBe('top')
  })
})

describe('layoutDiagram (nested + notes)', () => {
  // Root → B{ b1, C{ c1 } }, plus a note inside C, laid out for each engine.
  const nested = (): Diagram => ({
    id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
    groups: [
      { id: 'B', label: 'B', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 } },
      { id: 'C', label: 'C', color: '#000', position: { x: 0, y: 0 }, size: { width: 220, height: 130 }, parentId: 'B' },
    ],
    nodes: [
      { id: 'b1', label: 'b1', fields: [], position: { x: 0, y: 0 }, parentId: 'B' },
      { id: 'c1', label: 'c1', fields: [], position: { x: 0, y: 0 }, parentId: 'C' },
    ],
    notes: [{ id: 'n1', text: 'note', position: { x: 0, y: 0 }, size: { width: 160, height: 90 }, parentId: 'C' }],
    edges: [{ id: 'e', from: 'b1', to: 'c1', type: 'talks-to' as const }],
    flows: [],
  })

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) keeps the inner group nested under the outer group`, async () => {
      const { groups } = await layoutDiagram(nested(), engine)
      expect(groups.find((g) => g.id === 'C')!.parentId).toBe('B') // not un-nested
    })

    it(`(${engine}) keeps the grouped note as a child of its group`, async () => {
      const { notes } = await layoutDiagram(nested(), engine)
      expect(notes.find((n) => n.id === 'n1')!.parentId).toBe('C')
    })

    it(`(${engine}) sizes C to actually contain its child c1 and note (reflow-valid)`, async () => {
      const laid = await layoutDiagram(nested(), engine)
      // reflowContainment is grow-only; if C already contains its kids, applying
      // it again changes nothing → proof the returned sizes satisfy containment.
      const again = reflowContainment({ ...nested(), nodes: laid.nodes, groups: laid.groups, notes: laid.notes })
      const cBefore = laid.groups.find((g) => g.id === 'C')!
      const cAfter = again.groups.find((g) => g.id === 'C')!
      expect(cAfter.size).toEqual(cBefore.size)
      // and C is at least big enough for the note's footprint
      expect(cBefore.size.width).toBeGreaterThanOrEqual(160)
    })

    it(`(${engine}) returns child positions parent-relative (non-negative within padding)`, async () => {
      const { nodes } = await layoutDiagram(nested(), engine)
      const c1 = nodes.find((n) => n.id === 'c1')!
      expect(c1.position.x).toBeGreaterThanOrEqual(0)
      expect(c1.position.y).toBeGreaterThanOrEqual(0)
    })
  }

  it('leaves a top-level note untouched', async () => {
    const d = nested()
    d.notes.push({ id: 'top', text: 'floating', position: { x: 777, y: 555 }, size: { width: 160, height: 90 } })
    const { notes } = await layoutDiagram(d, 'elk')
    expect(notes.find((n) => n.id === 'top')!.position).toEqual({ x: 777, y: 555 })
  })
})
