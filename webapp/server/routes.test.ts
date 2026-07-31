import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createAppStore } from './app-store'
import { registerRoutes } from './routes'

let server: Server
let base: string

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'routes-'))
  const store = await createAppStore(dir)
  const app = express()
  registerRoutes(app, store)
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.close()
})

describe('registerRoutes', () => {
  it('GET /api/model returns the current snapshot', async () => {
    const res = await fetch(`${base}/api/model`)
    expect(res.status).toBe(200)
    const snap = await res.json()
    expect(snap).toHaveProperty('rev')
    expect(snap).toHaveProperty('model')
    expect(snap).toHaveProperty('undo')
  })

  it('POST /api/ops with an empty op list is a no-op returning rev 0', async () => {
    const res = await fetch(`${base}/api/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 0 })
  })

  it('POST /api/ops with an invalid body returns 400', async () => {
    const res = await fetch(`${base}/api/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/ops is not registered (405/404, not 200)', async () => {
    const res = await fetch(`${base}/api/ops`)
    expect(res.status).not.toBe(200)
  })
})
