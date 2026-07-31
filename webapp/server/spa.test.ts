import { describe, it, expect } from 'vitest'
import { isBackendPath } from './spa'

describe('isBackendPath', () => {
  it('is true for API and MCP paths', () => {
    expect(isBackendPath('/api/model')).toBe(true)
    expect(isBackendPath('/api/model/stream')).toBe(true)
    expect(isBackendPath('/mcp')).toBe(true)
  })
  it('is false for client-routed and asset paths', () => {
    expect(isBackendPath('/')).toBe(false)
    expect(isBackendPath('/dashboard')).toBe(false)
    expect(isBackendPath('/assets/index-abc123.js')).toBe(false)
  })
})
