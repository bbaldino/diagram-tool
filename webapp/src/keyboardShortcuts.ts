// Which action, if any, a keydown should trigger.
//
// Consolidates four separate window keydown effects that had grown up apart in
// Flow(): File shortcuts, zoom, edit/layout, and flow stepping. Each repeated
// its own "ignore this while the user is typing" guard, and they disagreed —
// see IGNORED_TAGS below. Pulling them into one table makes the rules
// comparable, and makes them testable without a DOM.
//
// This decides only WHAT should happen. Performing it stays in Flow(), which
// owns the handlers.

export type ShortcutAction =
  | 'new-diagram'
  | 'export-json'
  | 'open-diagram'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'undo'
  | 'redo'
  | 'tidy'
  | 'toggle-inspector'
  | 'toggle-flows'
  | 'group'
  | 'ungroup'
  | 'flow-next'
  | 'flow-prev'
  | 'flow-exit'

export interface KeyContext {
  key: string
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** Focus is in an input, textarea or contenteditable — the user is typing. */
  typing: boolean
  /** Focus is in a <select>. Only the zoom shortcuts care; see below. */
  onSelect: boolean
  /** A walkthrough is running, which enables the arrow-key stepping. */
  flowPlaying: boolean
  /** A menu is open and owns the keyboard. */
  menuOpen: boolean
}

export interface ShortcutHit {
  action: ShortcutAction
  /** Every hit preventDefaults except Escape, which never did. */
  preventDefault: boolean
}

export function keyContextFrom(
  e: KeyboardEvent,
  state: { flowPlaying: boolean; menuOpen: boolean },
): KeyContext {
  const t = e.target as HTMLElement | null
  return {
    key: e.key,
    meta: e.metaKey,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    typing: !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable),
    onSelect: !!t && t.tagName === 'SELECT',
    ...state,
  }
}

export function resolveShortcut(c: KeyContext): ShortcutHit | null {
  if (c.typing) return null
  const hit = (action: ShortcutAction, preventDefault = true): ShortcutHit => ({
    action,
    preventDefault,
  })
  const mod = c.meta || c.ctrl
  const key = c.key.toLowerCase()

  // Flow stepping: no modifier check of its own, and blocked while a menu is
  // open so arrow keys navigate the menu instead of the walkthrough.
  if (c.flowPlaying && !c.menuOpen) {
    if (c.key === 'ArrowRight' || c.key === 'ArrowDown') return hit('flow-next')
    if (c.key === 'ArrowLeft' || c.key === 'ArrowUp') return hit('flow-prev')
    // Deliberately does not preventDefault — Escape never did.
    if (c.key === 'Escape') return hit('flow-exit', false)
  }

  if (mod) {
    if (key === 'n' && !c.shift) return hit('new-diagram')
    if (key === 'e' && c.shift) return hit('export-json')
    if (key === 'o' && !c.shift) return hit('open-diagram')
    if (key === 'z' && !c.shift) return hit('undo')
    if ((key === 'z' && c.shift) || key === 'y') return hit('redo')
    // Two bindings for one action, both pre-existing.
    if ((key === 'l' || key === 't') && c.shift) return hit('tidy')
    if (key === 'i' && !c.shift && !c.alt) return hit('toggle-inspector')
    if (key === 'f' && c.shift) return hit('toggle-flows')
    if (key === 'g') return hit(c.shift ? 'ungroup' : 'group')
    return null
  }

  // Zoom is modifier-FREE so it does not collide with the browser's own
  // Ctrl/Cmd +/- page zoom, and it is the only group that also ignores a
  // focused <select> — where +/- and 0 would otherwise change the selection.
  // The other groups never guarded against it. Preserved as-is rather than
  // unified, because widening the guard would silently change behaviour.
  if (!c.alt && !c.onSelect) {
    if (c.key === '=' || c.key === '+') return hit('zoom-in')
    if (c.key === '-' || c.key === '_') return hit('zoom-out')
    if (c.key === '0') return hit('zoom-fit')
  }
  return null
}
