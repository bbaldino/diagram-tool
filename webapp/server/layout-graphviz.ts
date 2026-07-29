import { Graphviz } from '@hpcc-js/wasm/graphviz'
import type { FlatEngine } from './layout'

// Graphviz coords are points (72/inch), Y-UP, origin bottom-left; we flip every
// box against the graph bb height to top-left / Y-down. Fixed node size is given
// in INCHES; cluster subgraph names MUST start with the literal "cluster".
let graphvizPromise: ReturnType<typeof Graphviz.load> | null = null
const getGraphviz = () => (graphvizPromise ??= Graphviz.load())
const dotId = (id: string): string => `"${id.replace(/"/g, '\\"')}"`

export const runGraphviz: FlatEngine = async (boxes, edges) => {
  const graphviz = await getGraphviz()
  const ids = new Set(boxes.map((b) => b.id))
  const lines: string[] = ['digraph G {', '  rankdir=LR;', '  nodesep=0.5; ranksep=1.0;']
  for (const b of boxes) {
    lines.push(`  ${dotId(b.id)} [shape=box fixedsize=true width=${b.width / 72} height=${b.height / 72}];`)
  }
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) lines.push(`  ${dotId(e.from)} -> ${dotId(e.to)};`)
  lines.push('}')
  const parsed = JSON.parse(await graphviz.layout(lines.join('\n'), 'json', 'dot'))
  const [, , , totalHeight] = String(parsed.bb).split(',').map(Number)
  const sizeById = new Map(boxes.map((b) => [b.id, b]))
  const out: Record<string, { x: number; y: number }> = {}
  for (const obj of parsed.objects ?? []) {
    const b = obj.pos && sizeById.get(obj.name)
    if (!b) continue
    const [cx, cy] = String(obj.pos).split(',').map(Number)
    out[obj.name] = { x: cx - b.width / 2, y: totalHeight - (cy + b.height / 2) }
  }
  return out
}
