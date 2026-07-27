import { describe, it, expect } from 'vitest'
import { entitiesById, migrateFromGraph, updateEntity, addEntity, deleteEntity, addPlacement, removePlacement, addDiagram, deleteDiagram, getDiagram, normalizeModel, fieldVisible, addTemplate, deleteTemplate, applyTemplate, setEntityFields, setFieldShow, setPlacement, addGroup, updateGroup, removeGroup, addNote, updateNote, removeNote, addEdge, updateEdge, removeEdge, type Model, type Entity, type Template, type Placement } from './model'
import { buildDiagramGraph } from './buildGraph'

const model: Model = {
  version: 1,
  templates: [],
  entities: [
    { id: 'plex', label: 'Plex', fields: [] },
    { id: 'sonarr', label: 'Sonarr', fields: [] },
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
  const byId = { plex: { id: 'plex', label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' as const, fields: [] }, users: { id: 'users', label: 'Internet users', kind: 'actor' as const, fields: [] } }
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

describe('buildDiagramGraph shownFields', () => {
  const templates = [{ id: 't', name: 'C', fields: [{ key: 'image', showOnNode: true }] }]
  const byId = { plex: { id: 'plex', label: 'Plex', template: 't', fields: [{ key: 'image', value: 'lscr/plex' }, { key: 'ip', value: '10.0.0.5', showOnNode: true }, { key: 'note', value: 'hi' }] } }
  const diagram = { id: 'd', name: 'D', title: 'D', type: 'canvas' as const, groups: [], notes: [], edges: [],
    placements: [{ entityId: 'plex', position: { x: 0, y: 0 }, parentId: null, fieldShow: { ip: false } }] }
  it('passes only visible fields, in order', () => {
    const { nodes } = buildDiagramGraph(diagram as any, byId as any, templates as any)
    const plex = nodes.find((n) => n.id === 'plex')!
    expect((plex.data as any).shownFields).toEqual([{ key: 'image', value: 'lscr/plex' }]) // template shows image; placement hid ip; note default off
  })
})

describe('model mutations', () => {
  const base: Model = {
    version: 1,
    templates: [],
    entities: [{ id: 'plex', label: 'Plex', fields: [] }, { id: 'users', label: 'Users', kind: 'actor', fields: [] }],
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
  it('addEntity dedupes by id: adding the same id twice yields one entity', () => {
    const e: Entity = { id: 'grafana', label: 'Grafana', fields: [] }
    const once = addEntity(base, e)
    expect(once.entities.map((x) => x.id)).toEqual(['plex', 'users', 'grafana'])
    const twice = addEntity(once, { id: 'grafana', label: 'Different', fields: [] })
    expect(twice.entities.filter((x) => x.id === 'grafana')).toHaveLength(1)
    expect(twice).toBe(once) // unchanged model returned as-is
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

describe('normalizeModel', () => {
  it('fills new fields with safe defaults', () => {
    const m = normalizeModel({ version: 1, entities: [{ id: 'plex', label: 'Plex' }], diagrams: [] })
    expect(m.templates).toEqual([])
    expect(m.entities[0].fields).toEqual([])
  })
})

describe('fieldVisible cascade', () => {
  const tmpl: Template = { id: 't', name: 'Container', fields: [{ key: 'image', showOnNode: true }, { key: 'port' }] }
  const ent: Entity = { id: 'e', label: 'E', template: 't', fields: [{ key: 'image', value: 'x' }, { key: 'ip', value: '1.2.3.4', showOnNode: true }, { key: 'port', value: '80' }] }
  it('template default applies when nothing overrides', () => {
    expect(fieldVisible(undefined, ent, tmpl, 'image')).toBe(true)   // template says show
    expect(fieldVisible(undefined, ent, tmpl, 'port')).toBe(false)   // template default false
  })
  it('entity default overrides template', () => {
    expect(fieldVisible(undefined, ent, tmpl, 'ip')).toBe(true)      // entity showOnNode
  })
  it('placement override wins', () => {
    const p: Placement = { entityId: 'e', position: { x: 0, y: 0 }, fieldShow: { image: false, port: true } }
    expect(fieldVisible(p, ent, tmpl, 'image')).toBe(false)          // placement hides what template showed
    expect(fieldVisible(p, ent, tmpl, 'port')).toBe(true)           // placement shows what template hid
  })
  it('defaults to false with no signal', () => {
    expect(fieldVisible(undefined, { id: 'x', label: 'X', fields: [{ key: 'a', value: 'b' }] }, undefined, 'a')).toBe(false)
  })
})

describe('template + field helpers', () => {
  const base = { version: 1, templates: [], entities: [{ id: 'e', label: 'E', fields: [] }], diagrams: [] } as any
  it('addTemplate returns unique id and appends', () => {
    const { model, id } = addTemplate(base, 'Container')
    expect(model.templates.find((t: any) => t.id === id)?.name).toBe('Container')
  })
  it('applyTemplate seeds fields + icon + template id (soft, no dupes)', () => {
    const tmpl = { id: 't', name: 'C', icon: 'docker', fields: [{ key: 'image', default: 'nginx' }, { key: 'port' }] }
    const e = applyTemplate({ id: 'e', label: 'E', fields: [{ key: 'image', value: 'keep' }] } as any, tmpl as any)
    expect(e.template).toBe('t'); expect(e.icon).toBe('docker')
    expect(e.fields).toEqual([{ key: 'image', value: 'keep' }, { key: 'port', value: '' }]) // existing image kept, port added
  })
  it('deleteTemplate clears entity.template references', () => {
    const m = { ...base, templates: [{ id: 't', name: 'C', fields: [] }], entities: [{ id: 'e', label: 'E', template: 't', fields: [] }] }
    const out = deleteTemplate(m as any, 't')
    expect(out.templates).toHaveLength(0)
    expect(out.entities[0].template).toBeUndefined()
  })
  it('setEntityFields replaces an entity\'s fields immutably', () => {
    const out = setEntityFields(base, 'e', [{ key: 'a', value: 'b', showOnNode: true }])
    expect(out.entities[0].fields).toEqual([{ key: 'a', value: 'b', showOnNode: true }])
    expect(base.entities[0].fields).toEqual([])
  })
})

describe('granular diagram mutators', () => {
  const base = addDiagram(normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] }), 'D', 'canvas')
  const id = base.id
  it('setPlacement upserts position/parent/note on an existing placement', () => {
    let m = addPlacement(base.model, id, { entityId: 'e1', position: { x: 0, y: 0 } })
    m = setPlacement(m, id, 'e1', { position: { x: 10, y: 20 }, note: 'hi' })
    const p = getDiagram(m, id)!.placements[0]
    expect(p.position).toEqual({ x: 10, y: 20 })
    expect(p.note).toBe('hi')
  })
  it('addEdge/updateEdge/removeEdge round-trip', () => {
    let m = addEdge(base.model, id, { id: 'x1', from: 'a', to: 'b', type: 'talks-to' })
    expect(getDiagram(m, id)!.edges).toHaveLength(1)
    m = updateEdge(m, id, 'x1', { label: 'L', color: '#ff0000' })
    expect(getDiagram(m, id)!.edges[0].label).toBe('L')
    m = removeEdge(m, id, 'x1')
    expect(getDiagram(m, id)!.edges).toHaveLength(0)
  })
  it('removeGroup clears parentId on its children', () => {
    let m = addGroup(base.model, id, { id: 'g1', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 200, height: 120 } })
    m = addPlacement(m, id, { entityId: 'e1', position: { x: 0, y: 0 }, parentId: 'g1' })
    m = removeGroup(m, id, 'g1')
    expect(getDiagram(m, id)!.groups).toHaveLength(0)
    expect(getDiagram(m, id)!.placements[0].parentId).toBeUndefined()
  })
  it('addGroup/updateGroup round-trip', () => {
    let m = addGroup(base.model, id, { id: 'g2', label: 'G2', color: '#111', position: { x: 1, y: 2 }, size: { width: 100, height: 50 } })
    expect(getDiagram(m, id)!.groups).toHaveLength(1)
    m = updateGroup(m, id, 'g2', { label: 'G2 renamed' })
    expect(getDiagram(m, id)!.groups[0].label).toBe('G2 renamed')
  })
  it('addNote/updateNote/removeNote round-trip', () => {
    let m = addNote(base.model, id, { id: 'n1', position: { x: 0, y: 0 }, size: { width: 190, height: 110 }, text: 'hello' })
    expect(getDiagram(m, id)!.notes).toHaveLength(1)
    m = updateNote(m, id, 'n1', { text: 'updated' })
    expect(getDiagram(m, id)!.notes[0].text).toBe('updated')
    m = removeNote(m, id, 'n1')
    expect(getDiagram(m, id)!.notes).toHaveLength(0)
  })
})

describe('setFieldShow', () => {
  const m = { version: 1, templates: [], entities: [], diagrams: [{ id: 'd', name: 'D', title: 'D', type: 'canvas', groups: [], edges: [], notes: [],
    placements: [{ entityId: 'e', position: { x: 0, y: 0 } }] }] } as any
  it('sets and clears an override', () => {
    const on = setFieldShow(m, 'd', 'e', 'ip', true)
    expect(on.diagrams[0].placements[0].fieldShow).toEqual({ ip: true })
    const cleared = setFieldShow(on, 'd', 'e', 'ip', undefined)
    expect(cleared.diagrams[0].placements[0].fieldShow).toEqual({})
  })
})
