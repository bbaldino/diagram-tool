// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewPrefs } from './useViewPrefs'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useViewPrefs defaults', () => {
  it('starts with the chrome shown and snap off', () => {
    const { result } = renderHook(() => useViewPrefs())
    expect(result.current.showLegend).toBe(true)
    expect(result.current.showMinimap).toBe(true)
    expect(result.current.railVisible).toBe(true)
    expect(result.current.railTab).toBe('inspector')
    expect(result.current.snapToGrid).toBe(false)
  })

  it('defaults the persisted prefs when nothing is stored', () => {
    const { result } = renderHook(() => useViewPrefs())
    expect(result.current.noteSpellcheck).toBe(false)
    expect(result.current.layoutEngine).toBe('elk')
  })
})

describe('toggleRailTab', () => {
  // The whole point of this handler: ⌘I while already on the Inspector
  // collapses the rail rather than doing nothing.
  it('collapses the rail when the tab shown is selected again', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.toggleRailTab('inspector'))
    expect(result.current.railVisible).toBe(false)
    expect(result.current.railTab).toBe('inspector')
  })

  it('switches tab and keeps the rail open when a different tab is selected', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.toggleRailTab('flows'))
    expect(result.current.railVisible).toBe(true)
    expect(result.current.railTab).toBe('flows')
  })

  it('reopens the rail on the same tab after it was collapsed', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.toggleRailTab('inspector')) // collapse
    act(() => result.current.toggleRailTab('inspector')) // reopen
    expect(result.current.railVisible).toBe(true)
  })

  it('reopens the rail when a hidden rail is asked for a different tab', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.setRailVisible(false))
    act(() => result.current.toggleRailTab('flows'))
    expect(result.current.railVisible).toBe(true)
    expect(result.current.railTab).toBe('flows')
  })
})

describe('setRailTab vs toggleRailTab', () => {
  // The rail's own tab buttons must never collapse it — only the keyboard
  // shortcuts and View menu do that. Wiring the hook up surfaced this: the
  // extraction initially exposed only the toggling variant.
  it('setRailTab switches tab without ever collapsing', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.setRailTab('inspector'))
    expect(result.current.railVisible).toBe(true)
    expect(result.current.railTab).toBe('inspector')
  })
})

describe('persistence', () => {
  it('restores noteSpellcheck and layoutEngine from localStorage', () => {
    localStorage.setItem('homelab-note-spellcheck', 'true')
    localStorage.setItem('homelab-layout-engine', 'graphviz')
    const { result } = renderHook(() => useViewPrefs())
    expect(result.current.noteSpellcheck).toBe(true)
    expect(result.current.layoutEngine).toBe('graphviz')
  })

  it('writes both back when they change', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.setNoteSpellcheck(true))
    act(() => result.current.chooseEngine('graphviz'))
    expect(localStorage.getItem('homelab-note-spellcheck')).toBe('true')
    expect(localStorage.getItem('homelab-layout-engine')).toBe('graphviz')
  })

  it('falls back to elk for an unrecognised stored engine', () => {
    localStorage.setItem('homelab-layout-engine', 'nonsense')
    const { result } = renderHook(() => useViewPrefs())
    expect(result.current.layoutEngine).toBe('elk')
  })

  it('does not persist the transient chrome toggles', () => {
    const { result } = renderHook(() => useViewPrefs())
    act(() => result.current.setShowLegend(false))
    act(() => result.current.setSnapToGrid(true))
    expect(localStorage.getItem('homelab-show-legend')).toBeNull()
    expect(localStorage.getItem('homelab-snap-to-grid')).toBeNull()
  })

  // Private browsing and quota-exceeded both throw here. Losing a preference
  // is acceptable; taking the whole canvas down with it is not.
  it('survives localStorage throwing on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { result } = renderHook(() => useViewPrefs())
    expect(result.current.layoutEngine).toBe('elk')
  })

  it('survives localStorage throwing on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    const { result } = renderHook(() => useViewPrefs())
    expect(() => act(() => result.current.chooseEngine('graphviz'))).not.toThrow()
    expect(result.current.layoutEngine).toBe('graphviz')
  })
})
