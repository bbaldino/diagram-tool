// Canvas paint order, in one place.
//
// These are the base layers. React Flow derives the rest: a nested node gets
// its parent's layer + 1 per level of containment, which is exactly the rule we
// want — a child group paints above its parent, and an entity inside a group
// paints above that group. So depth is not something we compute; we only choose
// where each kind STARTS and leave room for nesting.
//
// The bug this replaces: groups started at -1, one step below the edge layer at
// 0. That is fine while groups are flat, but one level of nesting put a child
// group AT 0 — on the edge layer — where its translucent pane covered the edges
// and edge labels crossing it, and they could not be clicked. Reproduced on
// 'repo-standards components', where Validation and Catalogs sit inside
// Packages. GROUP_BASE now leaves room for GROUP_NEST_HEADROOM levels.
export const LAYER = {
  /** Group panes. A pane must never hide what crosses it, so groups sit below
   *  the edge layer — far enough below to stay there when nested. */
  groupPane: -10,
  /** React Flow's edge layer (.react-flow__edges). */
  edge: 0,
  /** React Flow's edge label layer (.react-flow__edgelabel-renderer). */
  edgeLabel: 1,
  /** Node and note cards. Above edges: a card should cover an edge that runs
   *  beneath it. */
  nodeCard: 2,
} as const

/** How many levels of group nesting fit between groupPane and edge. */
export const GROUP_NEST_HEADROOM = LAYER.edge - LAYER.groupPane - 1
