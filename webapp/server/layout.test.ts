import { describe, it, expect } from 'vitest'
import { layoutDiagram } from './layout'
import type { Diagram } from '../src/model'

const D = (over: Partial<Diagram>): Diagram => ({
  id: 'd',
  name: 'd',
  title: 'd',
  type: 'canvas',
  placements: [],
  groups: [],
  edges: [],
  notes: [],
  ...over,
})

describe('layoutDiagram', () => {
  it('ranks a source left of its target (rankdir LR)', () => {
    const d = D({
      placements: [
        { entityId: 'a', position: { x: 0, y: 0 } },
        { entityId: 'b', position: { x: 0, y: 0 } },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', type: 'talks-to' }],
    })
    const { placements } = layoutDiagram(d)
    const a = placements.find((p) => p.entityId === 'a')!
    const b = placements.find((p) => p.entityId === 'b')!
    expect(a.position.x).toBeLessThan(b.position.x)
  })

  it('does not overlap two unrelated nodes', () => {
    const d = D({
      placements: [
        { entityId: 'a', position: { x: 0, y: 0 } },
        { entityId: 'b', position: { x: 0, y: 0 } },
      ],
    })
    const { placements } = layoutDiagram(d)
    const [a, b] = placements
    const apart = Math.abs(a.position.x - b.position.x) >= 180 || Math.abs(a.position.y - b.position.y) >= 64
    expect(apart).toBe(true)
  })

  it('sizes a group to wrap BOTH of its members', () => {
    const d = D({
      groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
      placements: [
        { entityId: 'a', position: { x: 0, y: 0 }, parentId: 'g' },
        { entityId: 'b', position: { x: 0, y: 0 }, parentId: 'g' },
      ],
    })
    const { groups, placements } = layoutDiagram(d)
    const g = groups[0]
    expect(g.size.width).toBeGreaterThan(180)
    expect(g.size.height).toBeGreaterThan(64)

    // Each member's ABSOLUTE extent (children are parent-relative, so add the
    // group origin back) must lie inside the group box. This fails if only one
    // member is wrapped.
    const left = g.position.x
    const top = g.position.y
    const right = g.position.x + g.size.width
    const bottom = g.position.y + g.size.height
    for (const id of ['a', 'b']) {
      const p = placements.find((x) => x.entityId === id)!
      const ax = g.position.x + p.position.x // absolute top-left
      const ay = g.position.y + p.position.y
      expect(ax).toBeGreaterThanOrEqual(left)
      expect(ay).toBeGreaterThanOrEqual(top)
      // member box is 180x64; its far corner must also be within the group box
      expect(ax + 180).toBeLessThanOrEqual(right)
      expect(ay + 64).toBeLessThanOrEqual(bottom)
    }
  })

  it('does not let an ungrouped fan-out node overlap a sibling group box (NPM -> {grouped + ungrouped})', () => {
    // Mirrors the real repro: an ungrouped source (npm) fans out toward a
    // "Media automation" group (sonarr/radarr/nzbhydra2) and toward ungrouped
    // nodes (openwebui, ollama), with the kind of cross-links a real service
    // topology has (openwebui <-> ollama, sonarr talking back to ollama and
    // out to alertmgr, a shared cache feeding both the group and gateway).
    // Under the buggy code, the group's box is expanded upward (past the
    // footprint dagre actually reserved for the cluster) by the header
    // strip, and that swallows a neighboring ungrouped node (alertmgr).
    const d = D({
      groups: [
        { id: 'media', label: 'Media automation', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
      ],
      placements: [
        { entityId: 'npm', position: { x: 0, y: 0 } },
        { entityId: 'gateway', position: { x: 0, y: 0 } },
        { entityId: 'openwebui', position: { x: 0, y: 0 } },
        { entityId: 'ollama', position: { x: 0, y: 0 } },
        { entityId: 'proxy', position: { x: 0, y: 0 } },
        { entityId: 'sonarr', position: { x: 0, y: 0 }, parentId: 'media' },
        { entityId: 'radarr', position: { x: 0, y: 0 }, parentId: 'media' },
        { entityId: 'cache', position: { x: 0, y: 0 } },
        { entityId: 'monitor', position: { x: 0, y: 0 } },
        { entityId: 'nzbhydra2', position: { x: 0, y: 0 }, parentId: 'media' },
        { entityId: 'alertmgr', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e0', from: 'npm', to: 'gateway', type: 'talks-to' },
        { id: 'e1', from: 'npm', to: 'openwebui', type: 'talks-to' },
        { id: 'e3', from: 'openwebui', to: 'cache', type: 'talks-to' },
        { id: 'e5', from: 'ollama', to: 'openwebui', type: 'talks-to' },
        { id: 'e6', from: 'proxy', to: 'openwebui', type: 'talks-to' },
        { id: 'e7', from: 'proxy', to: 'sonarr', type: 'talks-to' },
        { id: 'e8', from: 'sonarr', to: 'ollama', type: 'talks-to' },
        { id: 'e9', from: 'sonarr', to: 'alertmgr', type: 'talks-to' },
        { id: 'e12', from: 'cache', to: 'gateway', type: 'talks-to' },
        { id: 'e13', from: 'cache', to: 'nzbhydra2', type: 'talks-to' },
        { id: 'e14', from: 'monitor', to: 'radarr', type: 'talks-to' },
        { id: 'e16', from: 'nzbhydra2', to: 'openwebui', type: 'talks-to' },
      ],
    })
    const { placements, groups } = layoutDiagram(d)
    const media = groups.find((g) => g.id === 'media')!
    const gLeft = media.position.x
    const gTop = media.position.y
    const gRight = media.position.x + media.size.width
    const gBottom = media.position.y + media.size.height

    // Invariant 1: no ungrouped node overlaps the group box.
    const ungroupedIds = ['npm', 'gateway', 'openwebui', 'ollama', 'proxy', 'cache', 'monitor', 'alertmgr']
    for (const id of ungroupedIds) {
      const p = placements.find((x) => x.entityId === id)!
      const left = p.position.x
      const top = p.position.y
      const right = left + 180
      const bottom = top + 64
      const overlaps = left < gRight && right > gLeft && top < gBottom && bottom > gTop
      expect(overlaps, `${id} should not overlap the "media" group box`).toBe(false)
    }

    // Invariant 2: grouped members sit below the group's title strip
    // (parent-relative y >= HEADER).
    for (const id of ['sonarr', 'radarr', 'nzbhydra2']) {
      const p = placements.find((x) => x.entityId === id)!
      expect(p.position.y).toBeGreaterThanOrEqual(28)
    }
  })

  it('handles an empty group (no members) without throwing, yielding a sane box', () => {
    const d = D({
      groups: [{ id: 'g', label: 'G', color: '#000', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }],
      placements: [],
    })
    const { groups } = layoutDiagram(d)
    const g = groups[0]
    expect(Number.isNaN(g.size.width)).toBe(false)
    expect(Number.isNaN(g.size.height)).toBe(false)
    expect(g.size.width).toBeGreaterThan(0)
    expect(g.size.height).toBeGreaterThan(0)
    expect(Number.isNaN(g.position.x)).toBe(false)
    expect(Number.isNaN(g.position.y)).toBe(false)
  })
})
