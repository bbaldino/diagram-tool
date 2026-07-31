import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppStore } from './app-store'

describe('createAppStore', () => {
  it('creates a store seeded empty when the data dir has no model.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'appstore-'))
    const store = await createAppStore(dir)
    const snap = store.getState()
    expect(snap.rev).toBe(0)
    expect(Array.isArray(snap.model.diagrams)).toBe(true)
    expect(snap.model.diagrams.length).toBe(0)
  })
})
