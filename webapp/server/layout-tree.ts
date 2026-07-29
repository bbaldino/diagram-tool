import type { Diagram } from '../src/model'

// parentId of the node or group with this id (notes aren't edge endpoints), or
// null if top-level or unknown.
export function parentOf(diagram: Diagram, id: string): string | null {
  const n = diagram.nodes.find((x) => x.id === id)
  if (n) return n.parentId ?? null
  const g = diagram.groups.find((x) => x.id === id)
  if (g) return g.parentId ?? null
  return null
}

// The containers an element sits in, deepest first, ending with null (root).
// Cycle-guarded.
export function containerChain(diagram: Diagram, id: string): (string | null)[] {
  const chain: (string | null)[] = []
  const seen = new Set<string>()
  let cur: string | null = parentOf(diagram, id)
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    chain.push(cur)
    cur = parentOf(diagram, cur)
  }
  chain.push(null)
  return chain
}

// Deepest container common to both elements' chains.
export function lcaContainer(diagram: Diagram, a: string, b: string): string | null {
  const bChain = new Set(containerChain(diagram, b).map((c) => c ?? ' root'))
  for (const c of containerChain(diagram, a)) {
    if (bChain.has(c ?? ' root')) return c
  }
  return null
}

// The id of the box that is a direct child of `container` and (transitively)
// contains `elementId` — the element itself if it is a direct child, else the
// ancestor group that is.
export function boxAtContainer(diagram: Diagram, elementId: string, container: string | null): string {
  let cur = elementId
  const seen = new Set<string>()
  while ((parentOf(diagram, cur) ?? null) !== container) {
    const p = parentOf(diagram, cur)
    if (!p || seen.has(p)) break
    seen.add(p)
    cur = p
  }
  return cur
}

// Every edge grouped by its LCA container, contracted to the two direct-child
// box ids it runs between at that container. Self-loops (both endpoints resolve
// to the same box) are dropped.
export function contractEdges(diagram: Diagram): Map<string | null, { from: string; to: string }[]> {
  const out = new Map<string | null, { from: string; to: string }[]>()
  for (const e of diagram.edges) {
    const lca = lcaContainer(diagram, e.from, e.to)
    const from = boxAtContainer(diagram, e.from, lca)
    const to = boxAtContainer(diagram, e.to, lca)
    if (from === to) continue
    const list = out.get(lca) ?? []
    list.push({ from, to })
    out.set(lca, list)
  }
  return out
}
