// Converting the live React Flow canvas back into the persisted model.
//
// Extracted from App.tsx, where these were unexported module-level helpers with
// no tests. flushCanvasInto is called from nine places and every canvas edit
// goes through nodesToDiagramParts, which is where the color -> scheme rename
// silently broke: it reads node data, and until that data was typed nothing
// checked the field names.
import type { Edge, Node } from '@xyflow/react'
import * as M from '../shared/model'
import type {
  Model,
  Node as MNode,
  Group as MGroup,
  Note as MNote,
  Edge as MEdge,
} from '../shared/model'
import { isGroupNode, isNoteNode, isServiceNode, type AppEdge } from './canvasData'
import { liveFootprint } from './graph'

// Map the live React Flow nodes back into the model's per-diagram arrays.
// Nodes are diagram-local now, so every field lives directly on the Node —
// EXCEPT `fields` and `template`, which the canvas never carries (there's no
// on-canvas UI for them); those are merged back in from the diagram's
// previous nodes (keyed by id) so a geometry-only write-back can't wipe them.
export function nodesToDiagramParts(
  nodes: Node[],
  prevNodesById: Map<string, MNode>,
): { nodes: MNode[]; groups: MGroup[]; notes: MNote[] } {
  const dNodes: MNode[] = []
  const groups: MGroup[] = []
  const notes: MNote[] = []
  for (const n of nodes) {
    if (isGroupNode(n)) {
      const d = n.data
      groups.push({
        id: n.id,
        label: d.label,
        color: d.color,
        position: n.position,
        parentId: n.parentId ?? undefined,
        size: {
          // Read the LIVE size (width → measured → style). A NodeResizer resize
          // updates top-level width/height + measured but NOT style, so reading
          // style alone here dropped every resize (see liveFootprint's note).
          width: liveFootprint(n).width || 320,
          height: liveFootprint(n).height || 200,
        },
      })
    } else if (isNoteNode(n)) {
      const d = n.data
      notes.push({
        id: n.id,
        text: d.text ?? '',
        scheme: d.scheme,
        position: n.position,
        parentId: n.parentId ?? undefined,
        size: {
          // Live size (width → measured → style) so note resizes persist —
          // NodeResizer writes width/measured, never style. Same fix as groups.
          width: liveFootprint(n).width || 190,
          height: liveFootprint(n).height || 110,
        },
      })
    } else if (isServiceNode(n)) {
      const d = n.data
      const prev = prevNodesById.get(n.id)
      dNodes.push({
        id: n.id,
        label: d.label,
        sub: d.sub || undefined,
        icon: d.icon || undefined,
        status: d.status || undefined,
        actor: d.kind === 'actor' ? true : undefined,
        note: (d.note as string) || undefined,
        scheme: d.scheme || undefined,
        template: prev?.template,
        fields: prev?.fields ?? [],
        position: n.position,
        parentId: n.parentId ?? undefined,
      })
    }
  }
  return { nodes: dNodes, groups, notes }
}

// `orientation` has no on-canvas UI either (server-side layout hint only) —
// preserve it from the diagram's previous edge, same reasoning as fields/template above.
export function edgesToDiagramEdges(edges: AppEdge[], prevEdgesById: Map<string, MEdge>): MEdge[] {
  return edges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    label: typeof e.label === 'string' ? e.label : undefined,
    inferred: !!e.data?.inferred,
    shape: e.data?.shape ?? 'default',
    points: e.data?.points,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    dir: e.data?.dir ?? 'forward',
    color: e.data?.color ?? undefined,
    labelPos: e.data?.labelPos,
    orientation: prevEdgesById.get(e.id)?.orientation,
  }))
}

// Flush the live canvas (nodes/edges) into the model for the given diagram:
// map node/group/note/edge geometry (and inline node fields) into the
// diagram's arrays. This is the pure form of the debounced write-back; call
// it before any model mutation so pending canvas edits aren't lost when the
// canvas is rebuilt from `model`.
export function flushCanvasInto(m: Model, diagramId: string, nodes: Node[], edges: Edge[]): Model {
  const d = M.getDiagram(m, diagramId)
  const prevNodesById = new Map((d?.nodes ?? []).map((n) => [n.id, n]))
  const prevEdgesById = new Map((d?.edges ?? []).map((e) => [e.id, e]))
  const parts = nodesToDiagramParts(nodes, prevNodesById)
  return M.patchDiagram(m, diagramId, {
    nodes: parts.nodes,
    groups: parts.groups,
    notes: parts.notes,
    edges: edgesToDiagramEdges(edges, prevEdgesById),
  })
}
