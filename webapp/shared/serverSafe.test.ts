import { readdirSync, readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// shared/ is the domain kernel: model, ops, diff, containment, ids, schemes and
// the relationship vocabulary. Both the browser bundle and the Node server
// import it, so nothing in here may reach for a browser-only module.
//
// This replaces a hand-written guard that named model.ts and ops.ts explicitly
// and matched a couple of import spellings with regexes it admitted only
// covered "the common case". It scans the whole directory instead, so a file
// added to shared/ is covered without anyone remembering to extend a list —
// which is the failure mode the old version had (it never grew to cover diff,
// containment, ids or schemes).
const FORBIDDEN = ['react', 'react-dom', '@xyflow/react', 'react-markdown']

const dir = new URL('.', import.meta.url)
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

// Matches both `import ... from 'x'` and `export ... from 'x'`, with or without
// a `type` modifier — a type-only import is erased at runtime and so is safe,
// but shared/ still must not depend on the client's shape.
const importSources = (src: string): string[] =>
  [...src.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)

describe('shared/ is server-safe', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s imports no browser-only module', (file) => {
    const found = importSources(readFileSync(new URL(file, dir), 'utf8')).filter((s) =>
      FORBIDDEN.includes(s),
    )
    expect(found).toEqual([])
  })

  it.each(files)('%s does not reach back into src/', (file) => {
    const found = importSources(readFileSync(new URL(file, dir), 'utf8')).filter((s) =>
      s.includes('../src/'),
    )
    expect(found).toEqual([])
  })
})
