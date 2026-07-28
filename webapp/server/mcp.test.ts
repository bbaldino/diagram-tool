import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { handlers, createMcpServer, edgeAttrsShape, wrap } from './mcp'
import { createStore, type Store } from './store'
import { getDiagram } from '../src/model'

const mkStore = (): Promise<Store> =>
  createStore({
    file: 'x',
    load: async () => ({ version: 2, diagrams: [], templates: [] }),
    save: async () => {},
  })

describe('handlers', () => {
  describe('reads', () => {
    it('listDiagrams returns id/name/type', async () => {
      const store = await mkStore()
      await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })
      const ds = handlers.listDiagrams(store)
      expect(ds).toHaveLength(1)
      expect(ds[0]).toMatchObject({ name: 'Flow', type: 'canvas' })
    })

    it('listNodes returns the nodes created in a diagram', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: [{ label: 'Plex', icon: 'plex' }],
      })) as { diagramId: string; nodeIds: string[] }
      const ns = handlers.listNodes(store, diagramId)
      expect(ns).toEqual([{ id: nodeIds[0], label: 'Plex', icon: 'plex', status: undefined }])
      expect('error' in handlers.listNodes(store, 'nope')).toBe(true)
    })

    it('getDiagram returns the diagram or an error', async () => {
      const store = await mkStore()
      const res = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as { diagramId: string }
      const d = handlers.getDiagram(store, res.diagramId)
      expect('error' in d).toBe(false)
      expect((d as { id: string }).id).toBe(res.diagramId)
      expect('error' in handlers.getDiagram(store, 'nope')).toBe(true)
    })
  })

  describe('authorDiagram', () => {
    it('creates a laid-out diagram in the store and returns the minted node uuids', async () => {
      const store = await mkStore()
      const res = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', { label: 'Grafana' }],
        edges: [['plex', 'grafana']],
      })) as { diagramId: string; nodeIds: string[] }
      expect(res.nodeIds).toHaveLength(2)
      const d = store.getState().model.diagrams.find((x) => x.id === res.diagramId)!
      expect(d.nodes.map((n) => n.id).sort()).toEqual([...res.nodeIds].sort())
      expect(d.edges).toHaveLength(1)
      const [plexId, grafanaId] = res.nodeIds
      expect(d.edges[0]).toMatchObject({ from: plexId, to: grafanaId })
      // laid out: source left of target
      const px = d.nodes.find((n) => n.id === plexId)!.position.x
      const gx = d.nodes.find((n) => n.id === grafanaId)!.position.x
      expect(px).toBeLessThan(gx)
    })

    it('returns { error } and leaves rev unchanged on a bad spec', async () => {
      const store = await mkStore()
      const rev0 = store.getState().rev
      const r = await handlers.authorDiagram(store, { name: 'Bad', nodes: ['A'], edges: [['a', 'ghost']] })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })
  })

  describe('writes', () => {
    it('addNode creates a node and returns its uuid', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
      const r = handlers.addNode(store, { diagramId, label: 'Sonarr', position: { x: 10, y: 20 } })
      expect('id' in r).toBe(true)
      const id = (r as { id: string }).id
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const node = d.nodes.find((n) => n.id === id)!
      expect(node.label).toBe('Sonarr')
      expect(node.position).toEqual({ x: 10, y: 20 })
    })

    it('addNode errors on an unknown diagram', async () => {
      const store = await mkStore()
      const rev0 = store.getState().rev
      const r = handlers.addNode(store, { diagramId: 'nope', label: 'X' })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })

    it('addNode errors for a parentId that is not a group, leaving rev unchanged', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
      const rev0 = store.getState().rev
      const r = handlers.addNode(store, { diagramId, label: 'Sonarr', parentId: 'no-such-group' })
      expect('error' in r).toBe(true)
      expect((r as { error: string }).error).toBe('unknown group id "no-such-group"')
      expect(store.getState().rev).toBe(rev0)
    })

    it('connect adds an edge and returns its uuid', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
      })) as { diagramId: string; nodeIds: string[] }
      const [plexId, sonarrId] = nodeIds
      const r = handlers.connect(store, { diagramId, from: plexId, to: sonarrId, label: 'talks' })
      expect('id' in r).toBe(true)
      const edgeId = (r as { id: string }).id
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const e = d.edges.find((x) => x.id === edgeId)!
      expect(e.label).toBe('talks')
      expect(e.from).toBe(plexId)
      expect(e.to).toBe(sonarrId)
    })

    it('connect with only {from,to} succeeds and defaults edge type to talks-to', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
      })) as { diagramId: string; nodeIds: string[] }
      const [plexId, sonarrId] = nodeIds
      const r = handlers.connect(store, { diagramId, from: plexId, to: sonarrId })
      expect('id' in r).toBe(true)
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const e = d.edges.find((x) => x.id === (r as { id: string }).id)!
      expect(e.type).toBe('talks-to')
    })

    it('connect on a missing diagram errors, store unchanged', async () => {
      const store = await mkStore()
      const rev0 = store.getState().rev
      const r = handlers.connect(store, { diagramId: 'nope', from: 'a', to: 'b' })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })

    it('connect errors when an endpoint node does not exist', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as { diagramId: string; nodeIds: string[] }
      const r = handlers.connect(store, { diagramId, from: nodeIds[0], to: 'ghost' })
      expect('error' in r).toBe(true)
    })

    it('setEdge updates an edge', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string; nodeIds: string[] }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      const r = handlers.setEdge(store, { diagramId, edgeId, patch: { label: 'renamed' } })
      expect(r).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].label).toBe('renamed')
      expect('error' in handlers.setEdge(store, { diagramId, edgeId: 'nope', patch: {} })).toBe(true)
      void nodeIds
    })

    it('setEdge with {color,label} updates only those fields, leaving type unchanged and no stray keys', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string }
      const diagram = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const edgeId = diagram.edges[0].id
      const originalType = diagram.edges[0].type
      const r = handlers.setEdge(store, { diagramId, edgeId, patch: { color: '#fff', label: 'renamed' } })
      expect(r).toEqual({ ok: true })
      const updated = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0]
      expect(updated.color).toBe('#fff')
      expect(updated.label).toBe('renamed')
      expect(updated.type).toBe(originalType)
      expect(Object.keys(updated).sort()).toEqual(['color', 'from', 'id', 'label', 'sourceHandle', 'targetHandle', 'to', 'type'])
    })

    it('edgeAttrsShape (shared by connect and setEdge) strips unknown keys and rejects a bad type field', () => {
      const schema = z.object(edgeAttrsShape)
      const parsed = schema.parse({ color: '#fff', bogus: 1 })
      expect(parsed).not.toHaveProperty('bogus')
      expect(parsed).toEqual({ color: '#fff' })
      expect('type' in edgeAttrsShape).toBe(false)
    })

    it('setNote creates a new sticky note and returns its uuid', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
      const r = handlers.setNote(store, { diagramId, text: '4k', position: { x: 5, y: 5 } })
      expect('id' in r).toBe(true)
      const id = (r as { id: string }).id
      const note = store.getState().model.diagrams.find((x) => x.id === diagramId)!.notes.find((n) => n.id === id)!
      expect(note.text).toBe('4k')
      expect('error' in handlers.setNote(store, { diagramId: 'nope', text: 'x' })).toBe(true)
    })

    it('setNote updates an existing note when given an id', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
      const { id } = handlers.setNote(store, { diagramId, text: 'first' }) as { id: string }
      const r = handlers.setNote(store, { diagramId, id, text: 'second' })
      expect(r).toEqual({ ok: true })
      const note = store.getState().model.diagrams.find((x) => x.id === diagramId)!.notes.find((n) => n.id === id)!
      expect(note.text).toBe('second')
      expect('error' in handlers.setNote(store, { diagramId, id: 'ghost', text: 'x' })).toBe(true)
    })

    it('remove deletes a node, an edge, and a note', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string; nodeIds: string[] }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      const { id: noteId } = handlers.setNote(store, { diagramId, text: 'x' }) as { id: string }
      expect(handlers.remove(store, { diagramId, edgeId })).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges).toHaveLength(0)
      expect(handlers.remove(store, { diagramId, noteId })).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.notes).toHaveLength(0)
      expect(handlers.remove(store, { diagramId, nodeId: nodeIds[1] })).toEqual({ ok: true })
      expect(
        store.getState().model.diagrams.find((x) => x.id === diagramId)!.nodes.some((n) => n.id === nodeIds[1]),
      ).toBe(false)
      expect('error' in handlers.remove(store, { diagramId })).toBe(true)
    })

    it('layout re-lays-out a diagram', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
        nodeIds: string[]
      }
      // move the node to a nonsense spot, then re-layout
      handlers.addNode(store, { diagramId, label: 'Sonarr', position: { x: 9999, y: 9999 } })
      const r = await handlers.layout(store, diagramId)
      expect(r).toEqual({ ok: true })
      expect('error' in (await handlers.layout(store, 'nope'))).toBe(true)
      void nodeIds
    })

    it('layout accepts the graphviz engine without throwing', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
      const r = await handlers.layout(store, diagramId, 'graphviz')
      expect(r).toEqual({ ok: true })
    })
  })
})

