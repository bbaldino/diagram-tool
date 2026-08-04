import { describe, it, expect } from 'vitest'
import { diffToOps, diffDiagramContents } from './diff'
import { applyOps } from './ops'
import {
  addDiagram,
  addNode,
  normalizeModel,
  getDiagram,
  updateNode,
  addTemplate,
  addGroup,
  addNote,
  addEdge,
  renameDiagram,
  deleteDiagram,
  diagramContent,
  type Model,
} from './model'

const empty: Model = normalizeModel({ version: 2, diagrams: [], templates: [] })

describe('diffToOps', () => {
  it('round-trips: applyOps(prev, diffToOps(prev,next)) deep-equals next', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    const prev = addNode(d.model, d.id, {
      id: 'n1',
      label: 'N',
      fields: [],
      position: { x: 5, y: 5 },
    })
    const next = addNode(prev, d.id, {
      id: 'n2',
      label: 'N2',
      fields: [],
      position: { x: 1, y: 1 },
    })
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })

  it('a node move emits exactly one node.update', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    const prev = addNode(created.model, did, {
      id: 'n1',
      label: 'N',
      fields: [],
      position: { x: 0, y: 0 },
    })
    const next = updateNode(prev, did, 'n1', { position: { x: 40, y: 10 } })
    const ops = diffToOps(prev, next)
    expect(ops).toEqual([
      {
        t: 'node.update',
        diagramId: did,
        id: 'n1',
        patch: { label: 'N', fields: [], position: { x: 40, y: 10 } },
      },
    ])
  })

  it('empty diff for identical models', () => {
    expect(diffToOps(empty, empty)).toEqual([])
  })

  it('node add/update/remove', () => {
    const d = addDiagram(empty, 'D', 'canvas')
    let prev = addNode(d.model, d.id, {
      id: 'n1',
      label: 'N1',
      fields: [],
      position: { x: 0, y: 0 },
    })
    prev = addNode(prev, d.id, { id: 'n2', label: 'N2', fields: [], position: { x: 0, y: 0 } })
    // n1 updated, n2 removed, n3 added
    let next = {
      ...prev,
      diagrams: prev.diagrams.map((dd) =>
        dd.id !== d.id
          ? dd
          : {
              ...dd,
              nodes: dd.nodes
                .filter((n) => n.id !== 'n2')
                .map((n) => (n.id === 'n1' ? { ...n, label: 'N1-changed' } : n)),
            },
      ),
    }
    next = addNode(next, d.id, { id: 'n3', label: 'N3', fields: [], position: { x: 0, y: 0 } })
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
    expect(ops).toContainEqual({
      t: 'node.update',
      diagramId: d.id,
      id: 'n1',
      patch: { label: 'N1-changed', fields: [], position: { x: 0, y: 0 } },
    })
    expect(ops).toContainEqual({ t: 'node.remove', diagramId: d.id, id: 'n2' })
    expect(ops).toContainEqual({
      t: 'node.add',
      diagramId: d.id,
      node: { id: 'n3', label: 'N3', fields: [], position: { x: 0, y: 0 } },
    })
  })

  it('template add/update/delete', () => {
    const t1 = addTemplate(empty, 'T1')
    const t2 = addTemplate(t1.model, 'T2')
    const prev = t2.model
    let next = {
      ...prev,
      templates: prev.templates
        .filter((t) => t.id !== t2.id)
        .map((t) => (t.id === t1.id ? { ...t, name: 'T1-renamed' } : t)),
    }
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
    let prev = addGroup(created.model, did, {
      id: 'g1',
      label: 'G1',
      color: '#fff',
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    })
    prev = addNote(prev, did, {
      id: 'n1',
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
      text: 'hi',
    })
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

  it('node add and remove within an existing diagram', () => {
    const created = addDiagram(empty, 'D', 'canvas')
    const did = created.id
    const prev = addNode(created.model, did, {
      id: 'n1',
      label: 'N1',
      fields: [],
      position: { x: 0, y: 0 },
    })
    let next = addNode(prev, did, { id: 'n2', label: 'N2', fields: [], position: { x: 1, y: 1 } })
    next = {
      ...next,
      diagrams: next.diagrams.map((d) =>
        d.id !== did ? d : { ...d, nodes: d.nodes.filter((n) => n.id !== 'n1') },
      ),
    }
    const ops = diffToOps(prev, next)
    expect(applyOps(prev, ops)).toEqual(next)
  })
})

