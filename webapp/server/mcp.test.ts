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
      const res = (await handlers.authorDiagram(store, { name: 'Flow', nodes: ['Plex'] })) as {
        diagramId: string
      }
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
      const r = await handlers.authorDiagram(store, {
        name: 'Bad',
        nodes: ['A'],
        edges: [['a', 'ghost']],
      })
      expect('error' in r).toBe(true)
      expect(store.getState().rev).toBe(rev0)
    })
  })

  describe('writes', () => {
    it('addNode creates a node and returns its uuid', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
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
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const rev0 = store.getState().rev
      const r = handlers.addNode(store, { diagramId, label: 'Sonarr', parentId: 'no-such-group' })
      expect('error' in r).toBe(true)
      expect((r as { error: string }).error).toBe('unknown group id "no-such-group"')
      expect(store.getState().rev).toBe(rev0)
    })

    it('addNode with parentId places the child non-overlapping and grows the group via reflow — same as editNode reparent', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Seed'],
      })) as {
        diagramId: string
      }
      const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
        id: string
      }
      const before = getDiagram(store.getState().model, diagramId)!.groups.find(
        (g) => g.id === groupId,
      )!

      // first child: no explicit position → landed at the group's padded top-left, not (0,0) over the title.
      const { id: nodeA } = handlers.addNode(store, {
        diagramId,
        label: 'Plex',
        parentId: groupId,
      }) as { id: string }
      const a = getDiagram(store.getState().model, diagramId)!.nodes.find((n) => n.id === nodeA)!
      expect(a.parentId).toBe(groupId)
      expect(a.position).toEqual({ x: 16, y: 40 }) // GROUP_PAD x, GROUP_NEST_TOP_PAD y

      // second child: placed beside its sibling (not stacked on top), and the group grows to fit both.
      const { id: nodeB } = handlers.addNode(store, {
        diagramId,
        label: 'Sonarr',
        parentId: groupId,
      }) as { id: string }
      const d = getDiagram(store.getState().model, diagramId)!
      const b = d.nodes.find((n) => n.id === nodeB)!
      expect(b.parentId).toBe(groupId)
      expect(b.position.x).toBeGreaterThan(a.position.x)
      const group = d.groups.find((g) => g.id === groupId)!
      expect(group.size.width).toBeGreaterThan(before.size.width)
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

    it('editEdge updates an edge', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string; nodeIds: string[] }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      const r = handlers.editEdge(store, { diagramId, edgeId, patch: { label: 'renamed' } })
      expect(r).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].label).toBe(
        'renamed',
      )
      expect('error' in handlers.editEdge(store, { diagramId, edgeId: 'nope', patch: {} })).toBe(
        true,
      )
      void nodeIds
    })

    it('editEdge with {color,label} updates only those fields, leaving type unchanged and no stray keys', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string }
      const diagram = store.getState().model.diagrams.find((x) => x.id === diagramId)!
      const edgeId = diagram.edges[0].id
      const originalType = diagram.edges[0].type
      const r = handlers.editEdge(store, {
        diagramId,
        edgeId,
        patch: { color: '#fff', label: 'renamed' },
      })
      expect(r).toEqual({ ok: true })
      const updated = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0]
      expect(updated.color).toBe('#fff')
      expect(updated.label).toBe('renamed')
      expect(updated.type).toBe(originalType)
      expect(Object.keys(updated).sort()).toEqual([
        'color',
        'from',
        'id',
        'label',
        'sourceHandle',
        'targetHandle',
        'to',
        'type',
      ])
    })

    it('edgeAttrsShape (shared by connect and editEdge) strips unknown keys and rejects a bad type field', () => {
      const schema = z.object(edgeAttrsShape)
      const parsed = schema.parse({ color: '#fff', bogus: 1 })
      expect(parsed).not.toHaveProperty('bogus')
      expect(parsed).toEqual({ color: '#fff' })
      expect('type' in edgeAttrsShape).toBe(false)
    })

    it('addNote creates a new sticky note and returns its uuid', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const r = handlers.addNote(store, { diagramId, text: '4k', position: { x: 5, y: 5 } })
      expect('id' in r).toBe(true)
      const id = (r as { id: string }).id
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      const note = store
        .getState()
        .model.diagrams.find((x) => x.id === diagramId)!
        .notes.find((n) => n.id === id)!
      expect(note.text).toBe('4k')
      expect('error' in handlers.addNote(store, { diagramId: 'nope', text: 'x' })).toBe(true)
    })

    it("editNote updates an existing note's text", async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const { id } = handlers.addNote(store, { diagramId, text: 'first' }) as { id: string }
      const r = handlers.editNote(store, { diagramId, id, patch: { text: 'second' } })
      expect(r).toEqual({ ok: true })
      const note = store
        .getState()
        .model.diagrams.find((x) => x.id === diagramId)!
        .notes.find((n) => n.id === id)!
      expect(note.text).toBe('second')
      expect(
        'error' in handlers.editNote(store, { diagramId, id: 'ghost', patch: { text: 'x' } }),
      ).toBe(true)
    })

    it('editNote reparents a note into a group, placing it non-overlapping and growing the group via reflow', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const { id: nodeId } = handlers.addNode(store, { diagramId, label: 'Sibling' }) as {
        id: string
      }
      const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
        id: string
      }
      // put the sibling node in the group first, so the note has a sibling to avoid overlapping.
      handlers.editNode(store, { diagramId, id: nodeId, patch: { parentId: groupId } })
      const groupAfterNode = getDiagram(store.getState().model, diagramId)!.groups.find(
        (g) => g.id === groupId,
      )!

      const { id: noteId } = handlers.addNote(store, {
        diagramId,
        text: 'note',
        position: { x: 500, y: 500 },
      }) as {
        id: string
      }
      const r = handlers.editNote(store, { diagramId, id: noteId, patch: { parentId: groupId } })
      expect(r).toEqual({ ok: true })

      const d = getDiagram(store.getState().model, diagramId)!
      const note = d.notes.find((n) => n.id === noteId)!
      const sibling = d.nodes.find((n) => n.id === nodeId)!
      expect(note.parentId).toBe(groupId)
      // placed beside its sibling, not on top of it and not left at (500,500).
      expect(note.position).not.toEqual(sibling.position)
      expect(note.position).not.toEqual({ x: 500, y: 500 })
      const group = d.groups.find((g) => g.id === groupId)!
      // group grew to accommodate the second child.
      expect(group.size.width).toBeGreaterThan(groupAfterNode.size.width)
    })

    it('editNote errors on an unknown note, diagram, or parentId group', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const { id: noteId } = handlers.addNote(store, { diagramId, text: 'note' }) as { id: string }
      expect(
        'error' in handlers.editNote(store, { diagramId, id: 'ghost', patch: { text: 'x' } }),
      ).toBe(true)
      expect(
        'error' in
          handlers.editNote(store, { diagramId: 'nope', id: noteId, patch: { text: 'x' } }),
      ).toBe(true)
      expect(
        'error' in
          handlers.editNote(store, { diagramId, id: noteId, patch: { parentId: 'no-such-group' } }),
      ).toBe(true)
    })

    it('remove deletes a node, an edge, and a note', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex', 'Sonarr'],
        edges: [['plex', 'sonarr']],
      })) as { diagramId: string; nodeIds: string[] }
      const edgeId = store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges[0].id
      const { id: noteId } = handlers.addNote(store, { diagramId, text: 'x' }) as { id: string }
      expect(handlers.remove(store, { diagramId, edgeId })).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.edges).toHaveLength(0)
      expect(handlers.remove(store, { diagramId, noteId })).toEqual({ ok: true })
      expect(store.getState().model.diagrams.find((x) => x.id === diagramId)!.notes).toHaveLength(0)
      expect(handlers.remove(store, { diagramId, nodeId: nodeIds[1] })).toEqual({ ok: true })
      expect(
        store
          .getState()
          .model.diagrams.find((x) => x.id === diagramId)!
          .nodes.some((n) => n.id === nodeIds[1]),
      ).toBe(false)
      expect('error' in handlers.remove(store, { diagramId })).toBe(true)
    })

    it('layout re-lays-out a diagram', async () => {
      const store = await mkStore()
      const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
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

    it('layout honours client-measured node heights when spacing a rank', async () => {
      const spacingWith = async (sizes?: Record<string, { height?: number }>) => {
        const store = await mkStore()
        const { diagramId } = (await handlers.authorDiagram(store, {
          name: 'Flow',
          nodes: ['Src', 'A', 'B'],
          // spec.edges reference the slugified node ref, not the label.
          edges: [
            ['src', 'a'],
            ['src', 'b'],
          ],
        })) as { diagramId: string }
        const before = getDiagram(store.getState().model, diagramId)!
        const byLabel = Object.fromEntries(before.nodes.map((n) => [n.label, n.id]))
        const measured = sizes
          ? Object.fromEntries(
              Object.entries(sizes).map(([label, s]) => [byLabel[label] ?? label, s]),
            )
          : undefined
        await handlers.layout(store, diagramId, 'graphviz', measured)
        const after = getDiagram(store.getState().model, diagramId)!
        const y = (label: string) => after.nodes.find((n) => n.label === label)!.position.y
        return Math.abs(y('A') - y('B'))
      }
      // graphviz nodesep = 0.5in = 36px, so a rank gap is node height + 36.
      expect(await spacingWith()).toBe(64 + 36)
      expect(await spacingWith({ Src: { height: 40 }, A: { height: 40 }, B: { height: 40 } })).toBe(
        40 + 36,
      )
    })

    it('layout accepts the graphviz engine without throwing', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as {
        diagramId: string
      }
      const r = await handlers.layout(store, diagramId, 'graphviz')
      expect(r).toEqual({ ok: true })
    })

    it('layout persists notes and keeps a grouped note inside its group', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'L',
        nodes: ['Seed'],
      })) as { diagramId: string }
      const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'G' }) as { id: string }
      handlers.addNode(store, { diagramId, label: 'N', parentId: groupId })
      const { id: noteId } = handlers.addNote(store, {
        diagramId,
        text: 'hi',
        parentId: groupId,
      }) as { id: string }
      const r = await handlers.layout(store, diagramId)
      expect(r).toEqual({ ok: true })
      const d = getDiagram(store.getState().model, diagramId)!
      const note = d.notes.find((n) => n.id === noteId)!
      expect(note.parentId).toBe(groupId) // still grouped after tidy
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
    const edge = getDiagram(store.getState().model, diagramId)!.edges.find(
      (e) => e.from === plexId && e.to === sonarrId,
    )!
    expect(edge.orientation).toBe('vertical')
  })

  it('edit_edge patch updates orientation', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Plex', 'Sonarr'],
      edges: [['plex', 'sonarr']],
    })) as { diagramId: string }
    const edgeId = getDiagram(store.getState().model, diagramId)!.edges[0].id
    handlers.editEdge(store, { diagramId, edgeId, patch: { orientation: 'horizontal' } })
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

