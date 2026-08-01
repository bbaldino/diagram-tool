import { describe, it, expect } from 'vitest'
import { applyOp, applyOps, type Op } from './ops'
import { addDiagram, addTemplate, getDiagram, normalizeModel, type Model } from './model'

const empty: Model = normalizeModel({ version: 2, diagrams: [], templates: [] })

describe('node ops', () => {
  it('node.add then node.update', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, {
      t: 'node.add',
      diagramId: d.id,
      node: { id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 } },
    })
    m = applyOp(m, { t: 'node.update', diagramId: d.id, id: 'n1', patch: { label: 'N2' } })
    expect(getDiagram(m, d.id)!.nodes[0].label).toBe('N2')
  })

  it('node.remove removes the node', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, {
      t: 'node.add',
      diagramId: d.id,
      node: { id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 } },
    })
    m = applyOp(m, { t: 'node.remove', diagramId: d.id, id: 'n1' })
    expect(getDiagram(m, d.id)!.nodes).toHaveLength(0)
  })

  it('node.setFields replaces fields', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, {
      t: 'node.add',
      diagramId: d.id,
      node: { id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 } },
    })
    m = applyOp(m, {
      t: 'node.setFields',
      diagramId: d.id,
      id: 'n1',
      fields: [{ key: 'port', value: '80' }],
    })
    expect(getDiagram(m, d.id)!.nodes[0].fields).toEqual([{ key: 'port', value: '80' }])
  })

  it('node.applyTemplate merges template fields onto the node', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, {
      t: 'node.add',
      diagramId: d.id,
      node: { id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 } },
    })
    const t = addTemplate(m, 'Svc')
    m = t.model
    m = {
      ...m,
      templates: m.templates.map((tt) =>
        tt.id === t.id ? { ...tt, fields: [{ key: 'port', default: '8080' }] } : tt,
      ),
    }
    m = applyOp(m, { t: 'node.applyTemplate', diagramId: d.id, id: 'n1', templateId: t.id })
    expect(getDiagram(m, d.id)!.nodes[0].template).toBe(t.id)
    expect(getDiagram(m, d.id)!.nodes[0].fields).toEqual([{ key: 'port', value: '8080' }])
  })

  it('node.applyTemplate is a no-op when the node or template is missing', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    const m = applyOp(d.model, {
      t: 'node.applyTemplate',
      diagramId: d.id,
      id: 'missing',
      templateId: 'also-missing',
    })
    expect(m).toEqual(d.model)
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

describe('group ops', () => {
  it('group.add/update/remove', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let m = applyOp(d.model, {
      t: 'group.add',
      diagramId: d.id,
      group: {
        id: 'g1',
        label: 'G',
        color: '#000',
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
      },
    })
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
    let m = applyOp(d.model, {
      t: 'note.add',
      diagramId: d.id,
      note: { id: 'n1', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: 'hi' },
    })
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
