import { describe, it, expect } from 'vitest'
import { diffToOps, diffDiagramContents } from './diff'
import { applyOps } from './ops'
import {
  addDiagram,
  addPlacement,
  addEntity,
  normalizeModel,
  getDiagram,
  setPlacement,
  addTemplate,
  addGroup,
  addNote,
  addEdge,
  renameDiagram,
  deleteDiagram,
  setFieldShow,
  type Model,
} from './model'

const empty: Model = normalizeModel({ version: 1, entities: [], diagrams: [], templates: [] })

describe('diffToOps', () => {
  it('round-trips: applyOps(prev, diffToOps(prev,next)) deep-equals next', () => {
    const prev = addEntity(empty, { id: 'e1', label: 'E', fields: [] })
    const d = addDiagram(prev, 'D', 'canvas')
    let next = addPlacement(d.model, d.id, { entityId: 'e1', position: { x: 5, y: 5 } })
    next = addEntity(next, { id: 'e2', label: 'E2', fields: [] })
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })

  it('a node move emits exactly one placement.set', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    const prev = addPlacement(created.model, did, { entityId: 'e1', position: { x: 0, y: 0 } })
    const next = setPlacement(prev, did, 'e1', { position: { x: 40, y: 10 } })
    const ops = diffToOps(prev, next)
    expect(ops).toEqual([{ t: 'placement.set', diagramId: did, entityId: 'e1', patch: { position: { x: 40, y: 10 } } }])
  })

  it('empty diff for identical models', () => {
    expect(diffToOps(empty, empty)).toEqual([])
  })

  it('entity add/update/delete', () => {
    const prev = addEntity(addEntity(empty, { id: 'e1', label: 'E1', fields: [] }), { id: 'e2', label: 'E2', fields: [] })
    // e1 updated, e2 deleted, e3 added
    let next = { ...prev, entities: prev.entities.filter((e) => e.id !== 'e2').map((e) => (e.id === 'e1' ? { ...e, label: 'E1-changed' } : e)) }
    next = addEntity(next, { id: 'e3', label: 'E3', fields: [] })
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
    expect(ops).toContainEqual({ t: 'entity.update', id: 'e1', patch: { label: 'E1-changed', fields: [] } })
    expect(ops).toContainEqual({ t: 'entity.delete', id: 'e2' })
    expect(ops).toContainEqual({ t: 'entity.add', entity: { id: 'e3', label: 'E3', fields: [] } })
  })

  it('template add/update/delete', () => {
    const t1 = addTemplate(empty, 'T1')
    const t2 = addTemplate(t1.model, 'T2')
    const prev = t2.model
    let next = { ...prev, templates: prev.templates.filter((t) => t.id !== t2.id).map((t) => (t.id === t1.id ? { ...t, name: 'T1-renamed' } : t)) }
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
    expect(ops).toContainEqual({ t: 'template.delete', id: t2.id })
    expect(ops.some((o) => o.t === 'template.update' && o.id === t1.id)).toBe(true)
  })

  it('a brand-new template with icon and fields round-trips', () => {
    const prev = empty
    const next = {
      ...empty,
      templates: [{ id: 't-x', name: 'X', icon: 'server', fields: [{ key: 'k', default: 'v' }] }],
    }
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })

  it('diagram add/rename/delete', () => {
    const d1 = addDiagram(empty, 'One', 'canvas')
    const d2 = addDiagram(d1.model, 'Two', 'canvas')
    const prev = d2.model
    let next = renameDiagram(prev, d1.id, 'One-renamed')
    next = deleteDiagram(next, d2.id)
    next = addDiagram(next, 'Three', 'topology').model
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
    expect(ops).toContainEqual({ t: 'diagram.rename', id: d1.id, name: 'One-renamed' })
    expect(ops).toContainEqual({ t: 'diagram.delete', id: d2.id })
  })

  it('groups, notes, and edges add/update/remove within a diagram', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    let prev = addGroup(created.model, did, { id: 'g1', label: 'G1', color: '#fff', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } })
    prev = addNote(prev, did, { id: 'n1', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, text: 'hi' })
    prev = addEdge(prev, did, { id: 'ed1', from: 'e1', to: 'e2', type: 'talks-to' })
    const next = {
      ...prev,
      diagrams: prev.diagrams.map((d) =>
        d.id !== did
          ? d
          : {
              ...d,
              groups: d.groups.map((g) => (g.id === 'g1' ? { ...g, label: 'G1-changed' } : g)),
              notes: d.notes.filter((n) => n.id !== 'n1'),
              edges: [...d.edges, { id: 'ed2', from: 'e2', to: 'e3', type: 'talks-to' as const }],
            },
      ),
    }
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })

  it('placement fieldShow diffs emit placement.fieldShow per changed key, undefined when removed', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    const prev = addPlacement(created.model, did, { entityId: 'e1', position: { x: 0, y: 0 }, fieldShow: { a: true, b: false } })
    const next = setFieldShow(setFieldShow(prev, did, 'e1', 'a', undefined), did, 'e1', 'c', true)
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
    expect(ops).toContainEqual({ t: 'placement.fieldShow', diagramId: did, entityId: 'e1', key: 'a', value: undefined })
    expect(ops).toContainEqual({ t: 'placement.fieldShow', diagramId: did, entityId: 'e1', key: 'c', value: true })
  })

  it('placement add and remove within an existing diagram', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    const prev = addPlacement(created.model, did, { entityId: 'e1', position: { x: 0, y: 0 } })
    let next = addPlacement(prev, did, { entityId: 'e2', position: { x: 1, y: 1 } })
    next = {
      ...next,
      diagrams: next.diagrams.map((d) => (d.id !== did ? d : { ...d, placements: d.placements.filter((p) => p.entityId !== 'e1') })),
    }
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })
})

describe('diffDiagramContents (exported)', () => {
  it('emits a single placement.set for a moved node', () => {
    const prev = {
      placements: [{ entityId: 'e1', position: { x: 0, y: 0 } }],
      groups: [], edges: [], notes: [],
    }
    const next = {
      placements: [{ entityId: 'e1', position: { x: 100, y: 40 } }],
      groups: [], edges: [], notes: [],
    }
    expect(diffDiagramContents('d1', prev, next)).toEqual([
      { t: 'placement.set', diagramId: 'd1', entityId: 'e1', patch: { position: { x: 100, y: 40 } } },
    ])
  })
})