describe('diagram lifecycle', () => {
  it('newDiagram returns an id and the diagram exists, empty', async () => {
    const store = await mkStore()
    const r = handlers.newDiagram(store, { name: 'Homelab' })
    expect(typeof r.id).toBe('string')
    expect(r.id.length).toBeGreaterThan(0)
    const d = getDiagram(store.getState().model, r.id)!
    expect(d).toBeTruthy()
    expect(d.name).toBe('Homelab')
    expect(d.type).toBe('canvas')
    expect(d.nodes).toEqual([])
    expect(d.groups).toEqual([])
    expect(d.notes).toEqual([])
    expect(d.edges).toEqual([])
  })

  it('newDiagram accepts an explicit type', async () => {
    const store = await mkStore()
    const r = handlers.newDiagram(store, { name: 'Topo', type: 'topology' })
    const d = getDiagram(store.getState().model, r.id)!
    expect(d.type).toBe('topology')
  })

  it('renameDiagram changes the name', async () => {
    const store = await mkStore()
    const { id } = handlers.newDiagram(store, { name: 'Original' })
    const r = handlers.renameDiagram(store, { id, name: 'Renamed' })
    expect(r).toEqual({ ok: true })
    const d = getDiagram(store.getState().model, id)!
    expect(d.name).toBe('Renamed')
  })

  it('renameDiagram errors on an unknown diagram', async () => {
    const store = await mkStore()
    const r = handlers.renameDiagram(store, { id: 'nope', name: 'X' })
    expect('error' in r).toBe(true)
  })

  it('deleteDiagram removes the diagram from listDiagrams and getDiagram', async () => {
    const store = await mkStore()
    const { id } = handlers.newDiagram(store, { name: 'Gone' })
    expect(handlers.listDiagrams(store).some((d) => d.id === id)).toBe(true)
    const r = handlers.deleteDiagram(store, { id })
    expect(r).toEqual({ ok: true })
    expect(handlers.listDiagrams(store).some((d) => d.id === id)).toBe(false)
    expect('error' in handlers.getDiagram(store, id)).toBe(true)
  })

  it('deleteDiagram errors on an unknown diagram', async () => {
    const store = await mkStore()
    const r = handlers.deleteDiagram(store, { id: 'nope' })
    expect('error' in r).toBe(true)
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
    const names = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    )
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

  it('registers add_note/edit_note/edit_edge, and NOT the old set_note/set_edge names', async () => {
    const store = await mkStore()
    const server = createMcpServer(store)
    const names = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    )
    expect(names).toContain('add_note')
    expect(names).toContain('edit_note')
    expect(names).toContain('edit_edge')
    // old split/renamed tool names must NOT be registered
    expect(names).not.toContain('set_note')
    expect(names).not.toContain('set_edge')
  })
})

