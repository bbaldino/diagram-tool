import { describe, it, expect, vi } from 'vitest'
import { createStore } from './store'

// A model with one canvas diagram 'd' holding a single placement at x=0.
const seedModelWithDiagram = () => ({
  version: 1, templates: [], entities: [{ id: 'e1', label: 'E', fields: [] }],
  diagrams: [{ id: 'd', name: 'D', title: 'D', type: 'canvas',
    placements: [{ entityId: 'e1', position: { x: 0, y: 0 } }], groups: [], edges: [], notes: [] }],
})

const moveOp = (x: number) => ({
  t: 'placement.set' as const, diagramId: 'd', entityId: 'e1', patch: { position: { x, y: 0 } },
})

describe('createStore', () => {
  it('apply bumps rev, updates model, notifies, and persists', async () => {
    let saved: any = null
    const store = await createStore({
      file: 'x',
      load: async () => ({ version: 1, entities: [], diagrams: [], templates: [] }),
      save: async (m) => {
        saved = m
      },
    })
    const seen: number[] = []
    store.subscribe((s) => seen.push(s.rev))
    const s1 = store.apply([{ t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } }])
    expect(s1.rev).toBe(1)
    expect(store.getState().model.entities).toHaveLength(1)
    expect(seen).toEqual([1])
    await new Promise((r) => setTimeout(r, 300))
    expect(saved.entities).toHaveLength(1)
  })

  it('seeds an empty normalized model when load() rejects (e.g. missing file)', async () => {
    const store = await createStore({
      file: 'missing',
      load: async () => {
        throw new Error('ENOENT')
      },
      save: async () => {},
    })
    expect(store.getState()).toEqual({
      rev: 0,
      model: { version: 1, templates: [], entities: [], diagrams: [] },
      undo: {},
    })
  })

  it('subscribe returns an unsubscribe function that stops further notifications', async () => {
    const store = await createStore({
      file: 'x',
      load: async () => ({ version: 1, entities: [], diagrams: [], templates: [] }),
      save: async () => {},
    })
    const seen: number[] = []
    const unsubscribe = store.subscribe((s) => seen.push(s.rev))
    store.apply([{ t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } }])
    unsubscribe()
    store.apply([{ t: 'entity.add', entity: { id: 'e2', label: 'E2', fields: [] } }])
    expect(seen).toEqual([1])
  })

  it('apply tags the snapshot and subscribers with the given writerId', async () => {
    const store = await createStore({
      file: 'x',
      load: async () => ({ version: 1, entities: [], diagrams: [], templates: [] }),
      save: async () => {},
    })
    const seen: (string | undefined)[] = []
    store.subscribe((s) => seen.push(s.writerId))
    const s1 = store.apply(
      [{ t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } }],
      'w1',
    )
    expect(s1.writerId).toBe('w1')
    expect(store.getState().writerId).toBe('w1')
    expect(seen).toEqual(['w1'])
  })

  it('swallows no-op applies: no rev bump, no notify; real change still does', async () => {
    const store = await createStore({
      file: 'x',
      load: async () => ({
        version: 1,
        entities: [{ id: 'e1', label: 'E', fields: [] }],
        diagrams: [],
        templates: [],
      }),
      save: async () => {},
    })
    const seen: number[] = []
    store.subscribe((s) => seen.push(s.rev))

    // Empty ops: no-op.
    const empty = store.apply([])
    expect(empty.rev).toBe(0)

    // Update setting a field to the value it already has: byte-identical model.
    const same = store.apply([{ t: 'entity.update', id: 'e1', patch: { label: 'E' } }])
    expect(same.rev).toBe(0)
    expect(seen).toEqual([])

    // A real change bumps rev and notifies.
    const changed = store.apply([{ t: 'entity.update', id: 'e1', patch: { label: 'E2' } }])
    expect(changed.rev).toBe(1)
    expect(seen).toEqual([1])
  })

  it('a rejecting save is caught and logged instead of crashing the process', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const store = await createStore({
        file: 'x',
        load: async () => ({ version: 1, entities: [], diagrams: [], templates: [] }),
        save: async () => {
          throw new Error('disk full')
        },
      })
      store.apply([{ t: 'entity.add', entity: { id: 'e1', label: 'E', fields: [] } }])
      await new Promise((r) => setTimeout(r, 300))
      expect(consoleErrorSpy).toHaveBeenCalledWith('model save failed', expect.any(Error))
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('store history', () => {
  it('getState exposes an undo map; a fresh diagram cannot undo/redo', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    expect(store.getState().undo).toEqual({ d: { canUndo: false, canRedo: false } })
  })

  it('each applied op-batch records one history entry per changed diagram', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    store.apply([moveOp(10)])
    store.apply([moveOp(20)])
    expect(store.getState().undo.d).toEqual({ canUndo: true, canRedo: false })
  })

  it('undo restores the previous content and enables redo', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    store.apply([moveOp(10)]) // x: 0 -> 10
    const before = store.getState().rev
    const s = store.undo('d') // back to x=0
    expect(s.rev).toBe(before + 1)
    expect(s.model.diagrams[0].placements[0].position.x).toBe(0)
    expect(s.undo.d).toEqual({ canUndo: false, canRedo: true })
    expect(s.writerId).toBe('undo')
  })

  it('undo does not itself create a new history entry (redo returns forward)', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    store.apply([moveOp(10)])
    store.undo('d')
    const s = store.redo('d')
    expect(s.model.diagrams[0].placements[0].position.x).toBe(10)
    expect(s.undo.d).toEqual({ canUndo: true, canRedo: false })
    expect(s.writerId).toBe('redo')
  })

  it('undo with nothing to undo is a no-op (no rev bump)', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    const rev = store.getState().rev
    const s = store.undo('d')
    expect(s.rev).toBe(rev)
  })

  it('a new edit after undo truncates redo', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    store.apply([moveOp(10)])
    store.undo('d') // back to 0, redo available
    store.apply([moveOp(99)]) // new edit from x=0
    expect(store.getState().undo.d).toEqual({ canUndo: true, canRedo: false })
  })

  it('the no-op apply guard does not push a history entry', async () => {
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
    })
    store.apply([moveOp(0)]) // identical to current -> no-op
    expect(store.getState().undo.d).toEqual({ canUndo: false, canRedo: false })
  })
})

