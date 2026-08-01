import { describe, it, expect } from 'vitest'
import {
  HISTORY_LIMIT,
  record,
  seed,
  reconcile,
  dropDiagram,
  canUndo,
  canRedo,
  undoTarget,
  redoTarget,
  setPointer,
  undoStates,
  type HistoryMap,
} from './history'
import type { DiagramContent } from '../src/model'

const c = (n: number): DiagramContent => ({
  nodes: [{ id: 'e', label: 'E', fields: [], position: { x: n, y: 0 } }],
  groups: [],
  edges: [],
  notes: [],
  flows: [],
})

describe('history', () => {
  it('record on an empty map seeds a single entry at pointer 0', () => {
    const m = record({}, 'd', c(0))
    expect(m.d.entries).toHaveLength(1)
    expect(m.d.pointer).toBe(0)
    expect(canUndo(m, 'd')).toBe(false)
    expect(canRedo(m, 'd')).toBe(false)
  })

  it('successive records advance the pointer and enable undo', () => {
    let m = record({}, 'd', c(0))
    m = record(m, 'd', c(1))
    m = record(m, 'd', c(2))
    expect(m.d.entries).toHaveLength(3)
    expect(m.d.pointer).toBe(2)
    expect(canUndo(m, 'd')).toBe(true)
    expect(canRedo(m, 'd')).toBe(false)
    expect(undoTarget(m, 'd')).toEqual({ content: c(1), pointer: 1 })
  })

  it('a record after moving the pointer back truncates the redo branch', () => {
    let m = record({}, 'd', c(0))
    m = record(m, 'd', c(1))
    m = record(m, 'd', c(2))
    m = setPointer(m, 'd', 0) // as if two undos happened
    m = record(m, 'd', c(9)) // new edit from the past state
    expect(m.d.entries.map((e) => e.nodes[0].position.x)).toEqual([0, 9])
    expect(m.d.pointer).toBe(1)
    expect(canRedo(m, 'd')).toBe(false)
  })

  it('caps at HISTORY_LIMIT, dropping the oldest', () => {
    let m: HistoryMap = {}
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) m = record(m, 'd', c(i))
    expect(m.d.entries).toHaveLength(HISTORY_LIMIT)
    expect(m.d.pointer).toBe(HISTORY_LIMIT - 1)
    // oldest surviving entry is i=5 (0..4 dropped)
    expect(m.d.entries[0].nodes[0].position.x).toBe(5)
  })

  it('record deep-clones so later mutation of the source does not corrupt history', () => {
    const src = c(0)
    const m = record({}, 'd', src)
    src.nodes[0].position.x = 999
    expect(m.d.entries[0].nodes[0].position.x).toBe(0)
  })

  it('redoTarget returns the next entry when redo is possible', () => {
    let m = record({}, 'd', c(0))
    m = record(m, 'd', c(1))
    m = setPointer(m, 'd', 0)
    expect(redoTarget(m, 'd')).toEqual({ content: c(1), pointer: 1 })
    expect(canRedo(m, 'd')).toBe(true)
  })

  it('seed replaces any existing history with one entry', () => {
    let m = record({}, 'd', c(0))
    m = record(m, 'd', c(1))
    m = seed(m, 'd', c(7))
    expect(m.d.entries).toHaveLength(1)
    expect(m.d.pointer).toBe(0)
    expect(m.d.entries[0].nodes[0].position.x).toBe(7)
  })

  describe('reconcile (startup drift handling — never discards a stack)', () => {
    it('seeds when there is no prior history for the diagram', () => {
      const m = reconcile({}, 'd', c(5))
      expect(m.d.entries).toHaveLength(1)
      expect(m.d.pointer).toBe(0)
      expect(m.d.entries[0].nodes[0].position.x).toBe(5)
    })

    it('is a no-op when content already equals the current head', () => {
      let m = record({}, 'd', c(0))
      m = record(m, 'd', c(1)) // head = c(1), pointer 1
      const r = reconcile(m, 'd', c(1))
      expect(r).toBe(m) // unchanged reference
      expect(r.d.entries).toHaveLength(2)
      expect(r.d.pointer).toBe(1)
    })

    it('moves the pointer (lossless) when content matches an earlier entry — model behind history', () => {
      let m = record({}, 'd', c(0))
      m = record(m, 'd', c(1))
      m = record(m, 'd', c(2)) // entries [0,1,2], pointer 2
      // model on disk reverted to c(1)'s content (e.g. history persisted ahead of model)
      const r = reconcile(m, 'd', c(1))
      expect(r.d.entries.map((e) => e.nodes[0].position.x)).toEqual([0, 1, 2]) // stack intact
      expect(r.d.pointer).toBe(1)
      expect(canUndo(r, 'd')).toBe(true) // can still undo to 0
      expect(canRedo(r, 'd')).toBe(true) // AND redo forward to 2
    })

    it('appends (preserving the whole stack) when the model is one edit ahead of history', () => {
      let m = record({}, 'd', c(0))
      m = record(m, 'd', c(1))
      m = record(m, 'd', c(2)) // entries [0,1,2], pointer 2 — model advanced to c(3) but was never recorded
      const r = reconcile(m, 'd', c(3))
      expect(r.d.entries.map((e) => e.nodes[0].position.x)).toEqual([0, 1, 2, 3]) // nothing lost
      expect(r.d.pointer).toBe(3)
      expect(canUndo(r, 'd')).toBe(true)
      // the whole prior history remains reachable by undo
      expect(undoTarget(r, 'd')).toEqual({ content: c(2), pointer: 2 })
    })

    it('preserves the prior state as an undo target even from a single drifted entry', () => {
      // history has only one entry (c(999)); model drifted to c(0).
      // c(999) was a real prior state, so it becomes a legitimate undo target (not discarded).
      const m = record({}, 'd', c(999))
      const r = reconcile(m, 'd', c(0))
      expect(r.d.entries.map((e) => e.nodes[0].position.x)).toEqual([999, 0])
      expect(r.d.pointer).toBe(1)
      expect(canUndo(r, 'd')).toBe(true)
    })
  })

  it('dropDiagram removes a diagram history', () => {
    const m = dropDiagram(record({}, 'd', c(0)), 'd')
    expect(m.d).toBeUndefined()
  })

  it('undoStates reports per-diagram flags; unknown/empty are false', () => {
    let m = record({}, 'd', c(0))
    m = record(m, 'd', c(1))
    expect(undoStates(m)).toEqual({ d: { canUndo: true, canRedo: false } })
    expect(canUndo({}, 'missing')).toBe(false)
    expect(undoTarget({}, 'missing')).toBeNull()
  })
})
