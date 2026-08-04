import { type Node, type Edge } from '@xyflow/react'
import { makeEdge, restyleEdge, topoOrderByParent, paddedExtent } from './graph'
import type { Diagram, Field, Node as DNode, Template } from './model'

// A field shows on the card if it says so itself, or — absent that — if its
// template default says so and the node's own field didn't opt out.
function shownFields(node: DNode, tmpl: Template | undefined): { key: string; value: string }[] {
  const tmplShow = new Map((tmpl?.fields ?? []).map((tf) => [tf.key, tf.showOnNode === true]))
  return node.fields
    .filter(
      (f: Field) =>
        f.showOnNode === true || (tmplShow.get(f.key) === true && f.showOnNode !== false),
    )
    .map((f) => ({ key: f.key, value: f.value }))
}

export function buildDiagramGraph(
  diagram: Diagram,
  templates: Template[] = [],
): { nodes: Node[]; edges: Edge[] } {
  const templatesById = new Map(templates.map((t) => [t.id, t]))
  const groupsById = new Map(diagram.groups.map((g) => [g.id, g]))
  const nodes: Node[] = []

  // The drag-clamp `extent` for a parented child: a padded box inside the
  // parent's model size, backed off further by the child's own size (service
  // nodes have no model size, so they pass {0,0} — a top-left padded clamp).
  // Falls back to the plain RF 'parent' clamp if the parentId doesn't
  // resolve to a known group (shouldn't happen, but keeps this defensive).
  function clampExtent(parentId: string | undefined, childSize: { width: number; height: number }) {
    if (!parentId) return undefined
    const parent = groupsById.get(parentId)
    return parent ? paddedExtent(parent.size, childSize) : ('parent' as const)
  }

  // groups first, outer-to-inner (parents before children)
  for (const g of topoOrderByParent(diagram.groups)) {
    nodes.push({
      id: g.id,
      type: 'group',
      position: g.position,
      parentId: g.parentId ?? undefined,
      extent: clampExtent(g.parentId, g.size),
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
      extent: clampExtent(n.parentId, { width: 0, height: 0 }),
      data: {
        label: n.label,
        sub: n.sub,
        icon: n.icon,
        status: n.status,
        scheme: n.scheme,
        kind: n.actor ? 'actor' : undefined,
        shownFields: shownFields(n, tmpl),
        note: n.note,
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
      extent: clampExtent(nt.parentId, nt.size),
      data: { text: nt.text, scheme: nt.scheme },
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
    edge.data = {
      ...edge.data,
      shape: de.shape ?? 'default',
      points: de.points,
      labelPos: de.labelPos,
    }
    edge = restyleEdge(edge, de.type, !!de.inferred) // keeps id/source/target/data via spread
    return edge
  })

  return { nodes, edges }
}
