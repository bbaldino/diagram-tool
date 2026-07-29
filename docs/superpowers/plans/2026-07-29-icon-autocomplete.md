# Icon-slug autocomplete with previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Inspector's "Icon slug" field an autocomplete dropdown that filters the dashboard-icons set as you type and shows a live preview of each match, while staying a free-text field.

**Architecture:** A pure data/search module (`iconIndex.ts`) that fetches the dashboard-icons `metadata.json` once, caches it, and searches it; and a presentational `IconInput` component that uses it to render a filtered, keyboard-navigable dropdown with SVG previews. The Inspector swaps its raw `<input>` for `<IconInput>`. No model change — `icon` stays a free-form slug string.

**Tech Stack:** React + TypeScript, Vitest (node env — NO DOM), the existing dashboard-icons CDN.

**Design spec:** `docs/superpowers/specs/2026-07-29-icon-autocomplete-design.md`.

## Global Constraints

- Every task keeps `npx tsc --noEmit` clean and the full `npx vitest run` green.
- **No new test stack.** The repo has no jsdom/RTL/testing-library and no component tests — do NOT add them. All automated tests are pure-logic unit tests in the node env (mock `fetch` with `vi.stubGlobal`). The React component (`IconInput`) is verified by `tsc` + the controller's final Playwright pass, not by a unit test.
- The field stays **free-text**: any typed value still propagates via `onChange` (emptying the field yields `undefined`, matching today's behavior); the dropdown is a helper, never a gate.
- Runtime CDN fetch (not bundled). Metadata URL: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json`. Icons render as `${ICON_BASE}/<slug>.svg` (`ICON_BASE` already exported from `src/graph.ts`).
- On fetch failure, degrade silently to a plain text input (no dropdown, no error).
- Identifiers capitalize only the first letter of a multi-letter acronym (e.g. `iconUrl`, not `iconURL`); SCREAMING_SNAKE module constants follow the existing convention (`ICON_BASE`, so `METADATA_URL`).
- Commits end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The dropdown is an in-app element (not `alert`/`prompt`/`confirm`), consistent with the no-native-popups rule.

---

## File Structure

- `webapp/src/iconIndex.ts` — **new**: `loadIconIndex` (fetch + cache + in-flight dedupe), `buildIndex`, `searchIcons` (pure ranking), `moveHighlight` (pure keyboard-cursor math), `IconEntry` type.
- `webapp/src/iconIndex.test.ts` — **new**: unit tests for `buildIndex`/`searchIcons`/`moveHighlight`/`loadIconIndex`.
- `webapp/src/IconInput.tsx` — **new**: the autocomplete input + dropdown component.
- `webapp/src/index.css` — **modified**: `.iconinput*` dropdown styles.
- `webapp/src/Inspector.tsx` — **modified**: swap the raw icon `<input>` for `<IconInput>`.

---

### Task 1: `iconIndex.ts` — fetch, cache, and pure search

**Files:**
- Create: `webapp/src/iconIndex.ts`
- Test: `webapp/src/iconIndex.test.ts`

**Interfaces:**
- Consumes: `ICON_BASE` from `./graph` (not needed here, but the module lives beside it).
- Produces:
  - `IconEntry = { slug: string; aliases: string[]; categories: string[] }`
  - `buildIndex(meta): IconEntry[]` — keep only `base === 'svg'` entries, sorted by slug.
  - `searchIcons(index, query, limit = 10): IconEntry[]` — pure ranked filter.
  - `moveHighlight(current, count, delta): number` — pure wrapping cursor math.
  - `loadIconIndex(): Promise<IconEntry[]>` — fetch metadata once, cache, dedupe in-flight, `[]` on failure.

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/iconIndex.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildIndex, searchIcons, moveHighlight, loadIconIndex, type IconEntry } from './iconIndex'

const fixture: IconEntry[] = [
  { slug: 'plex', aliases: ['plexmediaserver'], categories: ['media'] },
  { slug: 'plexamp', aliases: [], categories: ['media'] },
  { slug: 'sonarr', aliases: [], categories: ['media'] },
  { slug: 'complex-thing', aliases: ['xplex'], categories: [] },
  { slug: 'radarr', aliases: ['movies'], categories: ['media'] },
]

describe('buildIndex', () => {
  it('keeps only svg-based icons and sorts by slug', () => {
    const out = buildIndex({
      zulip: { base: 'svg', aliases: ['chat'], categories: ['comm'] },
      apple: { base: 'png', aliases: [] }, // png-only → dropped (app renders .svg)
      arch: { base: 'svg' },
    })
    expect(out.map((e) => e.slug)).toEqual(['arch', 'zulip'])
    expect(out[0]).toEqual({ slug: 'arch', aliases: [], categories: [] })
    expect(out[1].aliases).toEqual(['chat'])
  })
})

describe('searchIcons', () => {
  it('returns [] for an empty/whitespace query', () => {
    expect(searchIcons(fixture, '')).toEqual([])
    expect(searchIcons(fixture, '   ')).toEqual([])
  })
  it('ranks slug-prefix, then alias-prefix, then substring; stable by slug', () => {
    // 'plex': slug-prefix plex, plexamp; substring complex-thing (slug) + plex(alias already counted)
    expect(searchIcons(fixture, 'plex').map((e) => e.slug)).toEqual(['plex', 'plexamp', 'complex-thing'])
  })
  it('surfaces an icon via an alias-prefix match', () => {
    expect(searchIcons(fixture, 'movies').map((e) => e.slug)).toEqual(['radarr'])
  })
  it('is case-insensitive and respects the limit', () => {
    expect(searchIcons(fixture, 'PLEX').map((e) => e.slug)).toEqual(['plex', 'plexamp', 'complex-thing'])
    expect(searchIcons(fixture, 'a', 1)).toHaveLength(1)
  })
})

describe('moveHighlight', () => {
  it('wraps and handles the none-selected (-1) and empty cases', () => {
    expect(moveHighlight(-1, 3, +1)).toBe(0)
    expect(moveHighlight(-1, 3, -1)).toBe(2)
    expect(moveHighlight(2, 3, +1)).toBe(0)
    expect(moveHighlight(0, 3, -1)).toBe(2)
    expect(moveHighlight(0, 0, +1)).toBe(-1)
  })
})

describe('loadIconIndex', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches once and caches across calls', async () => {
    const mod = await import('./iconIndex')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ plex: { base: 'svg', aliases: [], categories: [] } }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const a = await mod.loadIconIndex()
    const b = await mod.loadIconIndex()
    expect(a.map((e) => e.slug)).toEqual(['plex'])
    expect(b).toBe(a) // same cached array
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] on fetch failure without throwing', async () => {
    const mod = await import('./iconIndex')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await expect(mod.loadIconIndex()).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/iconIndex.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `webapp/src/iconIndex.ts`**

```ts
const METADATA_URL = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json'

export interface IconEntry {
  slug: string
  aliases: string[]
  categories: string[]
}

// The metadata.json shape (only the fields we use). Keyed by slug.
interface RawMeta {
  [slug: string]: { base?: string; aliases?: string[]; categories?: string[] } | undefined
}

// The app renders `${ICON_BASE}/<slug>.svg`, so only offer icons available as
// SVG (a few entries are png-only). Sorted by slug for stable ordering.
export function buildIndex(meta: RawMeta): IconEntry[] {
  const out: IconEntry[] = []
  for (const [slug, v] of Object.entries(meta)) {
    if (!v || v.base !== 'svg') continue
    out.push({ slug, aliases: v.aliases ?? [], categories: v.categories ?? [] })
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  return out
}

// Ranked filter: slug-prefix, then alias-prefix, then substring (slug or alias);
// stable by slug within a tier; capped at `limit`. Empty query → [].
export function searchIcons(index: IconEntry[], query: string, limit = 10): IconEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { e: IconEntry; tier: number }[] = []
  for (const e of index) {
    const slug = e.slug.toLowerCase()
    const aliases = e.aliases.map((a) => a.toLowerCase())
    let tier = -1
    if (slug.startsWith(q)) tier = 0
    else if (aliases.some((a) => a.startsWith(q))) tier = 1
    else if (slug.includes(q) || aliases.some((a) => a.includes(q))) tier = 2
    if (tier >= 0) scored.push({ e, tier })
  }
  scored.sort((a, b) => a.tier - b.tier || (a.e.slug < b.e.slug ? -1 : a.e.slug > b.e.slug ? 1 : 0))
  return scored.slice(0, limit).map((s) => s.e)
}

// Wrapping cursor math for keyboard nav. current = -1 means nothing highlighted.
export function moveHighlight(current: number, count: number, delta: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}

let cache: IconEntry[] | null = null
let inflight: Promise<IconEntry[]> | null = null

// Fetch the dashboard-icons metadata ONCE, cache the built index, and dedupe
// concurrent calls. On any failure, resolve to [] so the input degrades to a
// plain free-text field (the icons themselves already depend on this CDN).
export async function loadIconIndex(): Promise<IconEntry[]> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(METADATA_URL)
      if (!res.ok) throw new Error(`metadata ${res.status}`)
      cache = buildIndex((await res.json()) as RawMeta)
      return cache
    } catch {
      return []
    } finally {
      inflight = null
    }
  })()
  return inflight
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/iconIndex.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full green + commit**

