import { Graphviz } from '@hpcc-js/wasm/graphviz'
import { W, type EngineAdapter, type EngineDiagram, type EngineResult, type FlatEngine } from './layout'

// Graphviz coords are points (72/inch), Y-UP, origin bottom-left; we flip every
// box against the graph bb height to top-left / Y-down. Fixed node size is given
// in INCHES; cluster subgraph names MUST start with the literal "cluster".
let graphvizPromise: ReturnType<typeof Graphviz.load> | null = null
const getGraphviz = () => (graphvizPromise ??= Graphviz.load())
const dotId = (id: string): string => `"${id.replace(/"/g, '\\"')}"`

function toDot(diagram: EngineDiagram, heightById: Record<string, number>): string {
  const placedIds = new Set(diagram.placements.map((p) => p.entityId))
  const byGroup: Record<string, string[]> = {}
  const ungrouped: string[] = []
  for (const p of diagram.placements) {
    if (p.parentId && diagram.groups.some((g) => g.id === p.parentId)) (byGroup[p.parentId] ??= []).push(p.entityId)
    else ungrouped.push(p.entityId)
  }
  const nodeLine = (id: string): string =>
    `  ${dotId(id)} [shape=box fixedsize=true width=${W / 72} height=${(heightById[id] ?? 64) / 72}];`

  const lines: string[] = ['digraph G {', '  rankdir=LR;', '  nodesep=0.5; ranksep=1.0;']
  for (const g of diagram.groups) {
    lines.push(`  subgraph ${dotId('cluster_' + g.id)} {`, `    label=${dotId(g.label)};`, '    margin=16;')
    for (const id of byGroup[g.id] ?? []) lines.push('  ' + nodeLine(id))
    lines.push('  }')
  }
  for (const id of ungrouped) lines.push(nodeLine(id))
  for (const e of diagram.edges) {
    if (placedIds.has(e.from) && placedIds.has(e.to)) lines.push(`  ${dotId(e.from)} -> ${dotId(e.to)};`)
  }
  lines.push('}')
  return lines.join('\n')
}

export const runGraphviz: EngineAdapter = async (diagram, heightById): Promise<EngineResult> => {
  const graphviz = await getGraphviz()
  const parsed = JSON.parse(await graphviz.layout(toDot(diagram, heightById), 'json', 'dot'))
  const [, , , totalHeight] = String(parsed.bb).split(',').map(Number)
  const parentByEntity: Record<string, string | null | undefined> = Object.fromEntries(
    diagram.placements.map((p) => [p.entityId, p.parentId]),
  )

  const nodes: EngineResult['nodes'] = []
  const groups: EngineResult['groups'] = []
  for (const obj of parsed.objects ?? []) {
    if (obj.bb && Array.isArray(obj.nodes)) {
      // bb = "x0,y0,x1,y1" in points, Y-up; flip to top-left/Y-down below.
      const [x0, y0, x1, y1] = String(obj.bb).split(',').map(Number)
      const groupDef = diagram.groups.find((g) => `cluster_${g.id}` === obj.name)
      if (!groupDef) continue
      groups.push({ id: groupDef.id, x: x0, y: totalHeight - y1, width: x1 - x0, height: y1 - y0 })
    } else if (obj.pos && Object.prototype.hasOwnProperty.call(parentByEntity, obj.name)) {
      const [cx, cy] = String(obj.pos).split(',').map(Number)
      const h = heightById[obj.name] ?? 64
      nodes.push({ id: obj.name, x: cx - W / 2, y: totalHeight - (cy + h / 2), parentId: parentByEntity[obj.name] ?? null })
    }
  }
  return { nodes, groups }
}

export const runGraphvizFlat: FlatEngine = async (boxes, edges) => {
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
