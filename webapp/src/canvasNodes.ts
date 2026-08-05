// Ordering and traversal over the live React Flow node list.
//
// Extracted from App.tsx, where they sat as unexported module-level helpers
// with no tests despite being load-bearing: descendantsOf both guards against
// reparenting cycles and drives cascade-delete, so a bug in it either corrupts
// the tree or silently orphans nodes.
import type { Node } from '@xyflow/react'
import { topoOrderByParent } from './graph'

// React Flow requires a parent to appear before its children in the array, and
// groups are the only nodes that can be parents. Groups go first in
// parent-before-child order; everything else keeps its relative order.
export const groupsFirst = (ns: Node[]): Node[] => [
  ...topoOrderByParent(ns.filter((n) => n.type === 'group')),
  ...ns.filter((n) => n.type !== 'group'),
]

// All ids reachable by following parentId edges out of `id` (its children,
// grandchildren, ...) among the live canvas nodes. Used both to guard against
// reparenting cycles and to cascade-delete a group's contents.
//
// `id` is not included for a well-formed tree, so callers that need it add it
// explicitly (`new Set([id, ...descendantsOf(id, nodes)])`). It IS included if
// the parentId graph contains a cycle reaching back to it — the traversal then
// terminates rather than looping, which is what the cycle guard relies on.
export function descendantsOf(id: string, nodes: Node[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }
  const out = new Set<string>()
  const stack = [...(children.get(id) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    stack.push(...(children.get(cur) ?? []))
  }
  return out
}
