import { describe, it, expect, vi } from 'vitest'
import { createStore } from './store'

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