describe('edge labelPos round-trip', () => {
  const base = {
    version: 2,
    templates: [],
    diagrams: [
      {
        id: 'd',
        name: 'D',
        title: 'D',
        type: 'canvas' as const,
        nodes: [],
        groups: [],
        edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' as const }],
        notes: [],
        flows: [],
      },
    ],
  }
  it('a labelPos change emits an edge.update patch and applyOps sets it', () => {
    const next = structuredClone(base) as any
    next.diagrams[0].edges[0].labelPos = 0.8
    const ops = diffToOps(base, next)
    expect(ops).toContainEqual(
      expect.objectContaining({
        t: 'edge.update',
        diagramId: 'd',
        id: 'e1',
        patch: expect.objectContaining({ labelPos: 0.8 }),
      }),
    )
    const applied = applyOps(base, ops)
    expect(applied.diagrams[0].edges[0].labelPos).toBe(0.8)
  })
})

describe('diffDiagramContents (exported)', () => {
  it('emits a single node.update for a moved node', () => {
    const prev = {
      nodes: [{ id: 'n1', label: 'N', fields: [], position: { x: 0, y: 0 } }],
      groups: [],
      edges: [],
      notes: [],
      flows: [],
    }
    const next = {
      nodes: [{ id: 'n1', label: 'N', fields: [], position: { x: 100, y: 40 } }],
      groups: [],
      edges: [],
      notes: [],
      flows: [],
    }
    expect(diffDiagramContents('d1', prev, next)).toEqual([
      {
        t: 'node.update',
        diagramId: 'd1',
        id: 'n1',
        patch: { label: 'N', fields: [], position: { x: 100, y: 40 } },
      },
    ])
  })

  it('emits node.add and node.remove for node set changes', () => {
    const prev = {
      nodes: [{ id: 'n1', label: 'N1', fields: [], position: { x: 0, y: 0 } }],
      groups: [],
      edges: [],
      notes: [],
      flows: [],
    }
    const next = {
      nodes: [{ id: 'n2', label: 'N2', fields: [], position: { x: 0, y: 0 } }],
      groups: [],
      edges: [],
      notes: [],
      flows: [],
    }
    const ops = diffDiagramContents('d1', prev, next)
    expect(ops).toContainEqual({ t: 'node.remove', diagramId: 'd1', id: 'n1' })
    expect(ops).toContainEqual({ t: 'node.add', diagramId: 'd1', node: next.nodes[0] })
  })
})

describe('flows data layer', () => {
  const base = {
    version: 2,
    templates: [],
    diagrams: [
      {
        id: 'd',
        name: 'D',
        title: 'D',
        type: 'canvas' as const,
        nodes: [],
        groups: [],
        edges: [],
        notes: [],
        flows: [],
      },
    ],
  }
  const flow = {
    id: 'f1',
    name: 'Doorbell',
    steps: [{ id: 's1', elementIds: ['a'], caption: 'press' }],
  }

  it('adds a flow via diff -> flow.add and applyOps', () => {
    const next = structuredClone(base)
    ;(next.diagrams[0] as any).flows = [flow]
    const ops = diffToOps(base, next)
    expect(ops).toContainEqual({ t: 'flow.add', diagramId: 'd', flow })
    expect((applyOps(base, ops).diagrams[0] as any).flows).toEqual([flow])
  })

  it('updates a flow (steps change) via flow.update patch', () => {
    const withFlow = structuredClone(base)
    ;(withFlow.diagrams[0] as any).flows = [flow]
    const next = structuredClone(withFlow)
    ;(next.diagrams[0] as any).flows[0].steps.push({
      id: 's2',
      elementIds: ['b'],
      caption: 'to cam',
    })
    const ops = diffToOps(withFlow, next)
    expect(ops.some((o) => o.t === 'flow.update' && (o as any).id === 'f1')).toBe(true)
    expect((applyOps(withFlow, ops).diagrams[0] as any).flows[0].steps).toHaveLength(2)
  })

  it('removes a flow via flow.remove', () => {
    const withFlow = structuredClone(base)
    ;(withFlow.diagrams[0] as any).flows = [flow]
    const ops = diffToOps(withFlow, base)
    expect(ops).toContainEqual({ t: 'flow.remove', diagramId: 'd', id: 'f1' })
    expect((applyOps(withFlow, ops).diagrams[0] as any).flows).toEqual([])
  })

  it('diagramContent includes flows (undo snapshot)', () => {
    const d = { ...base.diagrams[0], flows: [flow] }
    expect(diagramContent(d as any).flows).toEqual([flow])
  })
})

