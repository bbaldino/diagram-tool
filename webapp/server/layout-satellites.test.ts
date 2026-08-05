import { describe, it, expect } from 'vitest'
import { findSatellites, nodeHeight, SATELLITE_GAP } from './layout'
import { layoutDiagram } from './layout'
import type { Diagram, Edge, Node } from '../shared/model'

const node = (id: string, label = id): Node => ({
  id,
  label,
  fields: [],
  position: { x: 0, y: 0 },
})

const edge = (id: string, from: string, to: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  from,
  to,
  ...extra,
})

const diagram = (nodes: Node[], edges: Edge[]): Diagram => ({
  id: 'd',
  name: 'D',
  title: 'D',
  type: 'call-flow',
  nodes,
  groups: [],
  edges,
  notes: [],
  flows: [],
})

describe('nodeHeight', () => {
  it('uses a measured height when one is supplied for that node', () => {
    expect(nodeHeight(node('a'), { a: { height: 40 } })).toBe(40)
  })

  it('falls back to the default box height when the node has no measurement', () => {
    expect(nodeHeight(node('a'), { b: { height: 40 } })).toBe(64)
  })

  it('falls back to the default box height when no measurements are supplied at all', () => {
    expect(nodeHeight(node('a'), undefined)).toBe(64)
  })

  it('ignores a non-positive measured height rather than collapsing the box', () => {
    expect(nodeHeight(node('a'), { a: { height: 0 } })).toBe(64)
  })
})

describe('findSatellites', () => {
  it('treats a leaf joined by a single vertical edge as a satellite of its subject', () => {
    const nodes = [node('subject'), node('annotation')]
    const edges = [
      edge('e1', 'subject', 'annotation', {
        orientation: 'vertical',
        sourceHandle: 'top',
        targetHandle: 'bottom',
      }),
    ]
    const sats = findSatellites(nodes, edges)
    expect(sats.get('annotation')).toEqual({ subjectId: 'subject', side: 'above' })
  })

  it('reads the side from the stored handles: a bottom-anchored edge hangs the satellite below', () => {
    const nodes = [node('subject'), node('annotation')]
    const edges = [
      edge('e1', 'subject', 'annotation', {
        orientation: 'vertical',
        sourceHandle: 'bottom',
        targetHandle: 'top',
      }),
    ]
    expect(findSatellites(nodes, edges).get('annotation')).toEqual({
      subjectId: 'subject',
      side: 'below',
    })
  })

  it('does not claim a node that also participates in the flow', () => {
    const nodes = [node('subject'), node('annotation'), node('next')]
    const edges = [
      edge('e1', 'subject', 'annotation', { orientation: 'vertical', sourceHandle: 'top' }),
      edge('e2', 'annotation', 'next'),
    ]
    expect(findSatellites(nodes, edges).has('annotation')).toBe(false)
  })

  it('does not claim a node joined by a horizontal edge', () => {
    const nodes = [node('subject'), node('other')]
    const edges = [edge('e1', 'subject', 'other', { orientation: 'horizontal' })]
    expect(findSatellites(nodes, edges).has('other')).toBe(false)
  })

  it('does not claim a subject that has satellites of its own', () => {
    // a -> b (vertical), b -> c (vertical): b is not a leaf, so neither is a satellite pair
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [
      edge('e1', 'a', 'b', { orientation: 'vertical', sourceHandle: 'top' }),
      edge('e2', 'b', 'c', { orientation: 'vertical', sourceHandle: 'top' }),
    ]
    const sats = findSatellites(nodes, edges)
    expect(sats.has('b')).toBe(false)
    expect(sats.get('c')).toEqual({ subjectId: 'b', side: 'above' })
  })
})

describe('layoutDiagram places satellites against their subject', () => {
  const withSatellite = (side: 'above' | 'below') =>
    diagram(
      [node('start'), node('subject'), node('end'), node('annotation')],
      [
        edge('f1', 'start', 'subject'),
        edge('f2', 'subject', 'end'),
        edge('a1', 'subject', 'annotation', {
          orientation: 'vertical',
          sourceHandle: side === 'above' ? 'top' : 'bottom',
          targetHandle: side === 'above' ? 'bottom' : 'top',
        }),
      ],
    )

  for (const engine of ['elk', 'graphviz'] as const) {
    it(`(${engine}) puts the satellite in the same column as its subject, not a rank to the side`, async () => {
      const { nodes } = await layoutDiagram(withSatellite('above'), engine)
      const subject = nodes.find((n) => n.id === 'subject')!
      const annotation = nodes.find((n) => n.id === 'annotation')!
      expect(annotation.position.x - subject.position.x).toBe(0)
    })

    it(`(${engine}) stacks an above-satellite directly over its subject`, async () => {
      const { nodes } = await layoutDiagram(withSatellite('above'), engine)
      const subject = nodes.find((n) => n.id === 'subject')!
      const annotation = nodes.find((n) => n.id === 'annotation')!
      expect(subject.position.y - annotation.position.y).toBe(64 + SATELLITE_GAP)
    })

    it(`(${engine}) hangs a below-satellite directly under its subject`, async () => {
      const { nodes } = await layoutDiagram(withSatellite('below'), engine)
      const subject = nodes.find((n) => n.id === 'subject')!
      const annotation = nodes.find((n) => n.id === 'annotation')!
      expect(annotation.position.y - subject.position.y).toBe(64 + SATELLITE_GAP)
    })

    it(`(${engine}) keeps the satellite from overlapping a node sharing its rank`, async () => {
      // `other` is a second target of `start`, so it shares the subject's rank.
      const d = withSatellite('above')
      d.nodes.push(node('other'))
      d.edges.push(edge('f3', 'start', 'other'))
      const { nodes } = await layoutDiagram(d, engine)
      const boxes = nodes.map((n) => ({
        id: n.id,
        top: n.position.y,
        bottom: n.position.y + 64,
        x: n.position.x,
      }))
      const sameColumn = (a: (typeof boxes)[0], b: (typeof boxes)[0]) => a.x === b.x
      for (const a of boxes) {
        for (const b of boxes) {
          if (a.id >= b.id || !sameColumn(a, b)) continue
          const overlaps = a.top < b.bottom && b.top < a.bottom
          expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false)
        }
      }
    })
  }
})

describe('layoutDiagram uses measured heights', () => {
  it('(graphviz) spaces same-rank nodes by their real height, not the default box', async () => {
    const d = diagram(
      [node('src'), node('a'), node('b')],
      [edge('e1', 'src', 'a'), edge('e2', 'src', 'b')],
    )
    const withDefaults = await layoutDiagram(d, 'graphviz')
    const withMeasured = await layoutDiagram(d, 'graphviz', {
      src: { height: 40 },
      a: { height: 40 },
      b: { height: 40 },
    })
    const gapOf = (nodes: Node[]) => {
      const ys = [nodes.find((n) => n.id === 'a')!, nodes.find((n) => n.id === 'b')!]
        .map((n) => n.position.y)
        .sort((x, y) => x - y)
      return ys[1] - ys[0]
    }
    // graphviz nodesep=0.5in = 36px, so the gap is height + 36.
    expect(gapOf(withDefaults.nodes)).toBe(64 + 36)
    expect(gapOf(withMeasured.nodes)).toBe(40 + 36)
  })
})
