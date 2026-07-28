import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { handlers, createMcpServer, edgeAttrsShape, wrap } from './mcp'
import { createStore, type Store } from './store'
import { getDiagram } from '../src/model'

const mkStore = (): Promise<Store> =>
  createStore({
    file: 'x',
    load: async () => ({
      version: 1,
      entities: [
        { id: 'plex', label: 'Plex', icon: 'plex', status: 'up', fields: [] },
        { id: 'sonarr', label: 'Sonarr', fields: [] },
      ],
      diagrams: [],
      templates: [],
    }),
    save: async () => {},
  })

describe('handlers', () => {
  describe('reads', () => {
    it('listEntities returns the catalog', async () => {
      const store = await mkStore()
      const ents = handlers.listEntities(store)
      expect(ents.map((e) => e.id)).toContain('plex')
      const plex = ents.find((e) => e.id === 'plex')!
      expect(plex.label).toBe('Plex')
      expect(plex.icon).toBe('plex')
      expect(plex.status).toBe('up')
    })

    it('listDiagrams returns id/name/type', async () => {
      const store = await mkStore()
      await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })
      const ds = handlers.listDiagrams(store)
      expect(ds).toHaveLength(1)
      expect(ds[0]).toMatchObject({ name: 'Flow', type: 'canvas' })
    })

    it('getDiagram returns the diagram or an error', async () => {
      const store = await mkStore()
      const res = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as { diagramId: string }
      const d = handlers.getDiagram(store, res.diagramId)
      expect('error' in d).toBe(false)
      expect((d as { id: string }).id).toBe(res.diagramId)
      expect('error' in handlers.getDiagram(store, 'nope')).toBe(true)
    })
  })

  describe('authorDiagram', () => {
    it('creates a laid-out diagram in the store', async () => {
      const store = await mkStore()
      const res = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', { new: 'Grafana' }],
        edges: [['plex', 'grafana']],
      })) as { diagramId: string }
      const d = store.getState().model.diagrams.find((x) => x.id === res.diagramId)!
      expect(d.placements.map((p) => p.entityId).sort()).toEqual(['grafana', 'plex'])
      expect(d.edges).toHaveLength(1)
      // laid out: source left of target
      const px = d.placements.find((p) => p.entityId === 'plex')!.position.x
      const gx = d.placements.find((p) => p.entityId === 'grafana')!.position.x
      expect(px).toBeLessThan(gx)
    })

    it('returns { error } and leaves rev unchanged on a bad spec', async () => {
      const store = await mkStore()
      const rev0 = store.getState().rev
      const r = await handlers.authorDiagram(store, { name: 'Bad', nodes: ['ghost'] })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })
  })

  describe('writes', () => {
    it('placeEntity adds a placement', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
        diagramId: string
      }
      const r = handlers.placeEntity(store, { diagramId, entityId: 'sonarr', position: { x: 10, y: 20 } })
      expect(r).toEqual({ ok: true })
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      expect(d.placements.some((p) => p.entityId === 'sonarr')).toBe(true)
    })

    it('placeEntity errors for an unknown entity', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
        diagramId: string
      }
      const rev0 = store.getState().rev
      expect('error' in handlers.placeEntity(store, { diagramId, entityId: 'ghost' })).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })

    it('placeEntity errors for a parentId that is not a group, leaving rev unchanged', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
        diagramId: string
      }
      const rev0 = store.getState().rev
      const r = handlers.placeEntity(store, { diagramId, entityId: 'sonarr', parentId: 'no-such-group' })
      expect('error' in r).toBe(true)
      expect((r as { error: string }).error).toBe('unknown group id "no-such-group"')
      expect(store.getState().rev).toBe(rev0)
      // and no placement was applied
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      expect(d.placements.some((p) => p.entityId === 'sonarr')).toBe(false)
    })

    it('connect adds an edge', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', 'sonarr'],
      })) as { diagramId: string }
      const r = handlers.connect(store, { diagramId, from: 'plex', to: 'sonarr', label: 'talks' })
      expect(r).toEqual({ ok: true })
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const e = d.edges.find((x) => x.from === 'plex' && x.to === 'sonarr')!
      expect(e.label).toBe('talks')
    })

    it('connect with only {from,to} succeeds and defaults edge type to talks-to', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', 'sonarr'],
      })) as { diagramId: string }
      const r = handlers.connect(store, { diagramId, from: 'plex', to: 'sonarr' })
      expect(r).toEqual({ ok: true })
      const d = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const e = d.edges.find((x) => x.from === 'plex' && x.to === 'sonarr')!
      expect(e.type).toBe('talks-to')
    })

    it('connect on a missing diagram errors, store unchanged', async () => {
      const store = await mkStore()
      const rev0 = store.getState().rev
      const r = handlers.connect(store, { diagramId: 'nope', from: 'a', to: 'b' })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })

    it('setEdge updates an edge', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', 'sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      const r = handlers.setEdge(store, { diagramId, edgeId, patch: { label: 'renamed' } })
      expect(r).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].label).toBe('renamed')
      expect('error' in handlers.setEdge(store, { diagramId, edgeId: 'nope', patch: {} })).toBe(true)
    })

    it('setEdge with {color,label} updates only those fields, leaving type unchanged and no stray keys', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', 'sonarr'],
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

    it('setNote sets an inline note on a placement', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
        diagramId: string
      }
      const r = handlers.setNote(store, { diagramId, entityId: 'plex', note: '4k' })
      expect(r).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.placements[0].note).toBe('4k')
      expect('error' in handlers.setNote(store, { diagramId, entityId: 'ghost', note: 'x' })).toBe(true)
    })

    it('remove deletes a placement and an edge', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['plex', 'sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      expect(handlers.remove(store, { diagramId, edgeId })).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges).toHaveLength(0)
      expect(handlers.remove(store, { diagramId, entityId: 'sonarr' })).toEqual({ ok: true })
      expect(
        store.getState().model.diagrams.find((x) => x.id === diagramId)!.placements.some((p) => p.entityId === 'sonarr'),
      ).toBe(false)
      expect('error' in handlers.remove(store, { diagramId })).toBe(true)
    })

    it('layout re-lays-out a diagram', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
        diagramId: string
      }
      // move the placement to a nonsense spot, then re-layout
      handlers.placeEntity(store, { diagramId, entityId: 'sonarr', position: { x: 9999, y: 9999 } })
      const r = await handlers.layout(store, diagramId)
      expect(r).toEqual({ ok: true })
      expect('error' in (await handlers.layout(store, 'nope'))).toBe(true)
    })

    it('layout accepts the graphviz engine without throwing', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['plex'] })) as {
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
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['plex', 'sonarr'],
    })) as { diagramId: string }
    handlers.connect(store, { diagramId, from: 'plex', to: 'sonarr', orientation: 'vertical' })
    const edge = getDiagram(store.getState().model, diagramId)!.edges.find((e) => e.from === 'plex' && e.to === 'sonarr')!
    expect(edge.orientation).toBe('vertical')
  })

  it('set_edge patch updates orientation', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['plex', 'sonarr'],
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

  it('registers tool names in snake_case per the spec', async () => {
    const store = await mkStore()
    const server = createMcpServer(store)
    // _registeredTools is keyed by the external tool name.
    const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools)
    expect(names).toContain('author_diagram')
    expect(names).toContain('place_entity')
    expect(names).toContain('list_entities')
    expect(names).toContain('get_diagram')
    // camelCase names must NOT be registered externally.
    expect(names).not.toContain('authorDiagram')
    expect(names).not.toContain('placeEntity')
  })
})

