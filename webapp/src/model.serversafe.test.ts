import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('model.ts is server-safe', () => {
  it('has no value import from @xyflow/react or ./graph', () => {
    const src = readFileSync(new URL('./model.ts', import.meta.url), 'utf8')
    // value imports look like `import { X } from '...'` WITHOUT a leading `type`
    const badXyflow = /import\s+(?!type\b)\{[^}]*\}\s+from\s+['"]@xyflow\/react['"]/.test(src)
    const badGraph = /import\s+(?!type\b)\{[^}]*\}\s+from\s+['"]\.\/graph['"]/.test(src)
    // a mixed import with inline `type` markers on ALL members is fine; guard the common case
    expect(badXyflow).toBe(false)
    expect(badGraph).toBe(false)
  })
})

describe('ops.ts is server-safe', () => {
  it('imports only from ./model (no @xyflow/react, ./graph, or ./buildGraph)', () => {
    const src = readFileSync(new URL('./ops.ts', import.meta.url), 'utf8')
    const badXyflow = /import\s+(?!type\b)[^;]*\bfrom\s+['"]@xyflow\/react['"]/.test(src)
    const badGraph = /import\s+(?!type\b)[^;]*\bfrom\s+['"]\.\/graph['"]/.test(src)
    const badBuildGraph = /import\s+(?!type\b)[^;]*\bfrom\s+['"]\.\/buildGraph['"]/.test(src)
    expect(badXyflow).toBe(false)
    expect(badGraph).toBe(false)
    expect(badBuildGraph).toBe(false)
  })
})
