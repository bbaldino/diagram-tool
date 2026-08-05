// View preferences: what chrome is showing, which right-rail tab is active,
// and the two settings that outlive a reload.
//
// Extracted from Flow() in App.tsx as the first of the hook clusters — it is
// the most isolated one, touching no canvas or model state, so it proves the
// pattern without risking an edit path.
//
// Persistence was inconsistent before: noteSpellcheck wrote through an effect
// while layoutEngine wrote imperatively inside its setter, two mechanisms for
// the same job. Both now go through usePersistedState.
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export type RailTab = 'inspector' | 'flows'
export type LayoutEngine = 'elk' | 'graphviz'

const SPELLCHECK_KEY = 'homelab-note-spellcheck'
const ENGINE_KEY = 'homelab-layout-engine'

// State mirrored into localStorage. Reads are lazy so the value is only pulled
// once, on mount, and a write that throws (private browsing, quota) must not
// take the app down with it — a lost preference is not worth a crash.
function usePersistedState<T extends string | boolean>(
  key: string,
  fallback: T,
  decode: (raw: string) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : decode(raw)
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // ignore — see above
    }
  }, [key, value])
  return [value, setValue]
}

export interface ViewPrefs {
  // Setters are the full Dispatch<SetStateAction<T>> that useState returns, not
  // (v: T) => void — call sites toggle with updater functions (`(v) => !v`).
  showLegend: boolean
  setShowLegend: Dispatch<SetStateAction<boolean>>
  showMinimap: boolean
  setShowMinimap: Dispatch<SetStateAction<boolean>>
  snapToGrid: boolean
  setSnapToGrid: Dispatch<SetStateAction<boolean>>
  railVisible: boolean
  setRailVisible: Dispatch<SetStateAction<boolean>>
  railTab: RailTab
  /** Plain tab switch, used by the rail's own tab buttons — never collapses. */
  setRailTab: Dispatch<SetStateAction<RailTab>>
  /** Selects a tab, collapsing the rail if that tab is already the one showing.
   *  This is the keyboard/menu behaviour (⌘I, ⌘⇧F, View menu), deliberately
   *  different from clicking a tab that is already open. */
  toggleRailTab: (t: RailTab) => void
  noteSpellcheck: boolean
  setNoteSpellcheck: Dispatch<SetStateAction<boolean>>
  layoutEngine: LayoutEngine
  chooseEngine: (e: LayoutEngine) => void
}

export function useViewPrefs(): ViewPrefs {
  const [showLegend, setShowLegend] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [railVisible, setRailVisible] = useState(true)
  const [railTab, setRailTab] = useState<RailTab>('inspector')

  const [noteSpellcheck, setNoteSpellcheck] = usePersistedState<boolean>(
    SPELLCHECK_KEY,
    false,
    (raw) => raw === 'true',
  )
  const [layoutEngine, chooseEngine] = usePersistedState<LayoutEngine>(
    ENGINE_KEY,
    'elk',
    // Anything unrecognised falls back rather than being stored as-is: a
    // hand-edited or stale key must not put the app in a state with no engine.
    (raw) => (raw === 'graphviz' ? 'graphviz' : 'elk'),
  )

  // ⌘I / ⌘⇧F and the View menu all use this: pressing the shortcut for the tab
  // you are already looking at collapses the rail rather than doing nothing.
  const toggleRailTab = useCallback(
    (t: RailTab) => {
      setRailVisible((v) => !(v && railTab === t))
      setRailTab(t)
    },
    [railTab],
  )

  return {
    showLegend,
    setShowLegend,
    showMinimap,
    setShowMinimap,
    snapToGrid,
    setSnapToGrid,
    railVisible,
    setRailVisible,
    railTab,
    setRailTab,
    toggleRailTab,
    noteSpellcheck,
    setNoteSpellcheck,
    layoutEngine,
    chooseEngine,
  }
}
