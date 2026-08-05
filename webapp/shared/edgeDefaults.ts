// Edge defaults: which way an edge points, and the colour it starts with.
//
// This file was shared/relationships.ts and held a six-value RelType with a
// REL lookup of colours and labels. None of it was reachable: nothing in the
// UI, MCP or the layout engines could set an edge's type, so every edge was
// 'talks-to' and REL[type].color only ever returned the one colour below. The
// label half was never read at all. What is left is what the product actually
// has.

// forward = arrow at target (default); backward = arrow at source;
// both = arrows at both ends (two-way / request-response).
export type EdgeDir = 'forward' | 'backward' | 'both'

// The colour an edge starts with. Every writer sets it explicitly at creation
// and backfillDefaults gives it to edges written before that, so this is a
// starting value rather than a fallback the renderer leans on.
export const DEFAULT_EDGE_COLOR = '#64748b'
