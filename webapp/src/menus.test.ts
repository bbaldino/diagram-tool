import { describe, it, expect } from 'vitest'
import { buildMenus, type MenuFlags } from './menus'
import type { MenuItem } from './menuNav'

const flags = (over: Partial<MenuFlags> = {}): MenuFlags => ({
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  canGroup: false,
  canUngroup: false,
  canTidy: false,
  layoutEngine: 'elk',
  edgeStyle: 'default',
  showLegend: true,
  showMinimap: true,
  snapToGrid: false,
  noteSpellcheck: false,
  railVisible: true,
  railTab: 'inspector',
  ...over,
})

// Items can be nested one level deep in a submenu.
const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((i) => [i, ...(i.submenu ? flatten(i.submenu) : [])])

// Scoped by menu, because dispatch is keyed on (menuId, itemId) — the same
// itemId legitimately appears in two menus.
const find = (f: MenuFlags, menuId: string, id: string): MenuItem => {
  const menu = buildMenus(f).find((m) => m.id === menuId)
  if (!menu) throw new Error(`no menu "${menuId}"`)
  const hit = flatten(menu.items).find((i) => i.id === id)
  if (!hit) throw new Error(`no item "${id}" in menu "${menuId}"`)
  return hit
}

describe('menu structure', () => {
  it('exposes the four top-level menus in order', () => {
    expect(buildMenus(flags()).map((m) => m.id)).toEqual(['file', 'edit', 'view', 'arrange'])
  })

  // Dispatch is keyed on (menuId, itemId), so ids need only be unique WITHIN a
  // menu — File's 'Delete diagram…' and Edit's 'Delete' both use `delete` and
  // that is fine. Uniqueness across menus is deliberately not asserted.
  it.each(['file', 'edit', 'view', 'arrange'])('gives %s menu unique item ids', (menuId) => {
    const menu = buildMenus(flags()).find((m) => m.id === menuId)!
    const ids = flatten(menu.items).map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('enable/disable rules', () => {
  it.each([
    ['edit', 'undo', 'canUndo'],
    ['edit', 'redo', 'canRedo'],
    ['arrange', 'group', 'canGroup'],
    ['arrange', 'ungroup', 'canUngroup'],
    ['arrange', 'tidy-up', 'canTidy'],
  ] as const)(
    '%s/%s is disabled when %s is false and enabled when true',
    (menuId, itemId, flag) => {
      expect(find(flags({ [flag]: false }), menuId, itemId).disabled).toBeTruthy()
      expect(find(flags({ [flag]: true }), menuId, itemId).disabled).toBeFalsy()
    },
  )

  it('re-run layout follows canTidy, like tidy-up', () => {
    expect(find(flags({ canTidy: false }), 'arrange', 'rerun-layout').disabled).toBeTruthy()
    expect(find(flags({ canTidy: true }), 'arrange', 'rerun-layout').disabled).toBeFalsy()
  })

  it('delete follows hasSelection', () => {
    expect(find(flags({ hasSelection: false }), 'edit', 'delete').disabled).toBeTruthy()
    expect(find(flags({ hasSelection: true }), 'edit', 'delete').disabled).toBeFalsy()
  })
})

describe('checkmarks', () => {
  it('ticks exactly the active layout engine', () => {
    expect(find(flags({ layoutEngine: 'elk' }), 'arrange', 'engine-elk').checked).toBe(true)
    expect(find(flags({ layoutEngine: 'elk' }), 'arrange', 'engine-graphviz').checked).toBe(false)
    expect(find(flags({ layoutEngine: 'graphviz' }), 'arrange', 'engine-graphviz').checked).toBe(
      true,
    )
  })

  it.each(['default', 'smoothstep', 'straight'] as const)(
    'ticks exactly the %s edge style',
    (style) => {
      const ticked = ['edge-default', 'edge-smoothstep', 'edge-straight'].filter(
        (id) => find(flags({ edgeStyle: style }), 'arrange', id).checked,
      )
      expect(ticked).toEqual([`edge-${style}`])
    },
  )

  it('reflects the view toggles', () => {
    expect(find(flags({ showLegend: true }), 'view', 'legend').checked).toBe(true)
    expect(find(flags({ showLegend: false }), 'view', 'legend').checked).toBe(false)
    expect(find(flags({ snapToGrid: true }), 'view', 'snap').checked).toBe(true)
    expect(find(flags({ noteSpellcheck: true }), 'view', 'note-spellcheck').checked).toBe(true)
  })

  // The rail entry is ticked only when that tab is BOTH open and showing —
  // matching toggleRailTab, where reselecting the visible tab collapses it.
  it('ticks the inspector entry only when the rail shows that tab', () => {
    expect(
      find(flags({ railVisible: true, railTab: 'inspector' }), 'view', 'inspector').checked,
    ).toBe(true)
    expect(
      find(flags({ railVisible: false, railTab: 'inspector' }), 'view', 'inspector').checked,
    ).toBe(false)
    expect(find(flags({ railVisible: true, railTab: 'flows' }), 'view', 'inspector').checked).toBe(
      false,
    )
  })
})
