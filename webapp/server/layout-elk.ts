import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { Diagram } from '../src/model'
import { W, type EngineAdapter, type EngineResult } from './layout'

// A group is an ELK parent node whose children are its members (real
// hierarchy). Cross-group edges declared at the root only affect layout with
// `elk.hierarchyHandling: INCLUDE_CHILDREN`. ELK returns coords relative to the
// immediate parent, so we walk the tree accumulating absolute offsets.
const elk = new ELK()

export const runElk: EngineAdapter = async (diagram, heightById): Promise<EngineResult> => {
  const groupIds = new Set(diagram.groups.map((g) => g.id))
  const placedIds = new Set(diagram.placements.map((p) => p.entityId))
  const groupChildren: Record<string, ElkNode[]> = {}
  for (const g of diagram.groups) groupChildren[g.id] = []
  const rootChildren: ElkNode[] = []

  for (const p of diagram.placements) {
    const leaf: ElkNode = { id: p.entityId, width: W, height: heightById[p.entityId] ?? 64 }
    if (p.parentId && groupChildren[p.parentId]) groupChildren[p.parentId].push(leaf)
    else rootChildren.push(leaf)
  }
  for (const g of diagram.groups) {
    rootChildren.push({
      id: g.id,
      layoutOptions: { 'elk.padding': '[top=36,left=16,bottom=16,right=16]' },
      children: groupChildren[g.id],
    })
  }

  const edges: ElkExtendedEdge[] = diagram.edges
    .filter((e) => placedIds.has(e.from) && placedIds.has(e.to))
    .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
    },
    children: rootChildren,
    edges,
  }

  const result = await elk.layout(graph)
  const nodes: EngineResult['nodes'] = []
  const groups: EngineResult['groups'] = []
  const parentByEntity: Record<string, string | null | undefined> = Object.fromEntries(
    diagram.placements.map((p) => [p.entityId, p.parentId]),
  )

  const walk = (node: ElkNode, offsetX: number, offsetY: number): void => {
    const absX = offsetX + (node.x ?? 0)
    const absY = offsetY + (node.y ?? 0)
    if (groupIds.has(node.id)) {
      groups.push({ id: node.id, x: absX, y: absY, width: node.width ?? 0, height: node.height ?? 0 })
    } else if (node.id !== 'root') {
      nodes.push({ id: node.id, x: absX, y: absY, parentId: parentByEntity[node.id] ?? null })
    }
    for (const child of node.children ?? []) walk(child, absX, absY)
  }
  walk(result, 0, 0)

  return { nodes, groups }
}
