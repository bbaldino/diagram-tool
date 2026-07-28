import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from './persist'

describe('atomicWriteFile', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'persist-test-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the file contents', async () => {
    const p = join(dir, 'out.json')
    await atomicWriteFile(p, '{"a":1}')
    expect(await readFile(p, 'utf8')).toBe('{"a":1}')
  })

  it('replaces an existing file with the new contents', async () => {
    const p = join(dir, 'out.json')
    await writeFile(p, 'OLD')
    await atomicWriteFile(p, 'NEW')
    expect(await readFile(p, 'utf8')).toBe('NEW')
  })

  it('leaves no temp files behind after a successful write', async () => {
    const p = join(dir, 'out.json')
    await atomicWriteFile(p, 'x')
    const entries = await readdir(dir)
    expect(entries).toEqual(['out.json']) // no *.tmp sibling lingering
  })

  it('does not corrupt or shrink the file across many rapid overwrites', async () => {
    const p = join(dir, 'out.json')
    for (let i = 0; i < 20; i++) await atomicWriteFile(p, JSON.stringify({ i }))
    expect(await readFile(p, 'utf8')).toBe('{"i":19}')
    expect(await readdir(dir)).toEqual(['out.json'])
  })
})
