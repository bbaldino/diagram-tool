import type { Diagram, Group } from './model'

// ---- Nested-group geometry ----
// Every child (node/note/group) keeps this much clearance from its parent
// group's top/left/right/bottom edges. Without it, a nested child sized ~as
// big as its parent gets clamped by RF's extent:'parent' to the parent's
// top-left corner, and the two boxes — and their `.group__label` titles,
// which render just above the box — end up coincident.
export const GROUP_PAD = 16
// A group can never be smaller than this (matches the GroupNode NodeResizer's
// own minWidth/minHeight, so the interactive resize floor and the model floor
// agree).
export const GROUP_MIN = { width: 220, height: 130 }

// Extra top clearance — used both for a freshly-nested child's STARTING
// position (App.tsx's reparent) AND as paddedExtent's top drag-clamp bound,
// so the clearance holds uniformly whether a child lands there on nest or
// gets dragged there afterwards. requiredGroupSize stays GROUP_PAD-uniform
// (it derives its floor from the child's actual position, which is itself
// clamped by paddedExtent, so it never needs its own top-pad notion).
// A group's `.group__label` (index.css) renders as a header INSIDE its box's
// top strip, so a child placed flush at GROUP_PAD from its parent's top edge
// would sit under that header. This top pad reserves the header's height so a
// child clears it — comfortably bigger than the label's rendered footprint
// (~19px line box + a little breathing room) — whether the child lands there
// on nest or is dragged up to the top of its clamped range. (The label used to
// float just ABOVE the box; moving it inside made this reserved strip read as
// the title area instead of empty padding, without changing this value.)
export const GROUP_NEST_TOP_PAD = 32

// Extra room left on the far side when a group is grown to fit its children
// (see growGroupsToFitChildren). Without this, a group grown to EXACTLY fit
// its (largest) child leaves that child's paddedExtent collapsed to a single
// point — [pad,pad] on both ends — so it can be placed but never dragged.
// Must be bigger than (GROUP_NEST_TOP_PAD - GROUP_PAD) so the top-pad's
// extra clearance doesn't eat the whole slack on the y axis too.
export const GROUP_SLACK = 40

// The smallest size that contains every child with GROUP_PAD clearance on
// the right/bottom (children are kept >=pad from the top/left by the
// position clamp, so only the far edge needs accounting for here), floored
// at `min` on each axis.
export function requiredGroupSize(
  children: { position: { x: number; y: number }; size: { width: number; height: number } }[],
  pad = GROUP_PAD,
  min: { width: number; height: number } = GROUP_MIN,
): { width: number; height: number } {
  let width = min.width
  let height = min.height
  for (const c of children) {
    width = Math.max(width, c.position.x + c.size.width + pad)
    height = Math.max(height, c.position.y + c.size.height + pad)
  }
  return { width, height }
}

// The React Flow `extent` box that keeps a child within its parent's padded
// region — i.e. the drag-clamp equivalent of `requiredGroupSize`. Top-left
// is [padX, padTop] — padTop uses GROUP_NEST_TOP_PAD (not GROUP_PAD) so the
// clamp holds the SAME title clearance whether a child lands there on nest
// or gets dragged there afterwards; without this, a child dragged straight
// up could still park at y=GROUP_PAD and re-crowd its title against the
// parent's (both render in the same strip just above each box — see
// GROUP_NEST_TOP_PAD). Left stays GROUP_PAD since there's no horizontal
// label-collision risk. Bottom-right is the padded region's far edge
// (parentSize - pad) — NOT pre-backed-off by the child's own size: RF's own
// clampPosition (@xyflow/system) already subtracts the dragged/rendered
// node's `measured` width/height from extent[1] before clamping
// node.position, both on mount (calculateChildXYZ) and on drag
// (calculateNodePosition). Subtracting childSize here too would double it,
// which inverts the clamp (max < min) whenever the child is close to the
// available room — exactly the nested-similar-size-groups case this whole
// fix targets — and RF's clamp() then snaps the node to that (very
// negative) max instead of holding it at min. `childSize` is still taken so
// we can floor the bound at `pad + childSize` for the (should-be-rare) case
// of a child bigger than the parent's padded interior, keeping RF's
// internal subtraction from going negative there too.
export function paddedExtent(
  parentSize: { width: number; height: number },
  childSize: { width: number; height: number },
  padX = GROUP_PAD,
  padTop = GROUP_NEST_TOP_PAD,
): [[number, number], [number, number]] {
  return [
    [padX, padTop],
    [
      Math.max(padX + childSize.width, parentSize.width - padX),
      Math.max(padTop + childSize.height, parentSize.height - padX),
    ],
  ]
}

