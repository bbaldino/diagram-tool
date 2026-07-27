import { describe, it, expect } from 'vitest'
import { runElk } from './layout-elk'

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

describe('runElk', () => {
  it('places every node and wraps grouped members in the group box', async () => {
    const { nodes, groups } = await runElk(diagram, heights)
    expect(nodes).toHaveLength(3)
    const g = groups.find((x) => x.id === 'g')!
    for (const id of ['in1', 'in2']) {
      const n = nodes.find((x) => x.id === id)!
      expect(n.x).toBeGreaterThanOrEqual(g.x)
      expect(n.y).toBeGreaterThanOrEqual(g.y)
      expect(n.x + 180).toBeLessThanOrEqual(g.x + g.width + 1)
    }
  })

  it('produces no overlapping node boxes', async () => {
    const { nodes } = await runElk(diagram, heights)
    const boxes = nodes.map((n) => ({ x: n.x, y: n.y, h: heights[n.id as keyof typeof heights] }))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false)
  })

  it('ignores an edge that targets a group id instead of a node (no throw)', async () => {
    const bad = { ...diagram, edges: [{ id: 'e2', from: 'out', to: 'g', type: 'talks-to' as const }] }
    await expect(runElk(bad, heights)).resolves.toBeTruthy()
  })
})
