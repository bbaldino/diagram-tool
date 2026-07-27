import { describe, it, expect } from 'vitest'
import { authorDiagramOps } from './authoring'
import { applyOps } from '../src/ops'
import { addEntity, normalizeModel, getDiagram } from '../src/model'

const base = () =>
  addEntity(normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] }), {
    id: 'plex',
    label: 'Plex',
    fields: [],
  })

describe('authorDiagramOps', () => {
  it('creates a laid-out diagram with existing + new nodes, an edge, and a note', () => {
    const m = base()
    const { ops, diagramId } = authorDiagramOps(m, {
      name: 'Flow',
      nodes: ['plex', { new: 'Grafana' }],
      edges: [['plex', 'grafana', { label: 'metrics' }]],
      notes: { plex: '4k' },
    })
    const next = applyOps(m, ops)
    const d = getDiagram(next, diagramId)!
    expect(d.placements.map((p) => p.entityId).sort()).toEqual(['grafana', 'plex'])
    expect(next.entities.some((e) => e.id === 'grafana')).toBe(true) // new entity created
    expect(d.edges).toHaveLength(1)
    expect(d.placements.find((p) => p.entityId === 'plex')!.note).toBe('4k')
    const px = d.placements.find((p) => p.entityId === 'plex')!.position.x
    const gx = d.placements.find((p) => p.entityId === 'grafana')!.position.x
    expect(px).toBeLessThan(gx) // laid out (source left of target)
  })

  it('throws on an unknown existing entity id', () => {
    expect(() => authorDiagramOps(base(), { name: 'X', nodes: ['nope'] })).toThrow()
  })

  it('honors an agent-supplied position override', () => {
    const { ops, diagramId } = authorDiagramOps(base(), {
      name: 'X',
      nodes: ['plex'],
      positions: { plex: { x: 999, y: 5 } },
    })
    const d = getDiagram(applyOps(base(), ops), diagramId)!
    expect(d.placements[0].position).toEqual({ x: 999, y: 5 })
  })

  it('throws when an edge references a node id not in nodes', () => {
    expect(() =>
      authorDiagramOps(base(), {
        name: 'X',
        nodes: ['plex'],
        edges: [['plex', 'ghost', {}]],
      })
    ).toThrow(/unknown node id "ghost"/)
  })

  it('throws when a group member references a node id not in nodes', () => {
    expect(() =>
      authorDiagramOps(base(), {
        name: 'X',
        nodes: ['plex'],
        groups: [{ label: 'Media', members: ['plex', 'ghost'] }],
      })
    ).toThrow(/group "Media" references unknown node id "ghost"/)
  })

  it('slugifies a whitespace/symbol-only {new} label to a valid non-empty entity id + placement', () => {
    const { ops, diagramId } = authorDiagramOps(base(), {
      name: 'X',
      nodes: [{ new: '   ' }],
    })
    const next = applyOps(base(), ops)
    const d = getDiagram(next, diagramId)!
    expect(d.placements).toHaveLength(1)
    const id = d.placements[0].entityId
    expect(id.length).toBeGreaterThan(0)
    expect(id).not.toBe('-')
    expect(/[a-z0-9]/.test(id)).toBe(true)
    expect(next.entities.some((e) => e.id === id)).toBe(true)
  })

  it('dedupes duplicate node ids to exactly one placement', () => {
    const { ops, diagramId } = authorDiagramOps(base(), {
      name: 'X',
      nodes: ['plex', 'plex'],
    })
    const d = getDiagram(applyOps(base(), ops), diagramId)!
    expect(d.placements).toHaveLength(1)
    expect(d.placements[0].entityId).toBe('plex')
  })
})
