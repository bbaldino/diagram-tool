import { describe, it, expect } from 'vitest'
import { buildDiagramGraph, entitiesById, migrateFromGraph, updateEntity, deleteEntity, removePlacement, addDiagram, deleteDiagram, type Model } from './model'

const model: Model = {
  version: 1,
  entities: [
    { id: 'plex', label: 'Plex' },
    { id: 'sonarr', label: 'Sonarr' },
  ],
  diagrams: [],
}

describe('entitiesById', () => {
  it('indexes entities by id', () => {
    const byId = entitiesById(model)
    expect(byId.plex.label).toBe('Plex')
    expect(byId.sonarr.label).toBe('Sonarr')
    expect(Object.keys(byId)).toHaveLength(2)
  })
})

describe('migrateFromGraph', () => {
  const graph = {
    nodes: [
      { id: 'media', type: 'group', position: { x: 0, y: 0 }, data: { label: 'Media', color: '#2f6fed' }, style: { width: 400, height: 200 } },
      { id: 'plex', type: 'service', parentId: 'media', position: { x: 18, y: 44 }, data: { label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' } },
      { id: 'users', type: 'service', position: { x: -300, y: 80 }, data: { label: 'Internet users', kind: 'actor' } },
      { id: 'n1', type: 'note', position: { x: 5, y: 5 }, data: { text: 'hi' }, style: { width: 190, height: 110 } },
    ],
    edges: [
      { id: 'e0-users-plex', source: 'users', target: 'plex', label: 'watches', data: { rel: 'talks-to', inferred: false, shape: 'default' } },
    ],
  }

  it('splits nodes into a catalog + a Logical diagram', () => {
    const m = migrateFromGraph(graph)
    expect(m.entities.map((e) => e.id).sort()).toEqual(['plex', 'users'])
    expect(m.entities.find((e) => e.id === 'plex')).toMatchObject({ label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' })
    expect(m.diagrams).toHaveLength(1)
    const d = m.diagrams[0]
    expect(d.name).toBe('Logical')
    expect(d.type).toBe('canvas')
    expect(d.groups.map((g) => g.id)).toEqual(['media'])
    expect(d.groups[0].size).toEqual({ width: 400, height: 200 })
    expect(d.placements.find((p) => p.entityId === 'plex')).toMatchObject({ parentId: 'media', position: { x: 18, y: 44 } })
    expect(d.notes).toHaveLength(1)
    expect(d.edges[0]).toMatchObject({ from: 'users', to: 'plex', type: 'talks-to', label: 'watches' })
  })
})

describe('buildDiagramGraph', () => {
  const byId = { plex: { id: 'plex', label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' as const }, users: { id: 'users', label: 'Internet users', kind: 'actor' as const } }
  const diagram = {
    id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas' as const,
    groups: [{ id: 'media', label: 'Media', color: '#2f6fed', position: { x: 0, y: 0 }, size: { width: 400, height: 200 } }],
    placements: [
      { entityId: 'plex', position: { x: 18, y: 44 }, parentId: 'media' },
      { entityId: 'users', position: { x: -300, y: 80 }, parentId: null },
    ],
    edges: [{ id: 'e1', from: 'users', to: 'plex', type: 'talks-to' as const, label: 'watches', shape: 'default' as const }],
    notes: [],
  }

  it('builds RF nodes (groups first) and edges from the model', () => {
    const { nodes, edges } = buildDiagramGraph(diagram, byId)
    expect(nodes[0].id).toBe('media') // group first
    expect(nodes[0].type).toBe('group')
    const plex = nodes.find((n) => n.id === 'plex')!
    expect(plex.type).toBe('service')
    expect(plex.parentId).toBe('media')
    expect((plex.data as any).label).toBe('Plex')
    expect(plex.position).toEqual({ x: 18, y: 44 })
    expect(edges[0].id).toBe('e1')
    expect(edges[0].source).toBe('users')
    expect(edges[0].target).toBe('plex')
    expect(edges[0].type).toBe('waypoint')
  })
})

describe('model mutations', () => {
  const base: Model = {
    version: 1,
    entities: [{ id: 'plex', label: 'Plex' }, { id: 'users', label: 'Users', kind: 'actor' }],
    diagrams: [{
      id: 'logical', name: 'Logical', title: 'Logical', type: 'canvas',
      placements: [{ entityId: 'plex', position: { x: 0, y: 0 }, parentId: null }, { entityId: 'users', position: { x: 1, y: 1 }, parentId: null }],
      groups: [], notes: [],
      edges: [{ id: 'e1', from: 'users', to: 'plex', type: 'talks-to' }],
    }],
  }

  it('updateEntity is shared and immutable', () => {
    const m = updateEntity(base, 'plex', { label: 'Plex Media Server' })
    expect(m.entities.find((e) => e.id === 'plex')!.label).toBe('Plex Media Server')
    expect(base.entities.find((e) => e.id === 'plex')!.label).toBe('Plex') // original untouched
  })
  it('deleteEntity removes it + its placements + its edges everywhere', () => {
    const m = deleteEntity(base, 'plex')
    expect(m.entities.map((e) => e.id)).toEqual(['users'])
    expect(m.diagrams[0].placements.map((p) => p.entityId)).toEqual(['users'])
    expect(m.diagrams[0].edges).toHaveLength(0)
  })
  it('removePlacement drops placement + touching edges in that diagram only', () => {
    const m = removePlacement(base, 'logical', 'plex')
    expect(m.diagrams[0].placements.map((p) => p.entityId)).toEqual(['users'])
    expect(m.diagrams[0].edges).toHaveLength(0)
    expect(m.entities.map((e) => e.id)).toEqual(['plex', 'users']) // catalog intact
  })
  it('addDiagram creates an empty canvas diagram and returns its id', () => {
    const { model, id } = addDiagram(base, 'Voice Flow', 'canvas')
    const d = model.diagrams.find((x) => x.id === id)!
    expect(d.name).toBe('Voice Flow')
    expect(d.placements).toHaveLength(0)
    expect(d.type).toBe('canvas')
  })
  it('deleteDiagram never touches the catalog', () => {
    const { model, id } = addDiagram(base, 'Temp', 'canvas')
    const m = deleteDiagram(model, id)
    expect(m.diagrams.find((x) => x.id === id)).toBeUndefined()
    expect(m.entities).toHaveLength(2)
  })
  it('addDiagram does not reuse an id after a delete (collision-safe)', () => {
    const first = addDiagram(base, 'Topology', 'canvas')
    expect(first.id).toBe('d-topology')
    const afterDelete = deleteDiagram(first.model, first.id)
    // Re-create with the same name: the freed id is available again.
    const second = addDiagram(afterDelete, 'Topology', 'canvas')
    expect(second.id).toBe('d-topology')
    // But creating another same-named diagram while one exists must not collide.
    const third = addDiagram(second.model, 'Topology', 'canvas')
    expect(third.id).not.toBe(second.id)
    expect(third.model.diagrams.map((d) => d.id)).toEqual(['logical', 'd-topology', 'd-topology-2'])
  })
})
