// Pure node-array transforms behind the canvas editing handlers.
//
// The handlers in Flow() are mostly `setNodes((ns) => <computation>)`, and the
// computation is where the intricate rules live — cycle guards, child
// placement, growing a group to contain what was dropped into it. Extracting
// the computation makes it directly testable with no jsdom, no
// ReactFlowProvider and no mocking, and leaves the handler a thin wrapper.
//
// Deliberately does NOT change when or how setNodes is called: the canvas
// state machine and its sync effects see exactly the same sequence of updates
// as before. Only what computes the next array moved.
import type { Node } from '@xyflow/react'
import { descendantsOf, groupsFirst } from './canvasNodes'
import { liveFootprint, reflowGroups } from './graph'
import { placeInGroup } from '../shared/containment'

/**
 * Reparent the selected nodes into `parentId`, or un-parent them when it is
 * empty. `fallbackSelectedId` is used when nothing on the canvas is flagged
 * selected, which onSelectionChange normally prevents.
 *
 * Returns `ns` unchanged when there is nothing eligible to move.
 */
export function reparentNodes(
  ns: Node[],
  parentId: string,
  fallbackSelectedId: string | null,
): Node[] {
  // Multi-select aware: reparent EVERY selected node, not just the one the
  // inspector happens to be showing (selNode). Fall back to selNode when
  // nothing is flagged selected (defensive — onSelectionChange keeps them
  // in sync). This is what makes "select several entities, pick a group"
  // assign all of them, not only the first.
  const selectedIds = ns.filter((n) => n.selected).map((n) => n.id)
  const baseIds = selectedIds.length ? selectedIds : fallbackSelectedId ? [fallbackSelectedId] : []
  // Cycle guard per node: a node/group can't be parented to itself or to
  // one of its own descendants (only relevant for group-in-group nesting).
  const ids = parentId
    ? baseIds.filter((id) => id !== parentId && !descendantsOf(id, ns).has(parentId))
    : baseIds
  if (!ids.length) return ns
  const idSet = new Set(ids)

  if (!parentId) {
    // Un-parent all selected: strip parentId + drag extent.
    return groupsFirst(
      ns.map((n) => {
        if (!idSet.has(n.id)) return n
        const { parentId: _p, extent: _e, ...rest } = n as any
        return { ...rest }
      }),
    )
  }

  // liveFootprint returns 0×0 for service (entity) nodes, which would make
  // placeInGroup stack them 16px apart (overlapping). Use the live measured
  // size, falling back to a typical entity footprint, so the row spreads.
  const sizeOf = (n: any) => {
    const f = liveFootprint(n)
    if (f.width && f.height) return f
    const m = n.measured
    if (m?.width && m?.height) return { width: Number(m.width), height: Number(m.height) }
    return { width: 180, height: 72 }
  }
  // Lay each incoming node out left-to-right after the group's existing
  // children; seed the sibling list and append each placement so the next
  // one clears it (single-select behavior is unchanged — one node still
  // lands at GROUP_PAD/GROUP_NEST_TOP_PAD). reflowGroups then grows this
  // group (and ancestors) to contain the new row and recomputes extents.
  const siblings = ns
    .filter((n) => n.parentId === parentId && !idSet.has(n.id))
    .map((n) => ({ position: n.position, size: sizeOf(n) }))
  const posById = new Map<string, { x: number; y: number }>()
  for (const id of ids) {
    const child = ns.find((n) => n.id === id)
    const size = child ? sizeOf(child) : { width: 0, height: 0 }
    const pos = placeInGroup(size, siblings)
    posById.set(id, pos)
    siblings.push({ position: pos, size })
  }
  const reparented = groupsFirst(
    ns.map((n) => (idSet.has(n.id) ? { ...n, parentId, position: posById.get(n.id)! } : n)),
  )
  // reflowGroups grows a group via requiredGroupSize, which reads child
  // `size` — 0 for entity nodes — so it under-sizes a group that gains a
  // row of entities (they'd stick out the right edge). Grow the target
  // group here from the same measured/estimated footprints so it contains
  // the new row; reflowGroups then only ever grows further (never shrinks)
  // and fixes ancestors + child extents.
  const sized = reparented.map((n) => {
    if (n.id !== parentId) return n
    const kids = reparented.filter((c) => c.parentId === parentId)
    if (!kids.length) return n
    const farX = Math.max(...kids.map((c) => c.position.x + sizeOf(c).width))
    const farY = Math.max(...kids.map((c) => c.position.y + sizeOf(c).height))
    const g = n as any
    const curW = Number(g.width) || Number(g.style?.width) || 0
    const curH = Number(g.height) || Number(g.style?.height) || 0
    const width = Math.max(curW, farX + 16)
    const height = Math.max(curH, farY + 16)
    return { ...n, width, height, style: { ...n.style, width, height } }
  })
  return reflowGroups(sized)
}

/**
 * Set an explicit size on one group, leaving every other node alone.
 *
 * The current size is read measured -> width -> style -> default, because the
 * three disagree depending on how the group last changed: a NodeResizer drag
 * writes `width`/`height` and `measured` but never `style`, while a group built
 * from the model has only `style`. Reading any single one of them dropped
 * resizes. An omitted dimension keeps the current value, so the width and
 * height inputs can be edited independently.
 *
 * Writes both the top-level width/height and style so the next read agrees
 * whichever source it consults.
 */
export function resizeGroup(
  ns: Node[],
  id: string,
  size: { width?: number; height?: number },
): Node[] {
  return ns.map((n) => {
    if (n.id !== id) return n
    const g = n as Node & {
      measured?: { width?: number; height?: number }
      width?: number
      height?: number
    }
    const style = n.style as { width?: number | string; height?: number | string } | undefined
    const curW = Number(g.measured?.width) || Number(g.width) || Number(style?.width) || 320
    const curH = Number(g.measured?.height) || Number(g.height) || Number(style?.height) || 200
    const width = size.width ?? curW
    const height = size.height ?? curH
    return { ...n, width, height, style: { ...n.style, width, height } }
  })
}
