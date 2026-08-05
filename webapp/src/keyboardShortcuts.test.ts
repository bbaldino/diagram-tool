import { describe, it, expect } from 'vitest'
import { resolveShortcut, type KeyContext } from './keyboardShortcuts'

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  key: 'a',
  meta: false,
  ctrl: false,
  shift: false,
  alt: false,
  typing: false,
  onSelect: false,
  flowPlaying: false,
  menuOpen: false,
  ...over,
})
const act = (over: Partial<KeyContext>) => resolveShortcut(ctx(over))?.action ?? null

describe('typing guard', () => {
  // The browser's own undo must keep working inside the Inspector and note
  // textarea, so every shortcut is inert while typing.
  it.each([
    ['undo', { key: 'z', meta: true }],
    ['zoom', { key: '=' }],
    ['new diagram', { key: 'n', meta: true }],
    ['flow step', { key: 'ArrowRight', flowPlaying: true }],
  ])('ignores %s while typing', (_n, over) => {
    expect(act({ ...over, typing: true })).toBeNull()
  })
})

describe('modifier shortcuts', () => {
  it.each([
    ['new-diagram', { key: 'n' }],
    ['export-json', { key: 'e', shift: true }],
    ['open-diagram', { key: 'o' }],
    ['undo', { key: 'z' }],
    ['redo', { key: 'z', shift: true }],
    ['redo', { key: 'y' }],
    ['tidy', { key: 'l', shift: true }],
    ['tidy', { key: 't', shift: true }],
    ['toggle-inspector', { key: 'i' }],
    ['toggle-flows', { key: 'f', shift: true }],
    ['group', { key: 'g' }],
    ['ungroup', { key: 'g', shift: true }],
  ] as const)('resolves %s', (action, over) => {
    expect(act({ ...over, meta: true })).toBe(action)
    expect(act({ ...over, ctrl: true })).toBe(action)
  })

  it('needs a modifier — a bare letter is not a shortcut', () => {
    expect(act({ key: 'z' })).toBeNull()
    expect(act({ key: 'g' })).toBeNull()
  })

  it('does not fire the inspector toggle when alt is held', () => {
    expect(act({ key: 'i', meta: true, alt: true })).toBeNull()
  })

  it('distinguishes shifted from unshifted on the same key', () => {
    expect(act({ key: 'n', meta: true, shift: true })).toBeNull()
    expect(act({ key: 'e', meta: true })).toBeNull()
  })
})

describe('zoom is modifier-free', () => {
  it.each([
    ['zoom-in', '='],
    ['zoom-in', '+'],
    ['zoom-out', '-'],
    ['zoom-out', '_'],
    ['zoom-fit', '0'],
  ] as const)('resolves %s from %s', (action, key) => {
    expect(act({ key })).toBe(action)
  })

  // Otherwise it would fight the browser's own Ctrl/Cmd +/- page zoom.
  it.each(['meta', 'ctrl', 'alt'] as const)('does not zoom when %s is held', (m) => {
    expect(act({ key: '=', [m]: true })).toBeNull()
  })

  // Only the zoom group guards <select>: +/- and 0 would change the selection.
  it('does not zoom while a select is focused', () => {
    expect(act({ key: '=', onSelect: true })).toBeNull()
  })

  // The other groups never had that guard, and widening it would be a silent
  // behaviour change — this pins the asymmetry deliberately.
  it('still fires modifier shortcuts while a select is focused', () => {
    expect(act({ key: 'z', meta: true, onSelect: true })).toBe('undo')
  })
})

describe('flow stepping', () => {
  it.each([
    ['flow-next', 'ArrowRight'],
    ['flow-next', 'ArrowDown'],
    ['flow-prev', 'ArrowLeft'],
    ['flow-prev', 'ArrowUp'],
    ['flow-exit', 'Escape'],
  ] as const)('resolves %s from %s while playing', (action, key) => {
    expect(act({ key, flowPlaying: true })).toBe(action)
  })

  it('does nothing on arrows when no walkthrough is running', () => {
    expect(act({ key: 'ArrowRight' })).toBeNull()
    expect(act({ key: 'Escape' })).toBeNull()
  })

  // An open menu owns the arrow keys for its own navigation.
  it('yields the arrows to an open menu', () => {
    expect(act({ key: 'ArrowRight', flowPlaying: true, menuOpen: true })).toBeNull()
  })

  it('still resolves modifier shortcuts while playing', () => {
    expect(act({ key: 'z', meta: true, flowPlaying: true })).toBe('undo')
  })
})

describe('preventDefault', () => {
  it('is requested for ordinary shortcuts', () => {
    expect(resolveShortcut(ctx({ key: 'z', meta: true }))!.preventDefault).toBe(true)
    expect(resolveShortcut(ctx({ key: '=' }))!.preventDefault).toBe(true)
  })

  // Escape never preventDefaulted, and changing that could swallow it from
  // anything else listening.
  it('is NOT requested for Escape', () => {
    expect(resolveShortcut(ctx({ key: 'Escape', flowPlaying: true }))!.preventDefault).toBe(false)
  })
})

describe('unmapped keys', () => {
  it.each([{ key: 'q', meta: true }, { key: 'F5' }, { key: 'Tab' }, { key: 'a' }])(
    'returns null for %o',
    (over) => expect(act(over)).toBeNull(),
  )
})