describe('author_flow', () => {
  const mkFlowStore = async (): Promise<{
    store: Store
    diagramId: string
    a: string
    b: string
  }> => {
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
    const res = handlers.authorFlow(store, {
      diagramId,
      name: 'X',
      steps: [{ elements: ['nope'] }],
    })
    expect('error' in res).toBe(true)
  })

  it('rejects an unresolvable edge ref', async () => {
    const { store, diagramId, a } = await mkFlowStore()
    const res = handlers.authorFlow(store, {
      diagramId,
      name: 'X',
      steps: [{ elements: [{ from: a, to: 'zzz' }] }],
    })
    expect('error' in res).toBe(true)
  })
})

describe('flow granular tools', () => {
  const mkFlowStore = async (): Promise<{
    store: Store
    diagramId: string
    a: string
    b: string
  }> => {
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
    const { flowId } = handlers.authorFlow(store, {
      diagramId,
      name: 'F',
      steps: [{ elements: [a] }],
    }) as { flowId: string }
    handlers.addFlowStep(store, { diagramId, flowId, elements: [b], caption: 'two' })
    let f = getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId)!
    expect(f.steps).toHaveLength(2)
    const stepId = f.steps[1].id
    handlers.setFlowStep(store, { diagramId, flowId, stepId, patch: { caption: 'edited' } })
    handlers.removeFlowStep(store, { diagramId, flowId, stepId })
    handlers.renameFlow(store, { diagramId, flowId, name: 'F2' })
    f = getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId)!
    expect(f.name).toBe('F2')
    expect(f.steps).toHaveLength(1)
    handlers.deleteFlow(store, { diagramId, flowId })
    expect(
      getDiagram(store.getState().model, diagramId)!.flows!.find((x) => x.id === flowId),
    ).toBeUndefined()
  })
  it('get_diagram surfaces flows and edge ids', async () => {
    const { store, diagramId, a, b } = await mkFlowStore()
    const { flowId } = handlers.authorFlow(store, {
      diagramId,
      name: 'G',
      steps: [{ elements: [{ from: a, to: b }] }],
    }) as { flowId: string }
    const d = handlers.getDiagram(store, diagramId) as any
    expect(d.flows.find((f: any) => f.id === flowId)).toBeTruthy()
    expect(d.edges[0].id).toBeTruthy()
  })
})

