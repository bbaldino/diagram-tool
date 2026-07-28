import { describe, it, expect } from 'vitest'
import { authorDiagramOps } from './authoring'
import { applyOps } from '../src/ops'
import { normalizeModel, getDiagram } from '../src/model'

const base = () => normalizeModel({ version: 2, diagrams: [], templates: [] })

describe('authorDiagramOps', () => {
  it('creates a laid-out diagram with nodes and an edge, returning the minted node uuids', async () => {
    const m = base()
    const { ops, diagramId, nodeIds } = await authorDiagramOps(m, {
      name: 'Flow',
      nodes: ['Plex', { label: 'Grafana' }],
      edges: [['plex', 'grafana', { label: 'metrics' }]],
    })
    expect(nodeIds).toHaveLength(2)
    expect(nodeIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    const next = applyOps(m, ops)
    const d = getDiagram(next, diagramId)!
    expect(d.nodes.map((n) => n.label).sort()).toEqual(['Grafana', 'Plex'])
    expect(d.nodes.map((n) => n.id).sort()).toEqual([...nodeIds].sort())
    expect(d.edges).toHaveLength(1)
    const [plexId, grafanaId] = nodeIds
    expect(d.edges[0]).toMatchObject({ from: plexId, to: grafanaId, label: 'metrics' })
    const px = d.nodes.find((n) => n.id === plexId)!.position.x
    const gx = d.nodes.find((n) => n.id === grafanaId)!.position.x
    expect(px).toBeLessThan(gx) // laid out (source left of target)
  })

  it('throws when an edge references a node ref not in nodes', async () => {
    await expect(
      authorDiagramOps(base(), {
        name: 'X',
        nodes: ['Plex'],
        edges: [['plex', 'ghost', {}]],
      })
    ).rejects.toThrow(/unknown node ref "ghost"/)
  })

  it('throws when a group member references a node ref not in nodes', async () => {
    await expect(
      authorDiagramOps(base(), {
        name: 'X',
        nodes: ['Plex'],
        groups: [{ label: 'Media', members: ['plex', 'ghost'] }],
      })
    ).rejects.toThrow(/group "Media" references unknown node ref "ghost"/)
  })

  it('honors an agent-supplied position override (keyed by the label-derived ref)', async () => {
    const { ops, diagramId } = await authorDiagramOps(base(), {
      name: 'X',
      nodes: ['Plex'],
      positions: { plex: { x: 999, y: 5 } },
    })
    const d = getDiagram(applyOps(base(), ops), diagramId)!
    expect(d.nodes[0].position).toEqual({ x: 999, y: 5 })
  })

  it('slugifies a whitespace/symbol-only label to a valid non-empty ref', async () => {
    const { ops, diagramId, nodeIds } = await authorDiagramOps(base(), {
      name: 'X',
      nodes: [{ label: '   ' }],
    })
    const next = applyOps(base(), ops)
    const d = getDiagram(next, diagramId)!
    expect(d.nodes).toHaveLength(1)
    expect(d.nodes[0].id).toBe(nodeIds[0])
  })

  it('mints a distinct node for each entry, even with a duplicate label', async () => {
    const { ops, diagramId, nodeIds } = await authorDiagramOps(base(), {
      name: 'X',
      nodes: ['Plex', 'Plex'],
    })
    expect(nodeIds).toHaveLength(2)
    expect(nodeIds[0]).not.toBe(nodeIds[1])
    const d = getDiagram(applyOps(base(), ops), diagramId)!
    expect(d.nodes).toHaveLength(2)
    expect(d.nodes.every((n) => n.label === 'Plex')).toBe(true)
  })

  it('bakes geometry-derived handles onto authored edges', async () => {
    const { ops, diagramId } = await authorDiagramOps(base(), {
      name: 'Flow',
      nodes: ['Plex', { label: 'Grafana' }],
      edges: [['plex', 'grafana']],
    })
    const model = applyOps(base(), ops)
    const edge = getDiagram(model, diagramId)!.edges[0]
    // default engine (elk, direction RIGHT): plex is left of grafana → forward
    // edge exits plex's right into grafana's left.
    expect(edge.sourceHandle).toBe('right')
    expect(edge.targetHandle).toBe('left')
  })
})
