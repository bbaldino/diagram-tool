import { type Node, type Edge, type Connection, reconnectEdge, MarkerType } from '@xyflow/react'
import type { AppEdge } from './canvasData'
import { REL, REL_TYPES, type EdgeDir, type RelType } from '../shared/relationships'

// Re-exported: the vocabulary lives in shared/ (the server needs it), but the
// canvas modules have always reached for it here and there is no value in
// making every one of them learn the new path.
export { REL, REL_TYPES, type EdgeDir, type RelType }
import { GROUP_SLACK, NODE_EST_SIZE, requiredGroupSize, paddedExtent } from '../shared/containment'

export {
  GROUP_PAD,
  GROUP_MIN,
  GROUP_NEST_TOP_PAD,
  GROUP_SLACK,
  requiredGroupSize,
  paddedExtent,
  placeInGroup,
} from '../shared/containment'

// dashboard-icons (homarr-labs) — same set used in the D2 diagram
export const ICON_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

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
export function topoOrderByParent<T extends { id: string; parentId?: string | null }>(
  items: T[],
): T[] {
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
// ---- Groups + service nodes (status from Unraid docker state) ----
const GROUPS: G[] = [
  {
    id: 'edge',
    label: 'Infra / Auth',
    color: '#e05252',
    nodes: [
      {
        id: 'npm',
        label: 'Nginx Proxy Manager',
        icon: 'nginx-proxy-manager',
        sub: ':80 / :443 / :81',
        status: 'up',
      },
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
      {
        id: 'frigate',
        label: 'Frigate (NVR)',
        icon: 'frigate',
        sub: 'panopticon:5000',
        status: 'up',
      },
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

// group color lookup (used by the minimap)
export const GROUP_COLOR: Record<string, string> = Object.fromEntries(
  GROUPS.map((g) => [g.id, g.color]),
)

// Best-known on-canvas footprint of a live RF node, for sizing/clamping
// groups around their children. Groups and notes carry an explicit size
// (style.width/height, falling back to RF's measured size once rendered);
// service nodes are sized by CSS with no model dimension, so they're treated
// as zero-footprint — GROUP_PAD/GROUP_MIN keep them comfortably inside their
// parent regardless.
export function liveFootprint(n: Node): { width: number; height: number } {
  if (n.type === 'group' || n.type === 'note') {
    const g = n as {
      width?: number
      height?: number
      measured?: { width?: number; height?: number }
      style?: { width?: number; height?: number }
    }
    // Prefer the LIVE size. A NodeResizer resize writes top-level width/height
    // + measured but NOT style; the inspector size control writes width + style
    // but not measured; a fresh load from the model sets only style. Reading
    // width → measured → style yields the current size across all three, where
    // reading style first would go stale right after a corner-resize.
    return {
      width: Number(g.width) || Number(g.measured?.width) || Number(g.style?.width) || 0,
      height: Number(g.height) || Number(g.measured?.height) || Number(g.style?.height) || 0,
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
// Recompute every parented child's drag `extent` from its parent's CURRENT
// (live) size — WITHOUT resizing any group. Use this after a manual size change
// (NodeResizer, inspector, shrink-to-fit) so a child's clamp tracks the new box
// and can't be dragged past it, but the user's chosen size is left exactly as
// set (unlike reflowGroups, which also grows groups + re-adds GROUP_SLACK).
export function recomputeChildExtents(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return nodes.map((n) => {
    if (!n.parentId) return n
    const parent = byId.get(n.parentId)
    if (!parent) return n
    return { ...n, extent: paddedExtent(liveFootprint(parent), liveFootprint(n)) }
  })
}

export function reflowGroups(nodes: Node[]): Node[] {
  return recomputeChildExtents(growGroupsToFitChildren(nodes))
}
const PARENT_OF: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.nodes.map((n) => [n.id, g.id])),
)
export function parentGroup(id: string): string | undefined {
  return PARENT_OF[id]
}

// Edge direction: which ends carry an arrowhead. Decoupled from which handles
// the edge attaches to, so geometry (layout) and semantics (one/two-way) are

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
): AppEdge {
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

// Re-apply relationship styling to an existing edge (used when its type changes).
export function restyleEdge(e: AppEdge, type: RelType, inferred: boolean): AppEdge {
  const r = REL[type]
  const dir = e.data?.dir ?? 'forward'
  const colorOverride = e.data?.color
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
  let cx = 0,
    cy = 0,
    rowH = 0
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

// Real rendered footprint of ANY child, for shrink-to-fit. Unlike
// liveFootprint (which treats a service node as a zero-footprint point — fine
// for grow-only sizing, where GROUP_MIN/GROUP_PAD keep small nodes loosely
// inside), shrinking tightly must wrap a node's ACTUAL box or the group edge
// cuts across it. Service nodes carry no model size, so use their measured
// (rendered) size, falling back to NODE_EST_SIZE before RF has measured them.
function shrinkFootprint(n: Node): { width: number; height: number } {
  const g = n as {
    width?: number
    height?: number
    measured?: { width?: number; height?: number }
    style?: { width?: number; height?: number }
  }
  return {
    width:
      Number(g.width) || Number(g.measured?.width) || Number(g.style?.width) || NODE_EST_SIZE.width,
    height:
      Number(g.height) ||
      Number(g.measured?.height) ||
      Number(g.style?.height) ||
      NODE_EST_SIZE.height,
  }
}

// Shrink-to-fit: RESIZE the group to wrap its children where they already sit,
// without moving them. Counterpart to growGroupsToFitChildren, but forces the
// size DOWN to what's required (that grows only) and adds NO GROUP_SLACK — an
// explicit shrink is a request to be tight, so it stops at GROUP_PAD past the
// children's far edges (auto-grow keeps slack for draggability; a manual
// shrink deliberately does not). Considers EVERY child kind at its real size
// (shrinkFootprint) — service nodes, notes, and nested groups — so it tightens
// around a note or sub-group instead of clipping to fit only its service
// nodes. requiredGroupSize floors at GROUP_MIN, so an empty (or tiny-content)
// group bottoms out there.
export function shrinkGroupToChildren(nodes: Node[], groupId: string): Node[] {
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return nodes
  const kids = nodes
    .filter((n) => n.parentId === groupId)
    .map((n) => ({ position: n.position, size: shrinkFootprint(n) }))
  const { width, height } = requiredGroupSize(kids)
  return nodes.map((node) =>
    node.id === groupId
      ? { ...node, width, height, style: { ...node.style, width, height } }
      : node,
  )
}
