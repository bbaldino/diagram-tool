import { applyOps, type Op } from '../src/ops'
import {
  normalizeModel,
  getDiagram,
  diagramContent,
  type Model,
  type DiagramContent,
} from '../src/model'
import { diffDiagramContents } from '../src/diff'
import * as history from './history'

const SAVE_DEBOUNCE_MS = 250

export interface Snapshot {
  rev: number
  model: Model
  writerId?: string
  undo: Record<string, { canUndo: boolean; canRedo: boolean }>
}

export interface Store {
  getState(): Snapshot
  apply(ops: Op[], writerId?: string): Snapshot
  undo(diagramId: string): Snapshot
  redo(diagramId: string): Snapshot
  subscribe(cb: (s: Snapshot) => void): () => void
}

// Loads the on-disk model, normalizing it into shape. If `load()` rejects
// (e.g. the model file doesn't exist yet), seed an empty normalized model
// rather than failing store creation.
async function loadInitialModel(load: () => Promise<any>): Promise<Model> {
  try {
    return normalizeModel(await load())
  } catch {
    return normalizeModel({})
  }
}

export async function createStore(opts: {
  file: string
  load: () => Promise<any>
  save: (m: Model) => Promise<void>
  loadHistory?: () => Promise<any>
  saveHistory?: (h: history.HistoryMap) => Promise<void>
}): Promise<Store> {
  const { save, saveHistory } = opts

  let model = await loadInitialModel(opts.load)
  let rev = 0
  let lastWriterId: string | undefined
  const subscribers = new Set<(s: Snapshot) => void>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  let historyMap: history.HistoryMap = {}
  if (opts.loadHistory) {
    try {
      const loaded = await opts.loadHistory()
      if (loaded && typeof loaded === 'object') historyMap = loaded as history.HistoryMap
    } catch {}
  }
  // Reconcile persisted history against the loaded model: every model diagram
  // must have a history whose current entry equals its content, else reseed;
  // drop histories for diagrams no longer in the model.
  {
    const modelIds = new Set(model.diagrams.map((d) => d.id))
    for (const id of Object.keys(historyMap)) {
      if (!modelIds.has(id)) historyMap = history.dropDiagram(historyMap, id)
    }
    for (const d of model.diagrams) {
      const h = historyMap[d.id]
      const current = h?.entries[h.pointer]
      if (!current || JSON.stringify(current) !== JSON.stringify(diagramContent(d))) {
        historyMap = history.seed(historyMap, d.id, diagramContent(d))
      }
    }
  }

  function getState(): Snapshot {
    return { rev, model, writerId: lastWriterId, undo: history.undoStates(historyMap) }
  }

  function scheduleSave(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      save(model).catch((err) => console.error('model save failed', err))
      saveHistory?.(historyMap).catch((err) => console.error('history save failed', err))
    }, SAVE_DEBOUNCE_MS)
  }

  function recordHistory(before: Model, after: Model): void {
    const beforeById = new Map(before.diagrams.map((d) => [d.id, d]))
    const afterById = new Map(after.diagrams.map((d) => [d.id, d]))
    for (const d of after.diagrams) {
      const prev = beforeById.get(d.id)
      const content = diagramContent(d)
      if (!prev) {
        historyMap = history.seed(historyMap, d.id, content)
      } else if (JSON.stringify(diagramContent(prev)) !== JSON.stringify(content)) {
        historyMap = history.record(historyMap, d.id, content)
      }
    }
    for (const d of before.diagrams) {
      if (!afterById.has(d.id)) historyMap = history.dropDiagram(historyMap, d.id)
    }
  }

  function apply(ops: Op[], writerId?: string): Snapshot {
    const before = model
    const next = applyOps(model, ops)
    // Swallow byte-identical (no-op) applies: don't bump rev, persist, or
    // notify. This breaks the idle two-tab churn loop where every apply
    // broadcast made the peer reseed and re-emit spurious ops.
    if (ops.length === 0 || JSON.stringify(next) === JSON.stringify(model)) {
      return getState()
    }
    model = next
    rev += 1
    lastWriterId = writerId
    recordHistory(before, model)
    scheduleSave()
    const snapshot = getState()
    for (const cb of subscribers) cb(snapshot)
    return snapshot
  }

  function navigate(
    diagramId: string,
    target: { content: DiagramContent; pointer: number } | null,
    writerId: string,
  ): Snapshot {
    if (!target) return getState()
    const diagram = getDiagram(model, diagramId)
    if (!diagram) return getState()
    const ops = diffDiagramContents(diagramId, diagramContent(diagram), target.content)
    const next = applyOps(model, ops)
    if (ops.length === 0 || JSON.stringify(next) === JSON.stringify(model)) return getState()
    model = next
    rev += 1
    lastWriterId = writerId
    historyMap = history.setPointer(historyMap, diagramId, target.pointer)
    scheduleSave()
    const snapshot = getState()
    for (const cb of subscribers) cb(snapshot)
    return snapshot
  }

  function undo(diagramId: string): Snapshot {
    return navigate(diagramId, history.undoTarget(historyMap, diagramId), 'undo')
  }
  function redo(diagramId: string): Snapshot {
    return navigate(diagramId, history.redoTarget(historyMap, diagramId), 'redo')
  }

  function subscribe(cb: (s: Snapshot) => void): () => void {
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }

  return { getState, apply, undo, redo, subscribe }
}
