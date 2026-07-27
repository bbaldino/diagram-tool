import { describe, it, expect } from 'vitest'
import {
  HISTORY_LIMIT, record, seed, dropDiagram, canUndo, canRedo,
  undoTarget, redoTarget, setPointer, undoStates, type HistoryMap,
} from './history'
import type { DiagramContent } from '../src/model'

const c = (n: number): DiagramContent => ({
  placements: [{ entityId: 'e', position: { x: n, y: 0 } }],
  groups: [], edges: [], notes: [],
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
    expect(m.d.entries.map((e) => e.placements[0].position.x)).toEqual([0, 9])
    expect(m.d.pointer).toBe(1)
    expect(canRedo(m, 'd')).toBe(false)
  })

  it('caps at HISTORY_LIMIT, dropping the oldest', () => {
    let m: HistoryMap = {}
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) m = record(m, 'd', c(i))
    expect(m.d.entries).toHaveLength(HISTORY_LIMIT)
    expect(m.d.pointer).toBe(HISTORY_LIMIT - 1)
    // oldest surviving entry is i=5 (0..4 dropped)
    expect(m.d.entries[0].placements[0].position.x).toBe(5)
  })

  it('record deep-clones so later mutation of the source does not corrupt history', () => {
    const src = c(0)
    const m = record({}, 'd', src)
    src.placements[0].position.x = 999
    expect(m.d.entries[0].placements[0].position.x).toBe(0)
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
    expect(m.d.entries[0].placements[0].position.x).toBe(7)
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
