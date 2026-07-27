import { applyOps, type Op } from '../src/ops'
import { normalizeModel, type Model } from '../src/model'

const SAVE_DEBOUNCE_MS = 250

export interface Snapshot {
  rev: number
  model: Model
  writerId?: string
}

export interface Store {
  getState(): Snapshot
  apply(ops: Op[], writerId?: string): Snapshot
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
}): Promise<Store> {
  const { save } = opts

  let model = await loadInitialModel(opts.load)
  let rev = 0
  let lastWriterId: string | undefined
  const subscribers = new Set<(s: Snapshot) => void>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function getState(): Snapshot {
    return { rev, model, writerId: lastWriterId }
  }

  function scheduleSave(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      save(model).catch((err) => console.error('model save failed', err))
    }, SAVE_DEBOUNCE_MS)
  }

  function apply(ops: Op[], writerId?: string): Snapshot {
    const next = applyOps(model, ops)
    // Swallow byte-identical (no-op) applies: don't bump rev, persist, or
    // notify. This breaks the idle two-tab churn loop where every apply
    // broadcast made the peer reseed and re-emit spurious ops.
    if (ops.length === 0 || JSON.stringify(next) === JSON.stringify(model)) {
      return { rev, model, writerId: lastWriterId }
    }
    model = next
    rev += 1
    lastWriterId = writerId
    scheduleSave()
    const snapshot = getState()
    for (const cb of subscribers) cb(snapshot)
    return snapshot
  }

  function subscribe(cb: (s: Snapshot) => void): () => void {
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }

  return { getState, apply, subscribe }
}