describe('author_flow', () => {
  const mkFlowStore = (): Promise<Store> =>
    createStore({
      file: 'x',
      load: async () => ({
        version: 1,
        entities: [
          { id: 'a', label: 'A', fields: [] },
          { id: 'b', label: 'B', fields: [] },
        ],
        diagrams: [
          {
            id: 'd',
            name: 'D',
            title: 'D',
            type: 'canvas',
            placements: [
              { entityId: 'a', position: { x: 0, y: 0 } },
              { entityId: 'b', position: { x: 100, y: 0 } },
            ],
            groups: [],
            edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' }],
            notes: [],
          },
        ],
        templates: [],
      }),
      save: async () => {},
    })

  it('creates a flow, resolving ids and {from,to} edge refs', async () => {
    const store = await mkFlowStore()
    handlers.authorFlow(store, {
      diagramId: 'd',
      name: 'F',
      steps: [
        { elements: ['a'], caption: 'press' },
        { elements: [{ from: 'a', to: 'b' }, 'b'], caption: 'to b' },
      ],
    })
    const d = getDiagram(store.getState().model, 'd')!
    const flows = d.flows!
    const f = flows[flows.length - 1]
    expect(f.name).toBe('F')
    expect(f.steps[0].elementIds).toEqual(['a'])
    expect(f.steps[1].elementIds).toEqual(['e1', 'b']) // {from:a,to:b} resolved to e1
  })

  it('rejects an unknown element ref', async () => {
    const store = await mkFlowStore()
    const res = handlers.authorFlow(store, { diagramId: 'd', name: 'X', steps: [{ elements: ['nope'] }] })
    expect('error' in res).toBe(true)
  })

  it('rejects an unresolvable edge ref', async () => {
    const store = await mkFlowStore()
    const res = handlers.authorFlow(store, { diagramId: 'd', name: 'X', steps: [{ elements: [{ from: 'a', to: 'zzz' }] }] })
    expect('error' in res).toBe(true)
  })
})

