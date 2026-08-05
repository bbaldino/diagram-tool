// The relationship vocabulary: what kinds of edge exist, which way they point,
// and how each renders.
//
// Extracted from src/graph.ts, which mixes this pure domain data with React
// Flow edge construction and so cannot be imported by the server. The server
// and the model layer need only these, and previously reached into graph.ts
// with `import type` — safe only because TypeScript erases type imports, so a
// single non-type import would have pulled @xyflow/react into the server.

export type RelType = 'talks-to' | 'via' | 'writes-to' | 'reads-from' | 'proxies' | 'monitors'

// forward = arrow at target (default); backward = arrow at source;
// both = arrows at both ends (two-way / request-response).
export type EdgeDir = 'forward' | 'backward' | 'both'

export const REL: Record<RelType, { color: string; label: string }> = {
  'talks-to': { color: '#64748b', label: 'talks to' },
  via: { color: '#6366f1', label: 'via' },
  'writes-to': { color: '#16a34a', label: 'writes to' },
  'reads-from': { color: '#2563eb', label: 'reads from' },
  proxies: { color: '#ea580c', label: 'proxies' },
  monitors: { color: '#9333ea', label: 'monitors' },
}

export const REL_TYPES = Object.keys(REL) as RelType[]

// The colour an edge starts with.
//
// Edge colour used to be looked up as REL[type].color, which read as though it
// tracked the relationship type. It never could: nothing sets an edge's type —
// not the inspector, not MCP — so every edge is 'talks-to' and the lookup only
// ever returned this one value. Naming it directly removes a dependency that
// implied behaviour the product does not have.
export const DEFAULT_EDGE_COLOR = '#64748b'
