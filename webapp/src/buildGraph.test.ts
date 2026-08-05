import { describe, it, expect } from 'vitest'
import { buildDiagramGraph } from './buildGraph'
import { paddedExtent } from './graph'
import type { Diagram, Template } from '../shared/model'

function makeDiagram(over: Partial<Diagram> = {}): Diagram {
  return {
    id: 'd1',
    name: 'diagram',
    title: 'Diagram',
    type: 'canvas',
    nodes: [],
    groups: [],
    notes: [],
    edges: [],
    flows: [],
    ...over,
  }
}

describe('buildDiagramGraph', () => {
  it('builds RF nodes for nodes/groups/notes and edges for edges', () => {
    const diagram = makeDiagram({
      groups: [
        {
          id: 'g1',
          label: 'Group 1',
          color: '#fff',
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 },
        },
      ],
      nodes: [
        { id: 'n1', label: 'Node 1', fields: [], position: { x: 10, y: 10 }, parentId: 'g1' },
        { id: 'n2', label: 'Node 2', fields: [], position: { x: 20, y: 20 } },
      ],
      notes: [
        { id: 'note1', text: 'hello', position: { x: 5, y: 5 }, size: { width: 100, height: 50 } },
      ],
      edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'talks-to' }],
    })

    const { nodes, edges } = buildDiagramGraph(diagram)

    expect(nodes).toHaveLength(4) // 1 group + 2 nodes + 1 note
    const ids = nodes.map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['g1', 'n1', 'n2', 'note1']))

    const g1 = nodes.find((n) => n.id === 'g1')!
    expect(g1.type).toBe('group')

    const n1 = nodes.find((n) => n.id === 'n1')!
    expect(n1.type).toBe('service')
    expect(n1.parentId).toBe('g1')
    // service nodes have no model size, so the child side of the clamp is {0,0}
    expect(n1.extent).toEqual(paddedExtent({ width: 200, height: 100 }, { width: 0, height: 0 }))

    const note1 = nodes.find((n) => n.id === 'note1')!
    expect(note1.type).toBe('note')
    expect((note1.data as any).text).toBe('hello')

    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('e1')
    expect(edges[0].source).toBe('n1')
    expect(edges[0].target).toBe('n2')
  })

  it('shows a field only when showOnNode is true', () => {
    const diagram = makeDiagram({
      nodes: [
        {
          id: 'n1',
          label: 'Node 1',
          fields: [
            { key: 'a', value: '1', showOnNode: true },
            { key: 'b', value: '2', showOnNode: false },
            { key: 'c', value: '3' },
          ],
          position: { x: 0, y: 0 },
        },
      ],
    })
    const { nodes } = buildDiagramGraph(diagram)
    const shown = (nodes[0].data as any).shownFields
    expect(shown).toEqual([{ key: 'a', value: '1' }])
  })

  it('honors the template-tier default for showOnNode, unless the node field opts out', () => {
    const templates: Template[] = [
      {
        id: 't1',
        name: 'Template 1',
        fields: [
          { key: 'ip', showOnNode: true },
          { key: 'port', showOnNode: false },
        ],
      },
    ]
    const inheritedDiagram = makeDiagram({
      nodes: [
        {
          id: 'n1',
          label: 'Node 1',
          template: 't1',
          fields: [{ key: 'ip', value: '10.0.0.1' }],
          position: { x: 0, y: 0 },
        },
      ],
    })
    const { nodes: inheritedNodes } = buildDiagramGraph(inheritedDiagram, templates)
    expect((inheritedNodes[0].data as any).shownFields).toEqual([{ key: 'ip', value: '10.0.0.1' }])

    const overrideDiagram = makeDiagram({
      nodes: [
        {
          id: 'n1',
          label: 'Node 1',
          template: 't1',
          fields: [{ key: 'ip', value: '10.0.0.2', showOnNode: false }],
          position: { x: 0, y: 0 },
        },
      ],
    })
    const { nodes: overrideNodes } = buildDiagramGraph(overrideDiagram, templates)
    expect((overrideNodes[0].data as any).shownFields).toEqual([])

    const hiddenByDefaultDiagram = makeDiagram({
      nodes: [
        {
          id: 'n1',
          label: 'Node 1',
          template: 't1',
          fields: [{ key: 'port', value: '443' }],
          position: { x: 0, y: 0 },
        },
      ],
    })
    const { nodes: hiddenNodes } = buildDiagramGraph(hiddenByDefaultDiagram, templates)
    expect((hiddenNodes[0].data as any).shownFields).toEqual([])
  })

  it('orders nested groups outer-to-inner and sets parentId/extent on the child group', () => {
    const diagram = makeDiagram({
      groups: [
        // deliberately listed inner-before-outer to prove the sort reorders them
        {
          id: 'inner',
          label: 'Inner',
          color: '#000',
          position: { x: 0, y: 0 },
          size: { width: 50, height: 50 },
          parentId: 'outer',
        },
        {
          id: 'outer',
          label: 'Outer',
          color: '#111',
          position: { x: 0, y: 0 },
          size: { width: 200, height: 200 },
        },
      ],
    })
    const { nodes } = buildDiagramGraph(diagram)
    const outerIdx = nodes.findIndex((n) => n.id === 'outer')
    const innerIdx = nodes.findIndex((n) => n.id === 'inner')
    expect(outerIdx).toBeGreaterThanOrEqual(0)
    expect(innerIdx).toBeGreaterThan(outerIdx)

    const inner = nodes.find((n) => n.id === 'inner')!
    expect(inner.parentId).toBe('outer')
    expect(inner.extent).toEqual(
      paddedExtent({ width: 200, height: 200 }, { width: 50, height: 50 }),
    )
  })
})

describe('scheme passthrough', () => {
  it('carries a note scheme onto the canvas node data', () => {
    const d = {
      id: 'd',
      name: 'D',
      title: 'D',
      type: 'canvas' as const,
      nodes: [],
      groups: [],
      edges: [],
      flows: [],
      notes: [
        {
          id: 'n1',
          text: 'x',
          scheme: '#3b82f6',
          position: { x: 0, y: 0 },
          size: { width: 160, height: 90 },
        },
        { id: 'n2', text: 'y', position: { x: 0, y: 0 }, size: { width: 160, height: 90 } },
      ],
    }
    const g = buildDiagramGraph(d as never, [])
    expect((g.nodes.find((n) => n.id === 'n1')!.data as never as { scheme?: string }).scheme).toBe(
      '#3b82f6',
    )
    expect(
      (g.nodes.find((n) => n.id === 'n2')!.data as never as { scheme?: string }).scheme,
    ).toBeUndefined()
  })

  it('carries a service node scheme onto the canvas node data', () => {
    const d = {
      id: 'd',
      name: 'D',
      title: 'D',
      type: 'canvas' as const,
      groups: [],
      notes: [],
      edges: [],
      flows: [],
      nodes: [
        { id: 's1', label: 'Plex', fields: [], scheme: '#10b981', position: { x: 0, y: 0 } },
        { id: 's2', label: 'Sonarr', fields: [], position: { x: 0, y: 0 } },
      ],
    }
    const g = buildDiagramGraph(d as never, [])
    expect((g.nodes.find((n) => n.id === 's1')!.data as never as { scheme?: string }).scheme).toBe(
      '#10b981',
    )
    expect(
      (g.nodes.find((n) => n.id === 's2')!.data as never as { scheme?: string }).scheme,
    ).toBeUndefined()
  })
})