describe('edge orientation', () => {
  it('connect stores orientation on the edge', async () => {
    const store = await mkStore()
    const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Plex', 'Sonarr'],
    })) as { diagramId: string; nodeIds: string[] }
    const [plexId, sonarrId] = nodeIds
    handlers.connect(store, { diagramId, from: plexId, to: sonarrId, orientation: 'vertical' })
    const edge = getDiagram(store.getState().model, diagramId)!.edges.find((e) => e.from === plexId && e.to === sonarrId)!
    expect(edge.orientation).toBe('vertical')
  })

  it('set_edge patch updates orientation', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Plex', 'Sonarr'],
      edges: [['plex', 'sonarr']],
    })) as { diagramId: string }
    const edgeId = getDiagram(store.getState().model, diagramId)!.edges[0].id
    handlers.setEdge(store, { diagramId, edgeId, patch: { orientation: 'horizontal' } })
    const edge = getDiagram(store.getState().model, diagramId)!.edges.find((e) => e.id === edgeId)!
    expect(edge.orientation).toBe('horizontal')
  })

  it('the edge-attrs zod shape rejects an invalid orientation', () => {
    const parsed = z.object(edgeAttrsShape).safeParse({ orientation: 'sideways' })
    expect(parsed.success).toBe(false)
  })

  it('the edge-attrs zod shape accepts a valid orientation', () => {
    const parsed = z.object(edgeAttrsShape).safeParse({ orientation: 'auto' })
    expect(parsed.success).toBe(true)
  })
})

