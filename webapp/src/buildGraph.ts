import { type Node, type Edge } from '@xyflow/react'
import { makeEdge, restyleEdge } from './graph'
import { fieldVisible, type Diagram, type Entity, type Template } from './model'

export function buildDiagramGraph(diagram: Diagram, byId: Record<string, Entity>, templates: Template[] = []): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  // groups first (parents before children)
  for (const g of diagram.groups) {
    nodes.push({
      id: g.id,
      type: 'group',
      position: g.position,
      data: { label: g.label, color: g.color },
      style: { width: g.size.width, height: g.size.height },
      zIndex: -1, // group panes sit BEHIND edges (elevateNodesOnSelect lifts a selected group above them so its resize handles stay grabbable)
    })
  }
  for (const p of diagram.placements) {
    const e = byId[p.entityId]
    if (!e) continue // entity deleted from catalog; skip stale placement
    const tmpl = e.template ? templates.find((t) => t.id === e.template) : undefined
    const shownFields = (e.fields ?? []).filter((f) => fieldVisible(p, e, tmpl, f.key)).map((f) => ({ key: f.key, value: f.value }))
    nodes.push({
      id: e.id,
      type: 'service',
      position: p.position,
      parentId: p.parentId ?? undefined,
      extent: p.parentId ? 'parent' : undefined,
      data: { label: e.label, sub: e.sub, icon: e.icon, status: e.status, kind: e.kind, shownFields, note: p.note },
      zIndex: 2, // node cards sit ABOVE edges/labels
    })
  }
  for (const n of diagram.notes) {
    nodes.push({ id: n.id, type: 'note', position: n.position, data: { text: n.text }, style: { width: n.size.width, height: n.size.height }, zIndex: 2 })
  }
  const edges: Edge[] = diagram.edges.map((de, i) => {
    // Existing edges predate multi-side handles → default to right→left forward.
    let edge = makeEdge(de.from, de.to, de.type, de.label, de.inferred, i, {
      sourceHandle: de.sourceHandle ?? 'right',
      targetHandle: de.targetHandle ?? 'left',
      dir: de.dir ?? 'forward',
      color: de.color,
    })
    edge.id = de.id
    edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points }
    edge = restyleEdge(edge, de.type, !!de.inferred) // keeps id/source/target/data via spread
    return edge
  })
  return { nodes, edges }
}
