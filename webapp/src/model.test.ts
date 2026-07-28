import { describe, it, expect } from 'vitest'
import {
  addNode,
  updateNode,
  removeNode,
  setNodeFields,
  applyTemplate,
  addGroup,
  updateGroup,
  removeGroup,
  addNote,
  updateNote,
  removeNote,
  addEdge,
  updateEdge,
  removeEdge,
  addFlow,
  updateFlow,
  removeFlow,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  addDiagram,
  renameDiagram,
  deleteDiagram,
  getDiagram,
  normalizeModel,
  diagramContent,
  nodesById,
  patchDiagram,
  type Model,
  type Diagram,
  type Node,
  type Template,
} from './model'

const diagram: Diagram = {
  id: 'logical',
  name: 'Logical',
  title: 'Logical',
  type: 'canvas',
  nodes: [
    { id: 'plex', label: 'Plex', fields: [], position: { x: 0, y: 0 } },
    { id: 'users', label: 'Users', actor: true, fields: [], position: { x: 1, y: 1 } },
  ],
  groups: [],
  notes: [],
  edges: [{ id: 'e1', from: 'users', to: 'plex', type: 'talks-to' }],
  flows: [],
}

const baseModel: Model = { version: 2, templates: [], diagrams: [diagram] }

describe('node mutators', () => {
  it('addNode appends a node and dedupes by id (unchanged diagram returned as-is)', () => {
    const n: Node = { id: 'grafana', label: 'Grafana', fields: [], position: { x: 5, y: 5 } }
    const once = addNode(baseModel, 'logical', n)
    expect(getDiagram(once, 'logical')!.nodes.map((x) => x.id)).toEqual(['plex', 'users', 'grafana'])
    const twice = addNode(once, 'logical', { ...n, label: 'Different' })
    expect(getDiagram(twice, 'logical')!.nodes.filter((x) => x.id === 'grafana')).toHaveLength(1)
    expect(getDiagram(twice, 'logical')).toBe(getDiagram(once, 'logical')) // diagram object reused when the add is a no-op
  })

  it('updateNode patches a node immutably', () => {
    const m = updateNode(baseModel, 'logical', 'plex', { label: 'Plex Media Server' })
    expect(getDiagram(m, 'logical')!.nodes.find((n) => n.id === 'plex')!.label).toBe('Plex Media Server')
    expect(getDiagram(baseModel, 'logical')!.nodes.find((n) => n.id === 'plex')!.label).toBe('Plex') // original untouched
  })

  it('removeNode removes the node and drops edges touching it', () => {
    const m = removeNode(baseModel, 'logical', 'plex')
    const d = getDiagram(m, 'logical')!
    expect(d.nodes.map((n) => n.id)).toEqual(['users'])
    expect(d.edges).toHaveLength(0)
  })

  it('setNodeFields replaces a node\'s fields immutably', () => {
    const m = setNodeFields(baseModel, 'logical', 'plex', [{ key: 'ip', value: '10.0.0.5', showOnNode: true }])
    expect(getDiagram(m, 'logical')!.nodes.find((n) => n.id === 'plex')!.fields).toEqual([
      { key: 'ip', value: '10.0.0.5', showOnNode: true },
    ])
    expect(getDiagram(baseModel, 'logical')!.nodes.find((n) => n.id === 'plex')!.fields).toEqual([])
  })
})

describe('applyTemplate', () => {
  it('seeds fields + icon + template id onto a Node (soft, no dupes)', () => {
    const tmpl: Template = {
      id: 't',
      name: 'Container',
      icon: 'docker',
      fields: [{ key: 'image', default: 'nginx' }, { key: 'port' }],
    }
    const node: Node = { id: 'e', label: 'E', fields: [{ key: 'image', value: 'keep' }], position: { x: 0, y: 0 } }
    const out = applyTemplate(node, tmpl)
    expect(out.template).toBe('t')
    expect(out.icon).toBe('docker')
    expect(out.fields).toEqual([
      { key: 'image', value: 'keep' }, // existing field kept as-is
      { key: 'port', value: '' }, // new field added with default
    ])
  })

  it('does not overwrite an icon the node already has', () => {
    const tmpl: Template = { id: 't', name: 'C', icon: 'docker', fields: [] }
    const node: Node = { id: 'e', label: 'E', icon: 'custom', fields: [], position: { x: 0, y: 0 } }
    expect(applyTemplate(node, tmpl).icon).toBe('custom')
  })
})

