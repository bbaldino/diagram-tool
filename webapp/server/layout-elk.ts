import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { FlatEngine } from './layout'

const elk = new ELK()

export const runElk: FlatEngine = async (boxes, edges) => {
  const ids = new Set(boxes.map((b) => b.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
    },
    children: boxes.map((b) => ({ id: b.id, width: b.width, height: b.height })),
    edges: edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e, i) => ({ id: `fe${i}`, sources: [e.from], targets: [e.to] })),
  }
  const result = await elk.layout(graph)
  const out: Record<string, { x: number; y: number }> = {}
  for (const c of result.children ?? []) out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 }
  return out
}
