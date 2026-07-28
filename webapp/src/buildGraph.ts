import { type Node, type Edge } from '@xyflow/react'
import { makeEdge, restyleEdge } from './graph'
import type { Diagram, Field, Group, Node as DNode, Template } from './model'

// React Flow requires a parent node to appear before its children in the
// nodes array. Groups can nest (Group.parentId -> another group), so emit
// them outer-to-inner: a group whose parentId points at another group comes
// after that parent. Stable: groups with no ordering constraint between them
// keep their original relative order.
function orderGroups(groups: Group[]): Group[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const ordered: Group[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()
  function visit(g: Group) {
    if (done.has(g.id) || visiting.has(g.id)) return // done, or a cycle — stop recursing
    visiting.add(g.id)
    const parent = g.parentId ? byId.get(g.parentId) : undefined
    if (parent) visit(parent)
    visiting.delete(g.id)
    if (!done.has(g.id)) {
      done.add(g.id)
      ordered.push(g)
    }
  }
  for (const g of groups) visit(g)
  return ordered
}

// A field shows on the card if it says so itself, or — absent that — if its
// template default says so and the node's own field didn't opt out.
function shownFields(node: DNode, tmpl: Template | undefined): { key: string; value: string }[] {
  const tmplShow = new Map((tmpl?.fields ?? []).map((tf) => [tf.key, tf.showOnNode === true]))
  return node.fields
    .filter((f: Field) => f.showOnNode === true || (tmplShow.get(f.key) === true && f.showOnNode !== false))
    .map((f) => ({ key: f.key, value: f.value }))
}

export function buildDiagramGraph(diagram: Diagram, templates: Template[] = []): { nodes: Node[]; edges: Edge[] } {
  const templatesById = new Map(templates.map((t) => [t.id, t]))
  const nodes: Node[] = []

  // groups first, outer-to-inner (parents before children)
  for (const g of orderGroups(diagram.groups)) {
    nodes.push({
      id: g.id,
      type: 'group',
      position: g.position,
      parentId: g.parentId ?? undefined,
      extent: g.parentId ? 'parent' : undefined,
      data: { label: g.label, color: g.color },
      style: { width: g.size.width, height: g.size.height },
      zIndex: -1, // group panes sit BEHIND edges (elevateNodesOnSelect lifts a selected group above them so its resize handles stay grabbable)
    })
  }
  for (const n of diagram.nodes) {
    const tmpl = n.template ? templatesById.get(n.template) : undefined
    nodes.push({
      id: n.id,
      type: 'service',
      position: n.position,
      parentId: n.parentId ?? undefined,
      extent: n.parentId ? 'parent' : undefined,
      data: {
        label: n.label,
        sub: n.sub,
        icon: n.icon,
        status: n.status,
        kind: n.actor ? 'actor' : undefined,
        shownFields: shownFields(n, tmpl),
      },
      zIndex: 2, // node cards sit ABOVE edges/labels
    })
  }
  for (const nt of diagram.notes) {
    nodes.push({
      id: nt.id,
      type: 'note',
      position: nt.position,
      parentId: nt.parentId ?? undefined,
      extent: nt.parentId ? 'parent' : undefined,
      data: { text: nt.text },
      style: { width: nt.size.width, height: nt.size.height },
      zIndex: 2,
    })
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
    edge.data = { ...edge.data, shape: de.shape ?? 'default', points: de.points, labelPos: de.labelPos }
    edge = restyleEdge(edge, de.type, !!de.inferred) // keeps id/source/target/data via spread
    return edge
  })

  return { nodes, edges }
}
