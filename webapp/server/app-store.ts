import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createStore, type Store } from './store'
import { atomicWriteFile } from './persist'

// Build the model store with model.json + history.json living under `dataDir`.
// The single source of store construction for both the dev server and the
// production entry. A missing model.json/history.json is tolerated by
// createStore (it seeds an empty normalized model), so a fresh deploy with an
// empty DATA_DIR starts with no diagrams rather than failing to boot.
export function createAppStore(dataDir: string): Promise<Store> {
  const file = resolve(dataDir, 'model.json')
  const historyFile = resolve(dataDir, 'history.json')
  return createStore({
    file,
    load: async () => JSON.parse(await readFile(file, 'utf8')),
    save: (model) => atomicWriteFile(file, JSON.stringify(model, null, 2)),
    loadHistory: async () => JSON.parse(await readFile(historyFile, 'utf8')),
    saveHistory: (h) => atomicWriteFile(historyFile, JSON.stringify(h)),
  })
}