describe('clearing an optional field', () => {
  const model = (color?: string) =>
    ({
      version: 2,
      templates: [],
      diagrams: [
        {
          id: 'd',
          name: 'D',
          title: 'D',
          type: 'canvas',
          groups: [],
          notes: [],
          edges: [],
          flows: [],
          nodes: [
            {
              id: 'n1',
              label: 'Plex',
              fields: [],
              position: { x: 0, y: 0 },
              ...(color ? { color } : {}),
            },
          ],
        },
      ],
    }) as never

  it('emits null for a field that was present and is now absent', () => {
    const ops = diffToOps(model('#3b82f6'), model())
    const patch = (ops[0] as never as { patch: Record<string, unknown> }).patch
    expect(patch.color).toBeNull()
  })

  it('survives JSON serialisation, which undefined does not', () => {
    const ops = diffToOps(model('#3b82f6'), model())
    const wire = JSON.parse(JSON.stringify(ops))
    expect((wire[0] as { patch: Record<string, unknown> }).patch).toHaveProperty('color', null)
  })

  it('round-trips to a genuinely absent field, not null and not the old value', () => {
    const before = model('#3b82f6')
    const ops = JSON.parse(JSON.stringify(diffToOps(before, model())))
    const after = applyOps(before, ops) as never as {
      diagrams: { nodes: { color?: string | null }[] }[]
    }
    const node = after.diagrams[0].nodes[0]
    expect('color' in node).toBe(false)
    expect(node.color).toBeUndefined()
  })

  it('leaves an existing colour untouched when the patch does not mention it', () => {
    const before = model('#3b82f6')
    const renamed = JSON.parse(JSON.stringify(before))
    renamed.diagrams[0].nodes[0].label = 'Renamed'
    const ops = JSON.parse(JSON.stringify(diffToOps(before, renamed)))
    const after = applyOps(before, ops) as never as {
      diagrams: { nodes: { label: string; color?: string }[] }[]
    }
    expect(after.diagrams[0].nodes[0].color).toBe('#3b82f6')
    expect(after.diagrams[0].nodes[0].label).toBe('Renamed')
  })
})

// Group.color is required and can never be cleared, but Group.parentId is
// optional (dragging a nested group out to top level clears it). This
// mirrors the Node.color suite above but exercises updateGroup, which was
// left on a plain spread on the (wrong) theory that groups have nothing
// clearable.
describe('clearing an optional field on a group', () => {
  const model = (parentId?: string) =>
    ({
      version: 2,
      templates: [],
      diagrams: [
        {
          id: 'd',
          name: 'D',
          title: 'D',
          type: 'canvas',
          notes: [],
          edges: [],
          flows: [],
          nodes: [],
          groups: [
            {
              id: 'g1',
              label: 'Inner',
              color: '#64748b',
              position: { x: 0, y: 0 },
              size: { width: 200, height: 120 },
              ...(parentId ? { parentId } : {}),
            },
          ],
        },
      ],
    }) as never

  it('emits null for a parentId that was present and is now absent', () => {
    const ops = diffToOps(model('g0'), model())
    const patch = (ops[0] as never as { patch: Record<string, unknown> }).patch
    expect(patch.parentId).toBeNull()
  })

  it('round-trips to a genuinely absent parentId, not null and not the old value', () => {
    const before = model('g0')
    const ops = JSON.parse(JSON.stringify(diffToOps(before, model())))
    const after = applyOps(before, ops) as never as {
      diagrams: { groups: { parentId?: string | null }[] }[]
    }
    const group = after.diagrams[0].groups[0]
    expect('parentId' in group).toBe(false)
    expect(group.parentId).toBeUndefined()
  })

  it('leaves an existing parentId untouched when the patch does not mention it', () => {
    const before = model('g0')
    const renamed = JSON.parse(JSON.stringify(before))
    renamed.diagrams[0].groups[0].label = 'Renamed'
    const ops = JSON.parse(JSON.stringify(diffToOps(before, renamed)))
    const after = applyOps(before, ops) as never as {
      diagrams: { groups: { label: string; parentId?: string }[] }[]
    }
    expect(after.diagrams[0].groups[0].parentId).toBe('g0')
    expect(after.diagrams[0].groups[0].label).toBe('Renamed')
  })
})
