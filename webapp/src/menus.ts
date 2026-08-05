// The menu bar's contents: which items exist, and which are disabled or ticked
// for the current state.
//
// Extracted from Flow() in App.tsx. These are pure functions of a handful of
// flags — nothing here reads or writes canvas or model state — which makes the
// enable/disable and checkmark rules directly testable. Those rules had no
// coverage at all, and getting one wrong is quiet: an item that should be
// greyed out stays clickable, or a checkmark shows against the wrong entry.
//
// Dispatch (what an item DOES when clicked) stays in Flow(): it reaches into
// eighteen different handlers and is wiring rather than logic.
import type { MenuItem } from './menuNav'
import type { LayoutEngine, RailTab } from './useViewPrefs'

export type EdgeStyle = 'default' | 'smoothstep' | 'straight'

export interface MenuFlags {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  canGroup: boolean
  canUngroup: boolean
  canTidy: boolean
  layoutEngine: LayoutEngine
  edgeStyle: EdgeStyle
  showLegend: boolean
  showMinimap: boolean
  snapToGrid: boolean
  noteSpellcheck: boolean
  railVisible: boolean
  railTab: RailTab
}

export type MenuDef = { id: 'file' | 'edit' | 'view' | 'arrange'; title: string; items: MenuItem[] }

export function fileMenu(): MenuItem[] {
  return [
    { id: 'new', label: 'New diagram', shortcut: '⌘N' },
    { id: 'open', label: 'Open diagram…', shortcut: '⌘O' },
    { id: 'rename', label: 'Rename…' },
    { id: 'duplicate', label: 'Duplicate', disabled: true },
    { id: 'import', label: 'Import JSON…', separatorBefore: true },
    {
      id: 'export',
      label: 'Export',
      submenu: [
        { id: 'export-json', label: 'JSON', shortcut: '⌘⇧E' },
        { id: 'export-png-view', label: 'PNG (current view)', disabled: true },
        { id: 'export-png-all', label: 'PNG (whole diagram)', disabled: true },
        { id: 'export-svg', label: 'SVG', disabled: true },
      ],
    },
    { id: 'reset', label: 'Reset diagram…', danger: true, separatorBefore: true },
    { id: 'delete', label: 'Delete diagram…', danger: true },
  ]
}

export function editMenu(f: MenuFlags): MenuItem[] {
  const { canUndo, canRedo, hasSelection } = f
  return [
    { id: 'undo', label: 'Undo', shortcut: '⌘Z', disabled: !canUndo },
    { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z', disabled: !canRedo },
    { id: 'cut', label: 'Cut', shortcut: '⌘X', disabled: true, separatorBefore: true },
    { id: 'copy', label: 'Copy', shortcut: '⌘C', disabled: true },
    { id: 'paste', label: 'Paste', shortcut: '⌘V', disabled: true },
    { id: 'duplicate', label: 'Duplicate', shortcut: '⌘D', disabled: true },
    { id: 'delete', label: 'Delete', shortcut: '⌫', disabled: !hasSelection },
    {
      id: 'select-all',
      label: 'Select all',
      shortcut: '⌘A',
      disabled: true,
      separatorBefore: true,
    },
    { id: 'deselect', label: 'Deselect', shortcut: 'Esc', disabled: true },
  ]
}

export function arrangeMenu(f: MenuFlags): MenuItem[] {
  const { layoutEngine, edgeStyle, canGroup, canUngroup, canTidy } = f
  return [
    { id: 'tidy-up', label: 'Tidy up', shortcut: '⌘⇧T', disabled: !canTidy },
    {
      id: 'auto-layout',
      label: 'Auto-layout',
      submenu: [
        { id: 'engine-graphviz', label: 'Graphviz', checked: layoutEngine === 'graphviz' },
        { id: 'engine-elk', label: 'elkjs', checked: layoutEngine === 'elk' },
        {
          id: 'rerun-layout',
          label: 'Re-run layout',
          shortcut: '⌘⇧L',
          separatorBefore: true,
          disabled: !canTidy,
        },
      ],
    },
    {
      id: 'edge-style',
      label: 'Edge style',
      submenu: [
        { id: 'edge-default', label: 'Curved', checked: edgeStyle === 'default' },
        { id: 'edge-smoothstep', label: 'Angular', checked: edgeStyle === 'smoothstep' },
        { id: 'edge-straight', label: 'Straight', checked: edgeStyle === 'straight' },
      ],
    },
    {
      id: 'group',
      label: 'Group selection',
      shortcut: '⌘G',
      disabled: !canGroup,
      separatorBefore: true,
    },
    { id: 'ungroup', label: 'Ungroup', shortcut: '⇧⌘G', disabled: !canUngroup },
    { id: 'bring-front', label: 'Bring to front', disabled: true, separatorBefore: true },
    { id: 'send-back', label: 'Send to back', disabled: true },
  ]
}

export function viewMenu(f: MenuFlags): MenuItem[] {
  const { showLegend, showMinimap, snapToGrid, noteSpellcheck, railVisible, railTab } = f
  return [
    { id: 'zoom-in', label: 'Zoom in' },
    { id: 'zoom-out', label: 'Zoom out' },
    { id: 'zoom-fit', label: 'Zoom to fit' },
    { id: 'zoom-actual', label: 'Actual size' },
    { id: 'legend', label: 'Legend', checked: showLegend, separatorBefore: true },
    { id: 'minimap', label: 'Minimap', checked: showMinimap },
    {
      id: 'inspector',
      label: 'Inspector',
      shortcut: '⌘I',
      checked: railVisible && railTab === 'inspector',
    },
    { id: 'snap', label: 'Snap to grid', checked: snapToGrid },
    { id: 'note-spellcheck', label: 'Spellcheck notes', checked: noteSpellcheck },
    {
      id: 'flows-panel',
      label: 'Flows panel',
      shortcut: '⌘⇧F',
      checked: railVisible && railTab === 'flows',
      separatorBefore: true,
    },
  ]
}

export function buildMenus(f: MenuFlags): MenuDef[] {
  return [
    { id: 'file', title: 'File', items: fileMenu() },
    { id: 'edit', title: 'Edit', items: editMenu(f) },
    { id: 'view', title: 'View', items: viewMenu(f) },
    { id: 'arrange', title: 'Arrange', items: arrangeMenu(f) },
  ]
}
