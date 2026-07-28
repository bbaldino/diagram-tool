import { type Node, type Edge, type Connection, reconnectEdge, MarkerType } from '@xyflow/react'

// dashboard-icons (homarr-labs) — same set used in the D2 diagram
export const ICON_BASE =
  'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

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