describe('createMcpServer', () => {
  it('registers tools without throwing', async () => {
    const store = await mkStore()
    const server = createMcpServer(store)
    expect(server).toBeTruthy()
    expect(typeof server.connect).toBe('function')
  })

  it('registers tool names in snake_case per the spec, renamed from entity to node', async () => {
    const store = await mkStore()
    const server = createMcpServer(store)
    // _registeredTools is keyed by the external tool name.
    const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools)
    expect(names).toContain('author_diagram')
    expect(names).toContain('add_node')
    expect(names).toContain('list_nodes')
    expect(names).toContain('get_diagram')
    // old entity-era tool names must NOT be registered
    expect(names).not.toContain('place_entity')
    expect(names).not.toContain('list_entities')
    // camelCase names must NOT be registered externally.
    expect(names).not.toContain('authorDiagram')
    expect(names).not.toContain('addNode')
  })
})

describe('author_flow', () => {
  const mkFlowStore = async (): Promise<{ store: Store; diagramId: string; a: string; b: string }> => {
    const store = await mkStore()
    const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
      name: 'D',
      nodes: ['A', 'B'],
      edges: [['a', 'b']],
    })) as { diagramId: string; nodeIds: string[] }
    return { store, diagramId, a: nodeIds[0], b: nodeIds[1] }
  }

  it('creates a flow, resolving ids and {from,to} edge refs', async () => {
    const { store, diagramId, a, b } = await mkFlowStore()
    handlers.authorFlow(store, {
      diagramId,
      name: 'F',
      steps: [
        { elements: [a], caption: 'press' },
        { elements: [{ from: a, to: b }, b], caption: 'to b' },
      ],
    })
    const d = getDiagram(store.getState().model, diagramId)!
    const flows = d.flows!
    const f = flows[flows.length - 1]
    const edgeId = d.edges.find((e) => e.from === a && e.to === b)!.id
    expect(f.name).toBe('F')
    expect(f.steps[0].elementIds).toEqual([a])
    expect(f.steps[1].elementIds).toEqual([edgeId, b]) // {from:a,to:b} resolved to the edge id
  })

  it('rejects an unknown element ref', async () => {
    const { store, diagramId } = await mkFlowStore()
    const res = handlers.authorFlow(store, { diagramId, name: 'X', steps: [{ elements: ['nope'] }] })
    expect('error' in res).toBe(true)
  })

  it('rejects an unresolvable edge ref', async () => {
    const { store, diagramId, a } = await mkFlowStore()
    const res = handlers.authorFlow(store, { diagramId, name: 'X', steps: [{ elements: [{ from: a, to: 'zzz' }] }] })
    expect('error' in res).toBe(true)
  })
})

