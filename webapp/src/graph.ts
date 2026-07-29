import { type Node, type Edge, type Connection, reconnectEdge, MarkerType } from '@xyflow/react'

// dashboard-icons (homarr-labs) — same set used in the D2 diagram
export const ICON_BASE =
  'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

// Topologically order items so every item with a parentId comes after its
// parent. Needed because React Flow's `adoptUserNodes` is a single forward
// pass over the `nodes` array: a child appearing before its parent doesn't
// get its `positionAbsolute` resolved against the parent, so it renders
// mispositioned/clipped wrong and RF logs "Parent node not found... parent
// nodes must be in front of their child nodes." Groups can nest (a group's
// parentId can point at another group), so "groups before non-groups" alone
// isn't enough — the groups themselves must be emitted outer-to-inner.
// Generic over anything id/parentId-shaped (model Group[] or live RF Node[])
// so buildGraph.ts (model → canvas) and App.tsx (live canvas mutations) share
// one implementation and can't drift apart. Stable: items with no ordering
// constraint between them keep their original relative order. A cycle
// (shouldn't happen) just stops recursing instead of looping forever.
export function topoOrderByParent<T extends { id: string; parentId?: string | null }>(items: T[]): T[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const ordered: T[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()
  function visit(it: T) {
    if (done.has(it.id) || visiting.has(it.id)) return // done, or a cycle — stop recursing
    visiting.add(it.id)
    const parent = it.parentId ? byId.get(it.parentId) : undefined
    if (parent) visit(parent)
    visiting.delete(it.id)
    if (!done.has(it.id)) {
      done.add(it.id)
      ordered.push(it)
    }
  }
  for (const it of items) visit(it)
  return ordered
}

// ---- Relationship vocabulary (this is the "typed edges" bit) ----
export type RelType =
  | 'talks-to'
  | 'via'
  | 'writes-to'
  | 'reads-from'
  | 'proxies'
  | 'monitors'

export const REL: Record<RelType, { color: string; label: string }> = {
  'talks-to': { color: '#64748b', label: 'talks to' },
  via: { color: '#6366f1', label: 'via' },
  'writes-to': { color: '#16a34a', label: 'writes to' },
  'reads-from': { color: '#2563eb', label: 'reads from' },
  proxies: { color: '#ea580c', label: 'proxies' },
  monitors: { color: '#9333ea', label: 'monitors' },
}

type Status = 'up' | 'down' | 'idle'
interface N {
  id: string
  label: string
  icon?: string
  sub?: string
  status?: Status
  kind?: 'actor'
}
interface G {
  id: string
  label: string
  color: string
  nodes: N[]
}
interface E {
  from: string
  to: string
  type: RelType
  label?: string
  inferred?: boolean
}

// ---- Groups + service nodes (status from Unraid docker state) ----
const GROUPS: G[] = [
  {
    id: 'edge',
    label: 'Infra / Auth',
    color: '#e05252',
    nodes: [
      { id: 'npm', label: 'Nginx Proxy Manager', icon: 'nginx-proxy-manager', sub: ':80 / :443 / :81', status: 'up' },
      { id: 'authelia', label: 'Authelia (SSO)', icon: 'authelia', sub: ':9091', status: 'up' },
      { id: 'postgres', label: 'PostgreSQL 15', icon: 'postgresql', sub: ':5432', status: 'up' },
    ],
  },
  {
    id: 'mcp',
    label: 'MCP bridges',
    color: '#0ca5b0',
    nodes: [
      { id: 'mcparr', label: 'mcp-arr', sub: ':8089', status: 'up' },
      { id: 'mcpplex', label: 'mcp-plex', sub: ':8087', status: 'up' },
      { id: 'mcpunraid', label: 'mcp-unraid', sub: ':8088', status: 'up' },
      { id: 'npmmcp', label: 'npm-mcp', status: 'up' },
      { id: 'camproxy', label: 'cam-proxy', status: 'up' },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    color: '#2f6fed',
    nodes: [
      { id: 'plex', label: 'Plex', icon: 'plex', sub: ':32400', status: 'up' },
      { id: 'sonarr', label: 'Sonarr', icon: 'sonarr', sub: ':8085', status: 'up' },
      { id: 'radarr', label: 'Radarr', icon: 'radarr', sub: ':7878', status: 'up' },
      { id: 'hydra', label: 'NZBHydra2', icon: 'nzbhydra2', sub: ':5076', status: 'up' },
      { id: 'sab', label: 'SABnzbd', icon: 'sabnzbd', sub: ':8081', status: 'up' },
      { id: 'recyclarr', label: 'Recyclarr', icon: 'recyclarr', sub: 'on-demand', status: 'idle' },
      { id: 'handbrake', label: 'HandBrake', icon: 'handbrake', sub: 'on-demand', status: 'idle' },
      { id: 'library', label: 'Media library', sub: 'array shares', status: 'up' },
    ],
  },
  {
    id: 'home',
    label: 'Home Automation',
    color: '#2f9e44',
    nodes: [
      { id: 'hass', label: 'Home Assistant', icon: 'home-assistant', sub: ':8123', status: 'up' },
      { id: 'zwave', label: 'Z-Wave JS UI', icon: 'z-wave-js-ui', sub: ':3000', status: 'up' },
      { id: 'mqtt', label: 'Mosquitto', icon: 'mosquitto', sub: ':1883', status: 'up' },
      { id: 'ma', label: 'Music Assistant', icon: 'music-assistant', sub: ':8095', status: 'up' },
      { id: 'frigate', label: 'Frigate (NVR)', icon: 'frigate', sub: 'panopticon:5000', status: 'up' },
    ],
  },
  {
    id: 'ai',
    label: 'AI / Voice',
    color: '#9b51e0',
    nodes: [
      { id: 'ollama', label: 'Ollama', icon: 'ollama', sub: ':11434', status: 'up' },
      { id: 'openwebui', label: 'Open-WebUI', icon: 'open-webui', sub: ':8020', status: 'up' },
      { id: 'whisper', label: 'Faster-Whisper', sub: 'STT · GPU', status: 'up' },
      { id: 'piper', label: 'Piper', sub: 'TTS · GPU', status: 'up' },
      { id: 'kokoro', label: 'Kokoro', sub: 'TTS · GPU', status: 'up' },
      { id: 'comfy', label: 'ComfyUI', icon: 'comfyui', sub: 'on-demand', status: 'idle' },
      { id: 'ttsproxy', label: 'tts-pronunciation-proxy', status: 'up' },
      { id: 'pipermgr', label: 'piper-voice-manager', status: 'up' },
      { id: 'wakeword', label: 'wakeword-training', status: 'up' },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    color: '#d9a406',
    nodes: [
      { id: 'dashboard', label: 'Family Dashboard', sub: ':3042', status: 'up' },
      { id: 'health', label: 'Homelab Health', sub: ':7077', status: 'up' },
      { id: 'linkding', label: 'Linkding', icon: 'linkding', sub: ':9099', status: 'up' },
      { id: 'mealie', label: 'Mealie', icon: 'mealie', sub: 'on-demand', status: 'idle' },
      { id: 'crafty', label: 'Crafty', icon: 'crafty-controller', sub: 'Minecraft', status: 'up' },
      { id: 'trek', label: 'TREK', sub: ':3039', status: 'up' },
      { id: 'caas', label: 'caas', sub: 'box .21:8080', status: 'up' },
      { id: 'tars', label: 'tars', sub: 'box .21:8787', status: 'up' },
      { id: 'workout', label: 'workout', sub: 'box .21:5273', status: 'up' },
    ],
  },
  {
    id: 'devices',
    label: 'Smart-home devices',
    color: '#6b7280',
    nodes: [
      { id: 'cameras', label: 'Cameras', sub: 'doorbell / yard / gate' },
      { id: 'zwave_dev', label: 'Z-Wave devices', sub: 'locks / sensors' },
      { id: 'mqtt_dev', label: 'MQTT sensors' },
      { id: 'integrations', label: 'Cloud integrations', sub: 'Rachio / UniFi / …' },
    ],
  },
]

const ACTORS: N[] = [
  { id: 'users', label: 'Internet users', kind: 'actor' },
  { id: 'claude', label: 'You / Claude', kind: 'actor' },
]

// ---- Edges (relationship-typed). inferred = dashed = a guess to confirm ----
const EDGES: E[] = [
  // external entry / auth
  { from: 'users', to: 'npm', type: 'via', label: 'HTTPS' },
  { from: 'npm', to: 'authelia', type: 'via', label: 'forward-auth' },
  { from: 'npm', to: 'media', type: 'proxies', label: 'reverse proxy' },
  { from: 'npm', to: 'hass', type: 'proxies' },
  { from: 'npm', to: 'ollama', type: 'proxies' },
  { from: 'npm', to: 'openwebui', type: 'proxies' },
  { from: 'npm', to: 'apps', type: 'proxies' },
  { from: 'npm', to: 'frigate', type: 'proxies' },
  // media pipeline
  { from: 'sonarr', to: 'hydra', type: 'talks-to', label: 'search indexers' },
  { from: 'radarr', to: 'hydra', type: 'talks-to', label: 'search indexers' },
  { from: 'sonarr', to: 'sab', type: 'talks-to', label: 'send download' },
  { from: 'radarr', to: 'sab', type: 'talks-to', label: 'send download' },
  { from: 'sab', to: 'library', type: 'writes-to', label: 'downloads' },
  { from: 'sonarr', to: 'library', type: 'writes-to', label: 'import' },
  { from: 'radarr', to: 'library', type: 'writes-to', label: 'import' },
  { from: 'plex', to: 'library', type: 'reads-from', label: 'streams' },
  { from: 'recyclarr', to: 'sonarr', type: 'writes-to', label: 'sync config' },
  { from: 'recyclarr', to: 'radarr', type: 'writes-to', label: 'sync config' },
  { from: 'handbrake', to: 'library', type: 'writes-to', label: 'transcode', inferred: true },
  // voice pipeline
  { from: 'hass', to: 'whisper', type: 'talks-to', label: 'STT' },
  { from: 'hass', to: 'piper', type: 'talks-to', label: 'TTS' },
  { from: 'hass', to: 'kokoro', type: 'talks-to', label: 'TTS', inferred: true },
  { from: 'hass', to: 'ollama', type: 'talks-to', label: 'conversation' },
  { from: 'ttsproxy', to: 'piper', type: 'talks-to', label: 'pronunciation', inferred: true },
  { from: 'pipermgr', to: 'piper', type: 'writes-to', label: 'manages voices', inferred: true },
  { from: 'openwebui', to: 'ollama', type: 'talks-to', label: 'chat UI' },
  // home automation hub
  { from: 'zwave', to: 'hass', type: 'talks-to', label: 'Z-Wave JS' },
  { from: 'mqtt', to: 'hass', type: 'talks-to', label: 'MQTT' },
  { from: 'ma', to: 'hass', type: 'talks-to', label: 'media control' },
  { from: 'frigate', to: 'hass', type: 'talks-to', label: 'camera events' },
  { from: 'frigate', to: 'mqtt', type: 'writes-to', label: 'detections' },
  { from: 'zwave_dev', to: 'zwave', type: 'talks-to' },
  { from: 'cameras', to: 'frigate', type: 'talks-to' },
  { from: 'mqtt_dev', to: 'mqtt', type: 'talks-to' },
  { from: 'integrations', to: 'hass', type: 'talks-to' },
  // apps wiring (mostly inferred)
  { from: 'mealie', to: 'postgres', type: 'talks-to', label: 'database', inferred: true },
  { from: 'dashboard', to: 'hass', type: 'reads-from', label: 'entities', inferred: true },
  { from: 'dashboard', to: 'postgres', type: 'talks-to', label: 'database', inferred: true },
  { from: 'authelia', to: 'postgres', type: 'talks-to', label: 'session store', inferred: true },
  { from: 'health', to: 'mcpunraid', type: 'monitors', label: 'host status', inferred: true },
  // MCP bridges (what Claude talks to)
  { from: 'claude', to: 'mcparr', type: 'talks-to' },
  { from: 'claude', to: 'mcpplex', type: 'talks-to' },
  { from: 'claude', to: 'mcpunraid', type: 'talks-to' },
  { from: 'claude', to: 'npmmcp', type: 'talks-to' },
  { from: 'mcparr', to: 'sonarr', type: 'reads-from' },
  { from: 'mcparr', to: 'radarr', type: 'reads-from' },
  { from: 'mcpplex', to: 'plex', type: 'reads-from' },
  { from: 'npmmcp', to: 'npm', type: 'reads-from' },
  { from: 'camproxy', to: 'cameras', type: 'reads-from', label: 'streams', inferred: true },
]

// group color lookup (used by the minimap)
export const GROUP_COLOR: Record<string, string> = Object.fromEntries(
  GROUPS.map((g) => [g.id, g.color]),
)

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
// A group's `.group__label` (index.css) renders in the strip just above its
// OWN box, so a child placed flush at GROUP_PAD from its parent's top edge
// has its title collide with the parent's title, which sits in that same
// strip just above the parent. This is comfortably bigger than the label's
// rendered footprint (~19px line box + 5px margin ≈ 24px) so the two titles
// never touch, whether right after a nest or after dragging the child back
// up to the top of its clamped range.
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

// Best-known on-canvas footprint of a live RF node, for sizing/clamping
// groups around their children. Groups and notes carry an explicit size
// (style.width/height, falling back to RF's measured size once rendered);
// service nodes are sized by CSS with no model dimension, so they're treated
// as zero-footprint — GROUP_PAD/GROUP_MIN keep them comfortably inside their
// parent regardless.
export function liveFootprint(n: Node): { width: number; height: number } {
  if (n.type === 'group' || n.type === 'note') {
    const style = n.style as { width?: number; height?: number } | undefined
    const measured = (n as { measured?: { width?: number; height?: number } }).measured
    return {
      width: Number(style?.width) || Number(measured?.width) || 0,
      height: Number(style?.height) || Number(measured?.height) || 0,
    }
  }
  return { width: 0, height: 0 }
}

// Grow every group (innermost first, so an outer group's required size
// accounts for its inner group's just-grown size rather than its stale one)
// to contain its current children with GROUP_PAD clearance, floored at
// GROUP_MIN. Only ever grows — never shrinks a group below what it already
// needs to contain its existing kids. Because GROUP_PAD > 0 and a nested
// group's own position is clamped to >=GROUP_PAD, a parent grown this way is
// always strictly bigger than any group it directly contains.
//
// A group WITH children also gets GROUP_SLACK added past what's strictly
// required: growing exactly to fit (esp. a lone child) leaves that child's
// paddedExtent collapsed to a single point — placed, but never draggable.
// An empty group has nothing to leave room for, so it stays at GROUP_MIN
// (no slack) rather than growing for no reason.
export function growGroupsToFitChildren(nodes: Node[]): Node[] {
  const groups = nodes.filter((n) => n.type === 'group')
  if (!groups.length) return nodes
  const sizeById = new Map(nodes.map((n) => [n.id, liveFootprint(n)]))
  for (const g of topoOrderByParent(groups).reverse()) {
    const kids = nodes
      .filter((n) => n.parentId === g.id)
      .map((n) => ({ position: n.position, size: sizeById.get(n.id)! }))
    const required = requiredGroupSize(kids)
    const slack = kids.length ? GROUP_SLACK : 0
    const current = sizeById.get(g.id)!
    sizeById.set(g.id, {
      width: Math.max(current.width, required.width + slack),
      height: Math.max(current.height, required.height + slack),
    })
  }
  return nodes.map((n) => {
    if (n.type !== 'group') return n
    const { width, height } = sizeById.get(n.id)!
    return { ...n, style: { ...n.style, width, height } }
  })
}

// Grow groups to fit their children (see growGroupsToFitChildren), then
// recompute every parented node's drag `extent` from the (possibly just-
// grown) parent size — so a reparent/nest is immediately reflected both in
// the parent's box and in every child's drag clamp, not just the one that
// moved.
export function reflowGroups(nodes: Node[]): Node[] {
  const grown = growGroupsToFitChildren(nodes)
  const byId = new Map(grown.map((n) => [n.id, n]))
  return grown.map((n) => {
    if (!n.parentId) return n
    const parent = byId.get(n.parentId)
    if (!parent) return n
    return { ...n, extent: paddedExtent(liveFootprint(parent), liveFootprint(n)) }
  })
}
const PARENT_OF: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.nodes.map((n) => [n.id, g.id])),
)
export function parentGroup(id: string): string | undefined {
  return PARENT_OF[id]
}

// Edge direction: which ends carry an arrowhead. Decoupled from which handles
// the edge attaches to, so geometry (layout) and semantics (one/two-way) are
// independent. forward = arrow at target (default); backward = arrow at source;
// both = arrows at both ends (two-way / request-response).
export type EdgeDir = 'forward' | 'backward' | 'both'

function markersFor(dir: EdgeDir, color: string) {
  const arrow = { type: MarkerType.ArrowClosed, color, width: 15, height: 15 }
  return {
    markerStart: dir === 'backward' || dir === 'both' ? arrow : undefined,
    markerEnd: dir === 'forward' || dir === 'both' ? arrow : undefined,
  }
}

export function makeEdge(
  from: string,
  to: string,
  type: RelType,
  label?: string,
  inferred?: boolean,
  i = Math.floor(performance.now()),
  extra?: { sourceHandle?: string; targetHandle?: string; dir?: EdgeDir; color?: string },
): Edge {
  const r = REL[type]
  const dir = extra?.dir ?? 'forward'
  // Per-edge color override; falls back to the relationship type's color.
  const color = extra?.color ?? r.color
  return {
    id: `e${i}-${from}-${to}`,
    source: from,
    target: to,
    sourceHandle: extra?.sourceHandle,
    targetHandle: extra?.targetHandle,
    type: 'waypoint',
    label,
    interactionWidth: 26, // wider invisible hit area — edges are easy to click
    ...markersFor(dir, color),
    style: {
      stroke: color,
      strokeWidth: 2,
      strokeDasharray: inferred ? '5 4' : undefined,
      opacity: inferred ? 0.8 : 1,
    },
    labelStyle: { fontSize: 10, fill: color, fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [3, 2],
    labelBgBorderRadius: 3,
    data: { rel: type, inferred: !!inferred, shape: 'default', dir, color: extra?.color },
  }
}

export const REL_TYPES = Object.keys(REL) as RelType[]

// Re-apply relationship styling to an existing edge (used when its type changes).
export function restyleEdge(e: Edge, type: RelType, inferred: boolean): Edge {
  const r = REL[type]
  const dir = ((e.data?.dir as EdgeDir) ?? 'forward')
  const colorOverride = e.data?.color as string | undefined
  const color = colorOverride ?? r.color
  return {
    ...e,
    ...markersFor(dir, color),
    style: {
      stroke: color,
      strokeWidth: 2,
      strokeDasharray: inferred ? '5 4' : undefined,
      opacity: inferred ? 0.8 : 1,
    },
    labelStyle: { fontSize: 10, fill: color, fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [3, 2],
    labelBgBorderRadius: 3,
    data: { ...(e.data ?? {}), rel: type, inferred, color: colorOverride },
  }
}

// Rewire one edge's endpoint to a new connection. Keeps the edge id stable
// (shouldReplaceId:false — the default REGENERATES it, which would break flow
// references and our e{i}-{from}-{to} ids) and clears manual waypoints so the
// rewired edge gets a clean route instead of doglegs shaped for the old geometry.
export function applyReconnect(oldEdge: Edge, conn: Connection, edges: Edge[]): Edge[] {
  return reconnectEdge(oldEdge, conn, edges, { shouldReplaceId: false }).map((e) =>
    e.id === oldEdge.id ? { ...e, data: { ...e.data, points: [] } } : e,
  )
}

// Shared spacing for the grid layout — bump these for more breathing room.
const LAYOUT = {
  COLS: 2,
  CW: 190, // child width
  CH: 60, // child height
  GX: 30, // gap between node columns
  GY: 24, // gap between node rows
  PX: 26, // group inner padding (sides)
  PT: 52, // group inner padding (top — leaves room for the label)
  PB: 26, // group inner padding (bottom)
  gapH: 100, // gap between groups (horizontal)
  gapV: 100, // gap between groups (vertical)
  targetW: 1550, // wrap groups to a new row past this width
}

// Re-flow the CURRENT graph into tidy grids (the "Tidy" button).
// Keeps group membership; leaves notes and ungrouped nodes where they are.
export function relayout(nodes: Node[]): Node[] {
  const { COLS, CW, CH, GX, GY, PX, PT, PB, gapH, gapV, targetW } = LAYOUT
  const groups = nodes.filter((n) => n.type === 'group')
  const others = nodes.filter((n) => n.type !== 'group')
  const out: Node[] = []
  const placed = new Set<string>()
  let cx = 0, cy = 0, rowH = 0
  for (const g of groups) {
    const kids = others.filter((n) => n.type === 'service' && n.parentId === g.id)
    const rows = Math.max(1, Math.ceil(kids.length / COLS))
    const gw = PX * 2 + COLS * CW + (COLS - 1) * GX
    const gh = PT + PB + rows * CH + (rows - 1) * GY
    if (cx > 0 && cx + gw > targetW) {
      cx = 0
      cy += rowH + gapV
      rowH = 0
    }
    out.push({ ...g, position: { x: cx, y: cy }, style: { ...g.style, width: gw, height: gh } })
    placed.add(g.id)
    kids.forEach((n, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      out.push({ ...n, position: { x: PX + col * (CW + GX), y: PT + row * (CH + GY) } })
      placed.add(n.id)
    })
    cx += gw + gapH
    rowH = Math.max(rowH, gh)
  }
  for (const n of others) if (!placed.has(n.id)) out.push(n)
  return out
}

// Re-grid ONE group's members to fit its current width; grow its height to fit.
// Live rendered size (resizes land on measured/width, not style.width).
function groupSize(group: Node): { w: number; h: number } {
  const g = group as any
  const { CW, GX, PX } = LAYOUT
  return {
    w: Number(g.measured?.width) || Number(g.width) || Number(g.style?.width) || PX * 2 + 2 * CW + GX,
    h: Number(g.measured?.height) || Number(g.height) || Number(g.style?.height) || 200,
  }
}

function groupKids(nodes: Node[], groupId: string): Node[] {
  return nodes.filter((n) => n.parentId === groupId && n.type === 'service')
}

// KEEP the group's size; spread members evenly to fill its width AND height.
export function distributeGroupChildren(nodes: Node[], groupId: string): Node[] {
  const { CW, CH, GX, PX, PT, PB } = LAYOUT
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return nodes
  const { w, h } = groupSize(group)
  const kids = groupKids(nodes, groupId)
  const n = kids.length
  if (!n) return nodes
  const cols = Math.min(n, Math.max(1, Math.floor((w - PX * 2 + GX) / (CW + GX))))
  const rows = Math.ceil(n / cols)
  const cellW = (w - PX * 2) / cols
  const cellH = (h - PT - PB) / rows
  const indexOf = new Map(kids.map((k, i) => [k.id, i]))
  return nodes.map((node) => {
    const idx = indexOf.get(node.id)
    if (idx === undefined) return node
    const col = idx % cols
    const row = Math.floor(idx / cols)
    return {
      ...node,
      position: { x: PX + col * cellW + (cellW - CW) / 2, y: PT + row * cellH + (cellH - CH) / 2 },
    }
  })
}

// Pack members at standard spacing; RESIZE the group to wrap them tightly.
export function shrinkGroupToChildren(nodes: Node[], groupId: string): Node[] {
  const { CW, CH, GX, GY, PX, PT, PB } = LAYOUT
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return nodes
  const { w } = groupSize(group)
  const kids = groupKids(nodes, groupId)
  const n = Math.max(1, kids.length)
  const cols = Math.max(1, Math.min(n, Math.floor((w - PX * 2 + GX) / (CW + GX))))
  const rows = Math.ceil(n / cols)
  const width = PX * 2 + cols * CW + (cols - 1) * GX
  const height = PT + PB + rows * CH + (rows - 1) * GY
  const indexOf = new Map(kids.map((k, i) => [k.id, i]))
  return nodes.map((node) => {
    if (node.id === groupId) return { ...node, width, height, style: { ...node.style, width, height } }
    const idx = indexOf.get(node.id)
    if (idx === undefined) return node
    const col = idx % cols
    const row = Math.floor(idx / cols)
    return { ...node, position: { x: PX + col * (CW + GX), y: PT + row * (CH + GY) } }
  })
}

// ---- Deterministic initial layout: groups shelf-packed, children in a grid ----
export function buildSeed(): { nodes: Node[]; edges: Edge[] } {
  const { COLS, CW, CH, GX, GY, PX, PT, PB, gapH, gapV, targetW } = LAYOUT

  const nodes: Node[] = []
  let cx = 0, cy = 0, rowH = 0

  for (const g of GROUPS) {
    const rows = Math.ceil(g.nodes.length / COLS)
    const gw = PX * 2 + COLS * CW + (COLS - 1) * GX
    const gh = PT + PB + rows * CH + (rows - 1) * GY
    if (cx > 0 && cx + gw > targetW) {
      cx = 0
      cy += rowH + gapV
      rowH = 0
    }
    nodes.push({
      id: g.id,
      type: 'group',
      position: { x: cx, y: cy },
      data: { label: g.label, color: g.color },
      style: { width: gw, height: gh },
    })
    g.nodes.forEach((n, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      nodes.push({
        id: n.id,
        type: 'service',
        parentId: g.id,
        extent: 'parent',
        position: { x: PX + col * (CW + GX), y: PT + row * (CH + GY) },
        data: { label: n.label, sub: n.sub, icon: n.icon, status: n.status, kind: n.kind },
      })
    })
    cx += gw + gapH
    rowH = Math.max(rowH, gh)
  }

  ACTORS.forEach((n, i) =>
    nodes.push({
      id: n.id,
      type: 'service',
      position: { x: -320, y: 380 + i * 160 },
      data: { label: n.label, sub: n.sub, icon: n.icon, status: n.status, kind: n.kind },
    }),
  )

  const edges: Edge[] = EDGES.map((e, i) => makeEdge(e.from, e.to, e.type, e.label, e.inferred, i))
  return { nodes, edges }
}