describe('flow granular tools', () => {
  const mkFlowStore = (): Promise<Store> =>
    createStore({
      file: 'x',
      load: async () => ({
        version: 1,
        entities: [
          { id: 'a', label: 'A', fields: [] },
          { id: 'b', label: 'B', fields: [] },
        ],
        diagrams: [
          {
            id: 'd',
            name: 'D',
            title: 'D',
            type: 'canvas',
            placements: [
              { entityId: 'a', position: { x: 0, y: 0 } },
              { entityId: 'b', position: { x: 100, y: 0 } },
            ],
            groups: [],
            edges: [{ id: 'e1', from: 'a', to: 'b', type: 'talks-to' }],
            notes: [],
          },
        ],
        templates: [],
      }),
      save: async () => {},
    })

  it('add/set/remove step, rename, delete a flow', async () => {
    const store = await mkFlowStore()
    const { flowId } = handlers.authorFlow(store, { diagramId: 'd', name: 'F', steps: [{ elements: ['a'] }] }) as { flowId: string }
    handlers.addFlowStep(store, { diagramId: 'd', flowId, elements: ['b'], caption: 'two' })
    let f = getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)!
    expect(f.steps).toHaveLength(2)
    const stepId = f.steps[1].id
    handlers.setFlowStep(store, { diagramId: 'd', flowId, stepId, patch: { caption: 'edited' } })
    handlers.removeFlowStep(store, { diagramId: 'd', flowId, stepId })
    handlers.renameFlow(store, { diagramId: 'd', flowId, name: 'F2' })
    f = getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)!
    expect(f.name).toBe('F2'); expect(f.steps).toHaveLength(1)
    handlers.deleteFlow(store, { diagramId: 'd', flowId })
    expect(getDiagram(store.getState().model, 'd')!.flows!.find((x) => x.id === flowId)).toBeUndefined()
  })
  it('get_diagram surfaces flows and edge ids', async () => {
    const store = await mkFlowStore()
    const { flowId } = handlers.authorFlow(store, { diagramId: 'd', name: 'G', steps: [{ elements: [{ from: 'a', to: 'b' }] }] }) as { flowId: string }
    const d = handlers.getDiagram(store, 'd') as any
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