// Starting position for a child newly nested INTO a group, chosen so it
// doesn't land on top of a sibling already there. Every previously-nested
// child used to start at the same fixed (GROUP_PAD, GROUP_NEST_TOP_PAD), so
// nesting a second thing (e.g. a note and a group) into the same parent
// stacked them exactly on top of each other. No siblings → same padded
// top-left as before. Otherwise a simple row layout: place the child just
// right of every existing sibling's bounding box, at the same top
// clearance — good enough for the common few-children case without full
// bin-packing (see task notes; deliberately not over-engineered).
// `childSize` isn't needed by this row-layout strategy (only the far edge of
// the existing siblings matters) but stays in the signature so a denser
// future packing strategy — e.g. wrapping to a new row once a row fills up —
// can use it without changing callers.
export function placeInGroup(
  _childSize: { width: number; height: number },
  existingSiblings: { position: { x: number; y: number }; size: { width: number; height: number } }[],
  padX = GROUP_PAD,
  padTop = GROUP_NEST_TOP_PAD,
  gap = 16,
): { x: number; y: number } {
  if (!existingSiblings.length) return { x: padX, y: padTop }
  const rightEdge = Math.max(...existingSiblings.map((s) => s.position.x + s.size.width))
  return { x: rightEdge + gap, y: padTop }
}

// Best-known model-level footprint of a node CHILD for containment math.
// Nodes carry no explicit model size (unlike groups/notes), so a fixed
// estimate stands in for their on-canvas footprint (matches the ServiceNode's
// typical rendered size closely enough for containment purposes).
export const NODE_EST_SIZE = { width: 170, height: 64 }

// Model-level counterpart to graph.ts's growGroupsToFitChildren: grow every
// group in `diagram.groups` (innermost first, so an outer group's required
// size accounts for its inner group's just-grown size rather than its stale
// one) to contain its current children — other groups, nodes, and notes —
// with GROUP_PAD clearance plus GROUP_SLACK, floored at GROUP_MIN. Only ever
// grows — never shrinks a group below what it already needs to contain its
// existing kids. Node children carry no model size, so NODE_EST_SIZE stands
// in for their footprint; group/note children use their own `size`. Returns
// a new Diagram — the input is left untouched.
export function reflowContainment(diagram: Diagram): Diagram {
  const groups = diagram.groups
  if (!groups.length) return diagram

  // Depth of each group along its parentId chain (0 = top-level), used to
  // process groups innermost-first — a nested group's grown size must be
  // settled before its parent's required size is computed from it.
  const groupById = new Map(groups.map((g) => [g.id, g]))
  function depth(g: Group, seen: Set<string> = new Set()): number {
    if (!g.parentId || seen.has(g.id)) return 0
    const parent = groupById.get(g.parentId)
    if (!parent) return 0
    seen.add(g.id)
    return 1 + depth(parent, seen)
  }
  const order = [...groups].sort((a, b) => depth(b) - depth(a))

  const sizeById = new Map(groups.map((g) => [g.id, g.size]))
  for (const g of order) {
    const childGroups = groups
      .filter((c) => c.parentId === g.id)
      .map((c) => ({ position: c.position, size: sizeById.get(c.id)! }))
    const childNodes = diagram.nodes
      .filter((n) => n.parentId === g.id)
      .map((n) => ({ position: n.position, size: NODE_EST_SIZE }))
    const childNotes = diagram.notes
      .filter((n) => n.parentId === g.id)
      .map((n) => ({ position: n.position, size: n.size }))
    const kids = [...childGroups, ...childNodes, ...childNotes]
    const required = requiredGroupSize(kids)
    const slack = kids.length ? GROUP_SLACK : 0
    const current = sizeById.get(g.id)!
    sizeById.set(g.id, {
      width: Math.max(current.width, required.width + slack),
      height: Math.max(current.height, required.height + slack),
    })
  }

  return {
    ...diagram,
    groups: diagram.groups.map((g) => ({ ...g, size: sizeById.get(g.id)! })),
  }
}
