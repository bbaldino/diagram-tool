import { describe, it, expect } from 'vitest'
import { runGraphviz, runGraphvizFlat } from './layout-graphviz'

const diagram = {
  id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
  placements: [
    { entityId: 'in1', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'in2', position: { x: 0, y: 0 }, parentId: 'g' },
    { entityId: 'out', position: { x: 0, y: 0 } },
  ],
  groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
  edges: [{ id: 'e1', from: 'out', to: 'in1', type: 'talks-to' as const }],
  notes: [],
}
const heights = { in1: 64, in2: 64, out: 64 }
const overlaps = (a: any, b: any) =>
  a.x < b.x + 180 && b.x < a.x + 180 && a.y < b.y + a.h && b.y < a.y + b.h

describe('runGraphviz', () => {
  it('places every node with the group box wrapping its members (top-left, Y-down)', async () => {
    const { nodes, groups } = await runGraphviz(diagram, heights)
    expect(nodes).toHaveLength(3)
    const g = groups.find((x) => x.id === 'g')!
    for (const id of ['in1', 'in2']) {
      const n = nodes.find((x) => x.id === id)!
      expect(n.x).toBeGreaterThanOrEqual(g.x - 1)
      expect(n.y).toBeGreaterThanOrEqual(g.y - 1)
      expect(n.y + 64).toBeLessThanOrEqual(g.y + g.height + 1)
    }
  })

  it('produces no overlapping node boxes', async () => {
    const { nodes } = await runGraphviz(diagram, heights)
    const boxes = nodes.map((n) => ({ x: n.x, y: n.y, h: 64 }))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false)
  })

  it('ignores an edge that targets a group id (no throw)', async () => {
    const bad = { ...diagram, edges: [{ id: 'e2', from: 'out', to: 'g', type: 'talks-to' as const }] }
    await expect(runGraphviz(bad, heights)).resolves.toBeTruthy()
  })
})

describe('runGraphvizFlat', () => {
  it('runGraphvizFlat lays out flat boxes and returns a position per box', async () => {
    const pos = await runGraphvizFlat(
      [
        { id: 'a', width: 180, height: 64 },
        { id: 'b', width: 180, height: 64 },
      ],
      [{ from: 'a', to: 'b' }],
    )
    expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
    expect(pos.b.x).toBeGreaterThan(pos.a.x) // rankdir=LR
  })
})