describe('edit_node / add_group / edit_group', () => {
  it('editNode renames a node (label patch)', async () => {
    const store = await mkStore()
    const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Plex'],
    })) as {
      diagramId: string
      nodeIds: string[]
    }
    const r = handlers.editNode(store, {
      diagramId,
      id: nodeIds[0],
      patch: { label: 'Plex Renamed' },
    })
    expect(r).toEqual({ ok: true })
    const node = getDiagram(store.getState().model, diagramId)!.nodes.find(
      (n) => n.id === nodeIds[0],
    )!
    expect(node.label).toBe('Plex Renamed')
  })

  it('editNode errors on an unknown node or diagram, and on an unknown parentId group', async () => {
    const store = await mkStore()
    const { diagramId, nodeIds } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Plex'],
    })) as {
      diagramId: string
      nodeIds: string[]
    }
    expect(
      'error' in handlers.editNode(store, { diagramId, id: 'ghost', patch: { label: 'x' } }),
    ).toBe(true)
    expect(
      'error' in
        handlers.editNode(store, { diagramId: 'nope', id: nodeIds[0], patch: { label: 'x' } }),
    ).toBe(true)
    expect(
      'error' in
        handlers.editNode(store, {
          diagramId,
          id: nodeIds[0],
          patch: { parentId: 'no-such-group' },
        }),
    ).toBe(true)
  })

  it('editNode reparenting a lone node into a group places it at the padded top-left (no absurd growth)', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    // position is intentionally far away — a naive reparent that kept this
    // position (reinterpreted as relative to the new parent, per buildGraph.ts)
    // would force the group to balloon or crowd the group's title strip.
    const { id: nodeId } = handlers.addNode(store, {
      diagramId,
      label: 'Plex',
      position: { x: 500, y: 500 },
    }) as {
      id: string
    }
    const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
      id: string
    }
    const before = getDiagram(store.getState().model, diagramId)!.groups.find(
      (g) => g.id === groupId,
    )!

    const r = handlers.editNode(store, { diagramId, id: nodeId, patch: { parentId: groupId } })
    expect(r).toEqual({ ok: true })

    const d = getDiagram(store.getState().model, diagramId)!
    const node = d.nodes.find((n) => n.id === nodeId)!
    expect(node.parentId).toBe(groupId)
    // repositioned to the group's padded top-left, not left at its old (500,500).
    expect(node.position).toEqual({ x: 16, y: 40 }) // GROUP_PAD x, GROUP_NEST_TOP_PAD y
    const group = d.groups.find((g) => g.id === groupId)!
    // a single child fits within the group's existing floor size — no growth needed.
    expect(group.size).toEqual(before.size)
  })

  it('editNode reparenting a second node into a group with an existing child places it non-overlapping, growing the group', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: nodeA } = handlers.addNode(store, { diagramId, label: 'Plex' }) as { id: string }
    const { id: nodeB } = handlers.addNode(store, { diagramId, label: 'Sonarr' }) as { id: string }
    const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
      id: string
    }

    handlers.editNode(store, { diagramId, id: nodeA, patch: { parentId: groupId } })
    const afterA = getDiagram(store.getState().model, diagramId)!.groups.find(
      (g) => g.id === groupId,
    )!

    const r = handlers.editNode(store, { diagramId, id: nodeB, patch: { parentId: groupId } })
    expect(r).toEqual({ ok: true })

    const d = getDiagram(store.getState().model, diagramId)!
    const a = d.nodes.find((n) => n.id === nodeA)!
    const b = d.nodes.find((n) => n.id === nodeB)!
    expect(b.parentId).toBe(groupId)
    // placed beside its sibling, not on top of it.
    expect(b.position).not.toEqual(a.position)
    expect(b.position.x).toBeGreaterThan(a.position.x)
    const group = d.groups.find((g) => g.id === groupId)!
    // now needs to grow to fit both children side by side.
    expect(group.size.width).toBeGreaterThan(afterA.size.width)
  })

  it('editNode un-parents a node when parentId is set to null', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: nodeId } = handlers.addNode(store, { diagramId, label: 'Plex' }) as { id: string }
    const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
      id: string
    }
    handlers.editNode(store, { diagramId, id: nodeId, patch: { parentId: groupId } })
    expect(
      getDiagram(store.getState().model, diagramId)!.nodes.find((n) => n.id === nodeId)!.parentId,
    ).toBe(groupId)
    handlers.editNode(store, { diagramId, id: nodeId, patch: { parentId: null } })
    expect(
      getDiagram(store.getState().model, diagramId)!.nodes.find((n) => n.id === nodeId)!.parentId,
    ).toBeUndefined()
  })

  it('addGroup returns a uuid and the group exists with the requested label', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const r = handlers.addGroup(store, { diagramId, label: 'Media' })
    expect('id' in r).toBe(true)
    const id = (r as { id: string }).id
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    const group = getDiagram(store.getState().model, diagramId)!.groups.find((g) => g.id === id)!
    expect(group.label).toBe('Media')
  })

  it('addGroup errors on an unknown diagram or an unknown parentId group', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    expect('error' in handlers.addGroup(store, { diagramId: 'nope', label: 'X' })).toBe(true)
    expect(
      'error' in handlers.addGroup(store, { diagramId, label: 'X', parentId: 'no-such-group' }),
    ).toBe(true)
  })

  it('editGroup updates label/color', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
      id: string
    }
    const r = handlers.editGroup(store, {
      diagramId,
      id: groupId,
      patch: { label: 'Media Renamed', color: '#123456' },
    })
    expect(r).toEqual({ ok: true })
    const group = getDiagram(store.getState().model, diagramId)!.groups.find(
      (g) => g.id === groupId,
    )!
    expect(group.label).toBe('Media Renamed')
    expect(group.color).toBe('#123456')
  })

  it('editGroup nests a group into another via parentId, growing the parent via reflow', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: outerId } = handlers.addGroup(store, { diagramId, label: 'Outer' }) as {
      id: string
    }
    const { id: innerId } = handlers.addGroup(store, {
      diagramId,
      label: 'Inner',
      position: { x: 500, y: 500 },
      size: { width: 300, height: 200 },
    }) as { id: string }
    const outerBefore = getDiagram(store.getState().model, diagramId)!.groups.find(
      (g) => g.id === outerId,
    )!

    const r = handlers.editGroup(store, { diagramId, id: innerId, patch: { parentId: outerId } })
    expect(r).toEqual({ ok: true })

    const d = getDiagram(store.getState().model, diagramId)!
    expect(d.groups.find((g) => g.id === innerId)!.parentId).toBe(outerId)
    const outer = d.groups.find((g) => g.id === outerId)!
    expect(outer.size.width).toBeGreaterThan(outerBefore.size.width)
    expect(outer.size.height).toBeGreaterThan(outerBefore.size.height)
  })

  it('editGroup errors on an unknown group or diagram, and on an unknown parentId', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: groupId } = handlers.addGroup(store, { diagramId, label: 'Media' }) as {
      id: string
    }
    expect(
      'error' in handlers.editGroup(store, { diagramId, id: 'ghost', patch: { label: 'x' } }),
    ).toBe(true)
    expect(
      'error' in
        handlers.editGroup(store, { diagramId: 'nope', id: groupId, patch: { label: 'x' } }),
    ).toBe(true)
    expect(
      'error' in
        handlers.editGroup(store, { diagramId, id: groupId, patch: { parentId: 'no-such-group' } }),
    ).toBe(true)
  })

  it('editGroup rejects reparenting a group into itself or into its own descendant (cycle guard)', async () => {
    const store = await mkStore()
    const { diagramId } = (await handlers.authorDiagram(store, {
      name: 'Flow',
      nodes: ['Seed'],
    })) as { diagramId: string }
    const { id: outerId } = handlers.addGroup(store, { diagramId, label: 'Outer' }) as {
      id: string
    }
    const { id: innerId } = handlers.addGroup(store, { diagramId, label: 'Inner' }) as {
      id: string
    }
    handlers.editGroup(store, { diagramId, id: innerId, patch: { parentId: outerId } })

    // self-parenting
    const selfRes = handlers.editGroup(store, {
      diagramId,
      id: outerId,
      patch: { parentId: outerId },
    })
    expect('error' in selfRes).toBe(true)

    // outer -> inner would create a cycle since inner is already outer's child
    const cycleRes = handlers.editGroup(store, {
      diagramId,
      id: outerId,
      patch: { parentId: innerId },
    })
    expect('error' in cycleRes).toBe(true)

    // model unchanged: outer is still top-level, inner still parented to outer
    const d = getDiagram(store.getState().model, diagramId)!
    expect(d.groups.find((g) => g.id === outerId)!.parentId).toBeUndefined()
    expect(d.groups.find((g) => g.id === innerId)!.parentId).toBe(outerId)
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
