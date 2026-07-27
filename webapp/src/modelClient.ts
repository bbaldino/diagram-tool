import type { Op } from './ops'
import type { Model } from './model'

export interface Snapshot {
  rev: number
  model: Model
  writerId?: string
}

// Stable per-tab id sent with every ops POST and echoed back on the SSE
// snapshot, so the client can recognize (and skip) its own echoes.
// NOTE: crypto.randomUUID exists only in a secure context (localhost counts,
// but plain-HTTP LAN origins like 192.168.x.x do not), so fall back to a
// getRandomValues/Math.random id. This value only needs to be unique per tab.
function makeClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16)
      crypto.getRandomValues(b)
      return 'c-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* insecure context or crypto unavailable — fall through */
  }
  return 'c-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}
export const clientId = makeClientId()

export async function fetchState(): Promise<Snapshot> {
  const res = await fetch('/api/model')
  return res.json()
}

export function subscribe(cb: (s: Snapshot) => void): () => void {
  const es = new EventSource('/api/model/stream')
  es.onmessage = (e) => {
    cb(JSON.parse(e.data))
  }
  return () => es.close()
}

export async function sendOps(ops: Op[]): Promise<{ rev: number } | { error: string }> {
  if (!ops.length) return { rev: -1 }
  const res = await fetch('/api/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops, writerId: clientId }),
  })
  return res.json()
}
