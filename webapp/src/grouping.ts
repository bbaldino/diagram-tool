// Pure node-array transforms for Group / Ungroup. DOM-free and dependency-free
// so they unit-test under Vitest's node env. Positions of nested children are
// RELATIVE to their parent (React Flow convention); these helpers do the
// absolute<->relative rebasing that grouping/ungrouping requires.

export interface NodeLike {
  id: string
  type?: string
  position: { x: number; y: number }
  parentId?: string
  selected?: boolean
  style?: { width?: number; height?: number }
  measured?: { width?: number; height?: number }
  data?: unknown
  extent?: unknown
  [k: string]: unknown
}

const GROUP_MIN = { width: 220, height: 130 }
const PAD_X = 24
const PAD_TOP = 44 // clears the group label

// Best-effort size for bounding-box math: explicit style/measured when present,
// else a service-node estimate.
function sizeOf(n: NodeLike): { width: number; height: number } {
  const w = Number(n.style?.width) || Number((n as any).width) || Number(n.measured?.width)
  const h = Number(n.style?.height) || Number((n as any).height) || Number(n.measured?.height)
  if (w && h) return { width: w, height: h }
  return { width: 180, height: 72 }
}

export function groupNodes(
  nodes: NodeLike[],
  selectedIds: string[],
  groupId: string,
  label: string,
  color: string,
): NodeLike[] {
  const selSet = new Set(selectedIds)
  const sel = nodes.filter((n) => selSet.has(n.id))
  if (sel.length === 0) return nodes

  const minX = Math.min(...sel.map((n) => n.position.x))
  const minY = Math.min(...sel.map((n) => n.position.y))
  const originX = minX - PAD_X
  const originY = minY - PAD_TOP
  const maxX = Math.max(...sel.map((n) => n.position.x + sizeOf(n).width))
  const maxY = Math.max(...sel.map((n) => n.position.y + sizeOf(n).height))
  const width = Math.max(GROUP_MIN.width, maxX - originX + PAD_X)
  const height = Math.max(GROUP_MIN.height, maxY - originY + PAD_X)

  const group: NodeLike = {
    id: groupId,
    type: 'group',
    position: { x: originX, y: originY },
    data: { label, color },
    style: { width, height },
    zIndex: -1,
    selected: true,
  }

  const rest = nodes.map((n) =>
    selSet.has(n.id)
      ? {
          ...n,
          parentId: groupId,
          selected: false,
          position: { x: n.position.x - originX, y: n.position.y - originY },
        }
      : { ...n, selected: false },
  )
  // Group first: it precedes its new children, and the pre-existing relative
  // order of everything else (already parent-before-child) is preserved.
  return [group, ...rest]
}

export function ungroupNodes(nodes: NodeLike[], groupId: string): NodeLike[] {
  const g = nodes.find((n) => n.id === groupId)
  if (!g) return nodes
  const gx = g.position.x
  const gy = g.position.y
  const out: NodeLike[] = []
  for (const n of nodes) {
    if (n.id === groupId) continue // drop the group node
    if (n.parentId === groupId) {
      const { parentId: _p, extent: _e, ...rest } = n
      out.push({
        ...rest,
        selected: false,
        position: { x: gx + n.position.x, y: gy + n.position.y },
      })
    } else {
      out.push({ ...n, selected: false })
    }
  }
  return out
}