describe('flow granular tools', () => {
  const mkFlowStore = async (): Promise<{ store: Store; diagramId: string; a: string; b: string }> => {
    const store = await mkStore()
    const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
      name: 'D',
      nodes: ['A', 'B'],
      edges: [['a', 'b']],
    })) as { diagramId: string; nodeIds: string[] }
    return { store, diagramId, a: nodeIds[0], b: nodeIds[1] }
  }

  it('add/set/remove step, rename, delete a flow', async () => {
    const { store, diagramId, a, b } = await mkFlowStore()
    const { flowId } = handlers.authorFlow(store, { diagramId, name: 'F', steps: [{ elements: [a] }] }) as { flowId: string }
    handlers.addFlowStep(store, { diagramId, flowId, elements: [b], caption: 'two' })
    let f = getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId)!
    expect(f.steps).toHaveLength(2)
    const stepId = f.steps[1].id
    handlers.setFlowStep(store, { diagramId, flowId, stepId, patch: { caption: 'edited' } })
    handlers.removeFlowStep(store, { diagramId, flowId, stepId })
    handlers.renameFlow(store, { diagramId, flowId, name: 'F2' })
    f = getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId)!
    expect(f.name).toBe('F2'); expect(f.steps).toHaveLength(1)
    handlers.deleteFlow(store, { diagramId, flowId })
    expect(getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId)).toBeUndefined()
  })
  it('get_diagram surfaces flows and edge ids', async () => {
    const { store, diagramId, a, b } = await mkFlowStore()
    const { flowId } = handlers.authorFlow(store, { diagramId, name: 'G', steps: [{ elements: [{ from: a, to: b }] }] }) as { flowId: string }
    const d = handlers.getDiagram(store, diagramId) as any
    expect(d.flows.find((f: any) => f.id === flowId)).toBeTruthy()
    expect(d.edges[0].id).toBeTruthy()
  })
})

describe('wrap', () => {
  it('marks a handler error result with isError: true', () => {
    const res = wrap({ error: 'unknown diagram "nope"' })
    expect(res.isError).toBe(true)
    expect(JSON.parse(res.content[0].text)).toEqual({ error: 'unknown diagram "nope"' })
  })

  it('does not set isError on a successful result', () => {
    const res = wrap({ ok: true })
    expect('isError' in res).toBe(false)
    expect(JSON.parse(res.content[0].text)).toEqual({ ok: true })
  })
})