describe('removeGroup', () => {
  it('clears parentId on child nodes, child groups, and child notes', () => {
    const created = addDiagram(normalizeModel(null), 'D', 'canvas')
    const id = created.id
    let m = created.model
    m = addGroup(m, id, { id: 'g1', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 200, height: 120 } })
    m = addGroup(m, id, {
      id: 'g2',
      label: 'Child group',
      color: '#111',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 80 },
      parentId: 'g1',
    })
    m = addNode(m, id, { id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 }, parentId: 'g1' })
    m = addNote(m, id, { id: 'note1', text: 'hi', position: { x: 0, y: 0 }, size: { width: 190, height: 110 }, parentId: 'g1' })

    m = removeGroup(m, id, 'g1')
    const d = getDiagram(m, id)!
    expect(d.groups.map((g) => g.id)).toEqual(['g2'])
    expect(d.groups[0].parentId).toBeUndefined()
    expect(d.nodes[0].parentId).toBeUndefined()
    expect(d.notes[0].parentId).toBeUndefined()
  })
})

describe('group/note/edge/flow mutators', () => {
  it('addGroup/updateGroup round-trip', () => {
    let m = addGroup(baseModel, 'logical', { id: 'g', label: 'G', color: '#111', position: { x: 1, y: 2 }, size: { width: 100, height: 50 } })
    expect(getDiagram(m, 'logical')!.groups).toHaveLength(1)
    m = updateGroup(m, 'logical', 'g', { label: 'G renamed' })
    expect(getDiagram(m, 'logical')!.groups[0].label).toBe('G renamed')
  })

  it('addNote/updateNote/removeNote round-trip', () => {
    let m = addNote(baseModel, 'logical', { id: 'n1', position: { x: 0, y: 0 }, size: { width: 190, height: 110 }, text: 'hello' })
    expect(getDiagram(m, 'logical')!.notes).toHaveLength(1)
    m = updateNote(m, 'logical', 'n1', { text: 'updated' })
    expect(getDiagram(m, 'logical')!.notes[0].text).toBe('updated')
    m = removeNote(m, 'logical', 'n1')
    expect(getDiagram(m, 'logical')!.notes).toHaveLength(0)
  })

  it('addEdge/updateEdge/removeEdge round-trip', () => {
    let m = addEdge(baseModel, 'logical', { id: 'x1', from: 'a', to: 'b', type: 'talks-to' })
    expect(getDiagram(m, 'logical')!.edges.map((e) => e.id)).toContain('x1')
    m = updateEdge(m, 'logical', 'x1', { label: 'L', color: '#ff0000' })
    expect(getDiagram(m, 'logical')!.edges.find((e) => e.id === 'x1')!.label).toBe('L')
    m = removeEdge(m, 'logical', 'x1')
    expect(getDiagram(m, 'logical')!.edges.find((e) => e.id === 'x1')).toBeUndefined()
  })

  it('addFlow/updateFlow/removeFlow round-trip', () => {
    let m = addFlow(baseModel, 'logical', { id: 'f1', name: 'Flow 1', steps: [] })
    expect(getDiagram(m, 'logical')!.flows).toHaveLength(1)
    m = updateFlow(m, 'logical', 'f1', { name: 'Renamed' })
    expect(getDiagram(m, 'logical')!.flows[0].name).toBe('Renamed')
    m = removeFlow(m, 'logical', 'f1')
    expect(getDiagram(m, 'logical')!.flows).toHaveLength(0)
  })
})