Run: `npx vitest run && npx tsc --noEmit`
```bash
git add webapp/src/iconIndex.ts webapp/src/iconIndex.test.ts
git commit -m "feat(icons): icon metadata index — fetch/cache + pure search"
```

---

### Task 2: `IconInput` component + Inspector integration

**Files:**
- Create: `webapp/src/IconInput.tsx`
- Modify: `webapp/src/index.css` (append `.iconinput*` styles)
- Modify: `webapp/src/Inspector.tsx` (swap the icon `<input>`)

**Interfaces:**
- Consumes: `ICON_BASE` from `./graph`; `loadIconIndex`, `searchIcons`, `moveHighlight`, `IconEntry` from `./iconIndex` (Task 1).
- Produces: `IconInput({ value, onChange, placeholder })` — `value: string | undefined`, `onChange: (v: string | undefined) => void`.

**Verification note:** there is no DOM test stack (see Global Constraints). This task is verified by `npx tsc --noEmit` clean + the full existing suite staying green. The interactive behavior is verified by the controller's Playwright pass in Task 3 — do NOT add jsdom/RTL.

- [ ] **Step 1: Create `webapp/src/IconInput.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ICON_BASE } from './graph'
import { loadIconIndex, searchIcons, moveHighlight, type IconEntry } from './iconIndex'

interface Props {
  value: string | undefined
  onChange: (v: string | undefined) => void
  placeholder?: string
}

export function IconInput({ value, onChange, placeholder }: Props) {
  const [index, setIndex] = useState<IconEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  // Lazily load the icon index the first time the field is focused.
  const ensureIndex = () => {
    if (index === null) void loadIconIndex().then(setIndex)
  }

  const query = value ?? ''
  const matches = index ? searchIcons(index, query) : []
  const loading = open && query.trim() !== '' && index === null
  const showMenu = open && query.trim() !== '' && (loading || matches.length > 0)

  // Reset the keyboard cursor whenever the query changes.
  useEffect(() => setHighlight(-1), [query])

  const pick = (slug: string) => {
    onChange(slug)
    setOpen(false)
  }

  return (
    <div className="iconinput">
      <input
        value={query}
        placeholder={placeholder}
        onFocus={() => {
          ensureIndex()
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let a row click register first
        onChange={(e) => {
          onChange(e.target.value || undefined)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!showMenu) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => moveHighlight(h, matches.length, +1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => moveHighlight(h, matches.length, -1))
          } else if (e.key === 'Enter') {
            if (highlight >= 0 && matches[highlight]) {
              e.preventDefault()
              pick(matches[highlight].slug)
            } else {
              setOpen(false)
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {showMenu && (
        <div className="iconinput__menu">
          {loading ? (
            <div className="iconinput__loading">loading icons…</div>
          ) : (
            matches.map((m, i) => (
              <button
                type="button"
                key={m.slug}
                className={`iconinput__row ${i === highlight ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} // keep input focus so onBlur doesn't fire before onClick
                onClick={() => pick(m.slug)}
                onMouseEnter={() => setHighlight(i)}
              >
                <img
                  className="iconinput__preview"
                  src={`${ICON_BASE}/${m.slug}.svg`}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
                <span className="iconinput__slug">{m.slug}</span>
                {m.categories[0] ? <span className="iconinput__cat">{m.categories[0]}</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

Note: `useRef` is imported for parity with other components but only used if needed; if the implementer doesn't use it, drop the import to keep `tsc` (noUnusedLocals) clean.

- [ ] **Step 2: Append dropdown styles to `webapp/src/index.css`**

```css
/* ---------- Icon autocomplete ---------- */
.iconinput { position: relative; }
.iconinput__menu {
  position: absolute; z-index: 20; top: 100%; left: 0; right: 0;
  margin-top: 2px; max-height: 260px; overflow-y: auto;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}
.iconinput__row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border: none; background: transparent; cursor: pointer;
  font: inherit; text-align: left; color: inherit;
}
.iconinput__row.is-active, .iconinput__row:hover { background: #f1f5f9; }
.iconinput__preview { width: 20px; height: 20px; object-fit: contain; flex: none; }
.iconinput__slug { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iconinput__cat { color: #94a3b8; font-size: 11px; }
.iconinput__loading { padding: 8px; color: #64748b; font-size: 12px; }
```

- [ ] **Step 3: Swap the Inspector's icon field**

In `webapp/src/Inspector.tsx`, add the import (top, with the other imports):

```ts
import { IconInput } from './IconInput'
```

Replace the "Icon slug" `Field`'s raw `<input>` (currently `value={d.icon ?? ''}` … `onChange={(e) => onNodeData({ icon: e.target.value || undefined })}`) with:

```tsx
<Field label="Icon slug">
  <IconInput
    value={d.icon}
    onChange={(v) => onNodeData({ icon: v })}
    placeholder="plex, sonarr, … (dashboard-icons)"
  />
</Field>
```

- [ ] **Step 4: Verify build is clean**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite still green (no test regressions; Task 1's tests cover the pure logic). If `tsc` flags an unused `useRef`/import, remove it.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/IconInput.tsx webapp/src/index.css webapp/src/Inspector.tsx
git commit -m "feat(icons): IconInput autocomplete with previews in the Inspector"
```

---

### Task 3: Browser validation (controller-run, not a subagent task)

**Not an implementer task** — the controller runs this after the final whole-branch review.

- [ ] With the dev server up, open the app, select a node, and focus the Inspector "Icon slug" field.
- [ ] Type a few letters (e.g. `plex`): a dropdown appears with matching slugs and **SVG previews**.
- [ ] Arrow-key down + Enter (and separately, a mouse click) selects a slug; the field fills and the **canvas node shows that icon**.
- [ ] Type a bogus slug (e.g. `zzznotreal`): no dropdown / no crash, and the value is still accepted (free-text preserved).
- [ ] Confirm no console errors; screenshot the dropdown.

---

## Self-Review

**Spec coverage:** metadata fetch + cache + dedupe (Task 1 `loadIconIndex`) ✓; SVG-only via `base` (Task 1 `buildIndex`) ✓; ranked slug/alias search (Task 1 `searchIcons`) ✓; keyboard nav math (Task 1 `moveHighlight`) ✓; dropdown with previews + keyboard/mouse select + free-text + loading/broken-preview handling (Task 2 `IconInput`) ✓; Inspector swap, no model change (Task 2) ✓; graceful offline degradation (Task 1 returns `[]` → Task 2 shows no menu) ✓; browser pass (Task 3) ✓.

**Placeholder scan:** none — every code/test step carries real content.

**Type consistency:** `IconEntry` and the four exports of `iconIndex.ts` (Task 1) are consumed with the same signatures by `IconInput` (Task 2). `IconInput`'s `{ value: string | undefined; onChange: (v: string | undefined) => void }` matches the Inspector's `d.icon` (`string | undefined`) and `onNodeData({ icon: v })`. `ICON_BASE` is imported from `./graph` in both the component and (conceptually) alongside the index, matching its existing export.
