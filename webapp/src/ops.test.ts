import { describe, it, expect } from 'vitest'
import { applyOp, applyOps, type Op } from './ops'
import { addDiagram, addTemplate, getDiagram, normalizeModel, type Model } from './model'

const empty: Model = normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] })

describe('entity ops', () => {
  it('entity.add then entity.update', () => {
    let m = applyOp(empty, { t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } })
    m = applyOp(m, { t: 'entity.update', id: 'e1', patch: { label: 'E2' } })
    expect(m.entities[0].label).toBe('E2')
  })

  it('entity.delete removes the entity', () => {
    let m = applyOp(empty, { t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } })
    m = applyOp(m, { t: 'entity.delete', id: 'e1' })
    expect(m.entities).toHaveLength(0)
  })

  it('entity.setFields replaces fields', () => {
    let m = applyOp(empty, { t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } })
    m = applyOp(m, { t: 'entity.setFields', id: 'e1', fields: [{ key: 'port', value: '80' }] })
    expect(m.entities[0].fields).toEqual([{ key: 'port', value: '80' }])
  })

  it('entity.applyTemplate merges template fields onto the entity', () => {
    let m = applyOp(empty, { t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } })
    const t = addTemplate(m, 'Svc')
    m = t.model
    m = { ...m, templates: m.templates.map((tt) => (tt.id === t.id ? { ...tt, fields: [{ key: 'port', default: '8080' }] } : tt)) }
    m = applyOp(m, { t: 'entity.applyTemplate', id: 'e1', templateId: t.id })
    expect(m.entities[0].template).toBe(t.id)
    expect(m.entities[0].fields).toEqual([{ key: 'port', value: '8080' }])
  })

  it('entity.applyTemplate is a no-op when the entity or template is missing', () => {
    const m = applyOp(empty, { t: 'entity.applyTemplate', id: 'missing', templateId: 'also-missing' })
    expect(m).toEqual(empty)
  })
})

describe('template ops', () => {
  it('template.add creates a template', () => {
    const m = applyOp(empty, { t: 'template.add', name: 'Router' })
    expect(m.templates).toHaveLength(1)
    expect(m.templates[0].name).toBe('Router')
  })

  it('template.update patches a template', () => {
    const t = addTemplate(empty, 'Router')
    const m = applyOp(t.model, { t: 'template.update', id: t.id, patch: { name: 'Router2' } })
    expect(m.templates[0].name).toBe('Router2')
  })

  it('template.delete removes a template', () => {
    const t = addTemplate(empty, 'Router')
    const m = applyOp(t.model, { t: 'template.delete', id: t.id })
    expect(m.templates).toHaveLength(0)
  })
})

describe('diagram ops', () => {
  it('diagram.add creates a diagram', () => {
    const m = applyOp(empty, { t: 'diagram.add', name: 'Topo', kind: 'topology' })
    expect(m.diagrams).toHaveLength(1)
    expect(m.diagrams[0].name).toBe('Topo')
    expect(m.diagrams[0].type).toBe('topology')
  })

  it('diagram.rename renames a diagram', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    const m = applyOp(d.model, { t: 'diagram.rename', id: d.id, name: 'D2' })
    expect(getDiagram(m, d.id)!.name).toBe('D2')
  })

  it('diagram.delete removes a diagram', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    const m = applyOp(d.model, { t: 'diagram.delete', id: d.id })
    expect(getDiagram(m, d.id)).toBeUndefined()
  })
})

describe('placement ops', () => {
  it('placement.add/remove', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, { t: 'placement.add', diagramId: d.id, placement: { entityId: 'e1', position: { x: 0, y: 0 } } })
    expect(getDiagram(m, d.id)!.placements).toHaveLength(1)
    m = applyOp(m, { t: 'placement.remove', diagramId: d.id, entityId: 'e1' })
    expect(getDiagram(m, d.id)!.placements).toHaveLength(0)
  })

  it('placement.set patches position', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, { t: 'placement.add', diagramId: d.id, placement: { entityId: 'e1', position: { x: 0, y: 0 } } })
    m = applyOp(m, { t: 'placement.set', diagramId: d.id, entityId: 'e1', patch: { position: { x: 5, y: 5 } } })
    expect(getDiagram(m, d.id)!.placements[0].position).toEqual({ x: 5, y: 5 })
  })

  it('placement.fieldShow sets and clears an override', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, { t: 'placement.add', diagramId: d.id, placement: { entityId: 'e1', position: { x: 0, y: 0 } } })
    m = applyOp(m, { t: 'placement.fieldShow', diagramId: d.id, entityId: 'e1', key: 'port', value: true })
    expect(getDiagram(m, d.id)!.placements[0].fieldShow).toEqual({ port: true })
    m = applyOp(m, { t: 'placement.fieldShow', diagramId: d.id, entityId: 'e1', key: 'port', value: undefined })
    expect(getDiagram(m, d.id)!.placements[0].fieldShow).toEqual({})
  })
})

describe('group ops', () => {
  it('group.add/update/remove', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, { t: 'group.add', diagramId: d.id, group: { id: 'g1', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } } })
    expect(getDiagram(m, d.id)!.groups).toHaveLength(1)
    m = applyOp(m, { t: 'group.update', diagramId: d.id, id: 'g1', patch: { label: 'G2' } })
    expect(getDiagram(m, d.id)!.groups[0].label).toBe('G2')
    m = applyOp(m, { t: 'group.remove', diagramId: d.id, id: 'g1' })
    expect(getDiagram(m, d.id)!.groups).toHaveLength(0)
  })
})

describe('note ops', () => {
  it('note.add/update/remove', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, { t: 'note.add', diagramId: d.id, note: { id: 'n1', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: 'hi' } })
    expect(getDiagram(m, d.id)!.notes).toHaveLength(1)
    m = applyOp(m, { t: 'note.update', diagramId: d.id, id: 'n1', patch: { text: 'bye' } })
    expect(getDiagram(m, d.id)!.notes[0].text).toBe('bye')
    m = applyOp(m, { t: 'note.remove', diagramId: d.id, id: 'n1' })
    expect(getDiagram(m, d.id)!.notes).toHaveLength(0)
  })
})

describe('edge ops', () => {
  it('edge.add/update/remove via applyOps', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOps(d.model, [
      { t: 'edge.add', diagramId: d.id, edge: { id: 'x', from: 'a', to: 'b', type: 'talks-to' } },
      { t: 'edge.update', diagramId: d.id, id: 'x', patch: { dir: 'both' } },
    ])
    expect(getDiagram(m, d.id)!.edges[0].dir).toBe('both')
    m = applyOp(m, { t: 'edge.remove', diagramId: d.id, id: 'x' })
    expect(getDiagram(m, d.id)!.edges).toHaveLength(0)
  })
})

describe('applyOp totality', () => {
  it('throws on unknown op', () => {
    expect(() => applyOp(empty, { t: 'bogus' } as unknown as Op)).toThrow(/unknown op/)
  })
})