describe('addDiagram', () => {
  it('creates a diagram with empty content arrays and returns its id', () => {
    const { model, id } = addDiagram(normalizeModel(null), 'Voice Flow', 'canvas')
    const d = getDiagram(model, id)!
    expect(d.name).toBe('Voice Flow')
    expect(d.type).toBe('canvas')
    expect(d.nodes).toEqual([])
    expect(d.groups).toEqual([])
    expect(d.notes).toEqual([])
    expect(d.edges).toEqual([])
    expect(d.flows).toEqual([])
  })

  it('does not reuse an id after a delete (collision-safe)', () => {
    const first = addDiagram(normalizeModel(null), 'Topology', 'canvas')
    expect(first.id).toBe('d-topology')
    const afterDelete = deleteDiagram(first.model, first.id)
    const second = addDiagram(afterDelete, 'Topology', 'canvas')
    expect(second.id).toBe('d-topology')
    const third = addDiagram(second.model, 'Topology', 'canvas')
    expect(third.id).not.toBe(second.id)
  })
})

describe('renameDiagram', () => {
  it('updates name and title', () => {
    const m = renameDiagram(baseModel, 'logical', 'Renamed')
    const d = getDiagram(m, 'logical')!
    expect(d.name).toBe('Renamed')
    expect(d.title).toBe('Renamed')
  })
})

describe('deleteDiagram', () => {
  it('filters out only the removed diagram (nodes are diagram-local; no cross-diagram sweep)', () => {
    const { model, id } = addDiagram(baseModel, 'Second', 'canvas')
    const after = deleteDiagram(model, id)
    expect(after.diagrams.map((d) => d.id)).toEqual(['logical'])
  })

  it('is a no-op when the id does not exist', () => {
    const after = deleteDiagram(baseModel, 'nope')
    expect(after.diagrams).toEqual(baseModel.diagrams)
  })
})

describe('normalizeModel', () => {
  it('resets an old-shape model (top-level entities) to a fresh empty model', () => {
    const old = { version: 1, entities: [{ id: 'plex', label: 'Plex' }], diagrams: [] }
    expect(normalizeModel(old)).toEqual({ version: 2, diagrams: [], templates: [] })
  })

  it('passes a new-shape model through, filling missing arrays with safe defaults', () => {
    expect(normalizeModel(null)).toEqual({ version: 2, diagrams: [], templates: [] })
    const partial = normalizeModel({ version: 2, diagrams: [diagram] })
    expect(partial).toEqual({ version: 2, diagrams: [diagram], templates: [] })
  })
})

describe('template mutators', () => {
  it('addTemplate returns a unique id and appends', () => {
    const { model, id } = addTemplate(baseModel, 'Container')
    expect(model.templates.find((t) => t.id === id)?.name).toBe('Container')
  })

  it('updateTemplate patches immutably', () => {
    const { model, id } = addTemplate(baseModel, 'Container')
    const m = updateTemplate(model, id, { icon: 'docker' })
    expect(m.templates.find((t) => t.id === id)!.icon).toBe('docker')
  })

  it('deleteTemplate clears node.template references across all diagrams', () => {
    const withTemplate: Model = {
      version: 2,
      templates: [{ id: 't', name: 'C', fields: [] }],
      diagrams: [{ ...diagram, nodes: [{ id: 'plex', label: 'Plex', template: 't', fields: [], position: { x: 0, y: 0 } }] }],
    }
    const out = deleteTemplate(withTemplate, 't')
    expect(out.templates).toHaveLength(0)
    expect(out.diagrams[0].nodes[0].template).toBeUndefined()
  })
})

describe('nodesById', () => {
  it('indexes a diagram\'s nodes by id', () => {
    const byId = nodesById(diagram)
    expect(byId.plex.label).toBe('Plex')
    expect(byId.users.label).toBe('Users')
    expect(Object.keys(byId)).toHaveLength(2)
  })
})

describe('diagramContent', () => {
  it('extracts the five undoable content arrays', () => {
    expect(diagramContent(diagram)).toEqual({
      nodes: diagram.nodes,
      groups: diagram.groups,
      notes: diagram.notes,
      edges: diagram.edges,
      flows: diagram.flows,
    })
  })
})

describe('patchDiagram', () => {
  it('patches selected diagram-content fields immutably', () => {
    const m = patchDiagram(baseModel, 'logical', { name: 'Patched', notes: [{ id: 'n', text: 'x', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }] })
    const d = getDiagram(m, 'logical')!
    expect(d.name).toBe('Patched')
    expect(d.notes).toHaveLength(1)
    expect(getDiagram(baseModel, 'logical')!.notes).toHaveLength(0) // original untouched
  })
})