describe('store history persistence', () => {
  it('loads persisted history so undo works immediately after a restart', async () => {
    const persisted = {
      d: {
        pointer: 1,
        entries: [
          { placements: [{ entityId: 'e1', position: { x: 0, y: 0 } }], groups: [], edges: [], notes: [] },
          { placements: [{ entityId: 'e1', position: { x: 10, y: 0 } }], groups: [], edges: [], notes: [] },
        ],
      },
    }
    // model on disk matches entries[pointer] (x=10)
    const store = await createStore({
      file: 'x',
      load: async () => ({
        version: 1, templates: [], entities: [{ id: 'e1', label: 'E', fields: [] }],
        diagrams: [{ id: 'd', name: 'D', title: 'D', type: 'canvas',
          placements: [{ entityId: 'e1', position: { x: 10, y: 0 } }], groups: [], edges: [], notes: [] }],
      }),
      save: async () => {},
      loadHistory: async () => persisted,
      saveHistory: async () => {},
    })
    expect(store.getState().undo.d).toEqual({ canUndo: true, canRedo: false })
    const s = store.undo('d')
    expect(s.model.diagrams[0].placements[0].position.x).toBe(0)
  })

  it('reseeds a diagram history when persisted current entry disagrees with the model (drift)', async () => {
    const drifted = {
      d: { pointer: 0, entries: [
        { placements: [{ entityId: 'e1', position: { x: 999, y: 0 } }], groups: [], edges: [], notes: [] },
      ] },
    }
    const store = await createStore({
      file: 'x',
      load: async () => seedModelWithDiagram(), // model has x=0
      save: async () => {},
      loadHistory: async () => drifted,
      saveHistory: async () => {},
    })
    // history reseeded from the model, so no undo available and no phantom x=999
    expect(store.getState().undo.d).toEqual({ canUndo: false, canRedo: false })
    expect(store.undo('d').model.diagrams[0].placements[0].position.x).toBe(0)
  })

  it('persists history (debounced) on apply', async () => {
    let savedHistory: any = null
    const store = await createStore({
      file: 'x', load: async () => seedModelWithDiagram(), save: async () => {},
      loadHistory: async () => ({}), saveHistory: async (h) => { savedHistory = h },
    })
    store.apply([moveOp(10)])
    await new Promise((r) => setTimeout(r, 300))
    expect(savedHistory.d.entries).toHaveLength(2)
  })
})
