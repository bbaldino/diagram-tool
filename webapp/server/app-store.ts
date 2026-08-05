import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createStore, type Store } from './store'
import { atomicWriteFile } from './persist'
import { backfillSchemes } from '../src/model'

// Read a file, distinguishing "not there yet" from "there but unreadable".
//
// Only ENOENT means absent. A permissions error, an I/O error, or a directory
// where a file was expected are all real failures and must propagate: the file
// exists, we could not read it, and coming up with an empty model would let
// autosave overwrite it. This is the single place that judgement is made.
async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  }
}

// Build the model store with model.json + history.json living under `dataDir`.
// The single source of store construction for both the dev server and the
// production entry. A missing model.json/history.json is tolerated — a fresh
// deploy with an empty DATA_DIR starts with no diagrams rather than failing to
// boot — but a model.json that exists and cannot be read or parsed fails the
// boot instead, leaving the file intact.
export function createAppStore(dataDir: string): Promise<Store> {
  const file = resolve(dataDir, 'model.json')
  const historyFile = resolve(dataDir, 'history.json')
  return createStore({
    file,
    load: async () => {
      const raw = await readOrNull(file)
      return raw === null ? null : backfillSchemes(JSON.parse(raw))
    },
    save: (model) => atomicWriteFile(file, JSON.stringify(model, null, 2)),
    loadHistory: async () => {
      const raw = await readOrNull(historyFile)
      return raw === null ? null : JSON.parse(raw)
    },
    saveHistory: (h) => atomicWriteFile(historyFile, JSON.stringify(h)),
  })
}
