import type { EdgeDir } from '../src/graph'
import type { Diagram, DiagramType, Edge, EdgeOrientation, Group, Model, Node } from '../src/model'
import { addDiagram } from '../src/model'
import { newId } from '../src/ids'
import { diffToOps } from '../src/diff'
import type { Op } from '../src/ops'
import { layoutDiagram } from './layout'

export interface AuthorSpec {
  name: string
  type?: DiagramType // default 'canvas'
  nodes: (string | { label: string; icon?: string })[] // a new node's label, or {label, icon}
  edges?: [
    string,
    string,
    { label?: string; dir?: EdgeDir; color?: string; orientation?: EdgeOrientation }?,
  ][] // [fromRef,toRef,attrs] — refs are spec-local, see below
  groups?: { label: string; members: string[] }[] // members = spec-local node refs
  positions?: Record<string, { x: number; y: number }> // optional agent overrides, ref -> pos
}

const slugify = (s: string): string => {
  const slug = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  // Guard against degenerate ids: an all-symbol/whitespace label would yield
  // '' or a dash-only string. Fall back to a safe, non-empty ref.
  return /[a-z0-9]/.test(slug) ? slug : 'node'
}

// Assemble the ops that create a new, laid-out diagram from `spec`. There is
// no entity catalog anymore, so every spec.nodes entry mints a brand-new Node
// (uuid via newId()) — there is nothing "existing" to resolve against. `ref`
// below is a spec-local key (derived from the node's label, deduped) that
// lets spec.edges/groups/positions refer back to a node minted earlier in the
// SAME call; it is never the node's real id. Throws Error on an unresolvable
// ref. Pure (does not mutate `model`).
export async function authorDiagramOps(
  model: Model,
  spec: AuthorSpec,
): Promise<{ ops: Op[]; diagramId: string; nodeIds: string[] }> {
  const { model: withDiagram, id: diagramId } = addDiagram(model, spec.name, spec.type ?? 'canvas')

  const usedRefs = new Set<string>()
  const minted = spec.nodes.map((entry) => {
    const label = typeof entry === 'string' ? entry : entry.label
    const icon = typeof entry === 'string' ? undefined : entry.icon
    const base = slugify(label)
    let ref = base
    for (let n = 2; usedRefs.has(ref); n++) ref = `${base}-${n}`
    usedRefs.add(ref)
    return { ref, id: newId(), label, icon }
  })
  const idByRef = new Map(minted.map((m) => [m.ref, m.id]))
  const refById = new Map(minted.map((m) => [m.id, m.ref]))

  const resolveRef = (ref: string, context: string): string => {
    const id = idByRef.get(ref)
    if (!id) throw new Error(`authorDiagramOps: ${context} references unknown node ref "${ref}"`)
    return id
  }

  for (const [from, to] of spec.edges ?? []) {
    resolveRef(from, 'edge')
    resolveRef(to, 'edge')
  }
  for (const g of spec.groups ?? []) {
    for (const memberRef of g.members) resolveRef(memberRef, `group "${g.label}"`)
  }

  const groupIdByMemberRef = new Map<string, string>()
  const groups: Group[] = (spec.groups ?? []).map((g) => {
    const id = newId()
    for (const memberRef of g.members) groupIdByMemberRef.set(memberRef, id)
    return {
      id,
      label: g.label,
      color: '#64748b',
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    }
  })

  const nodes: Node[] = minted.map(({ id, label, icon }) => {
    const node: Node = { id, label, fields: [], position: { x: 0, y: 0 } }
    if (icon) node.icon = icon
    const groupId = groupIdByMemberRef.get(refById.get(id)!)
    if (groupId) node.parentId = groupId
    return node
  })

  const edges: Edge[] = (spec.edges ?? []).map(([fromRef, toRef, attrs]) => ({
    id: newId(),
    from: resolveRef(fromRef, 'edge'),
    to: resolveRef(toRef, 'edge'),
    type: 'talks-to' as const,
    ...attrs,
  }))

  const diagram: Diagram = {
    id: diagramId,
    name: spec.name,
    title: spec.name,
    type: spec.type ?? 'canvas',
    nodes,
    groups,
    notes: [],
    edges,
    flows: [],
  }

  const laidOut = await layoutDiagram(diagram)

  const finalNodes: Node[] = laidOut.nodes.map((n) => {
    const ref = refById.get(n.id)
    const override = ref ? spec.positions?.[ref] : undefined
    return override ? { ...n, position: override } : n
  })

  const finalDiagram: Diagram = {
    ...diagram,
    nodes: finalNodes,
    groups: laidOut.groups,
    edges: laidOut.edges,
  }

  const cloned: Model = {
    ...withDiagram,
    diagrams: withDiagram.diagrams.map((d) => (d.id === diagramId ? finalDiagram : d)),
  }

  return { ops: diffToOps(model, cloned), diagramId, nodeIds: minted.map((m) => m.id) }
}
