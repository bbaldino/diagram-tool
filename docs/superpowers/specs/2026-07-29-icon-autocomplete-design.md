# Icon-slug autocomplete with previews — design

**Status:** Approved (design), pending implementation plan.
**Date:** 2026-07-29
**Branch:** `feat/icon-autocomplete` (off `main`).

## Motivation

A node's icon is set by typing a slug into the Inspector's "Icon slug" field
(`Inspector.tsx`), which the canvas renders as
`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/<slug>.svg`
(`ICON_BASE` in `graph.ts`). There is **no list of available slugs** — you type
blind and only find out a slug is wrong when the image 404s. The dashboard-icons
set has ~3,074 icons. Give the field an autocomplete dropdown that filters as you
type and shows a live preview of each match.

## Approach

A reusable **`IconInput`** component replaces the Inspector's plain icon
`<input>`. On first focus it lazily fetches the dashboard-icons **`metadata.json`**
once from the CDN, caches it in memory, and filters it as the user types —
showing a dropdown of matching slugs, each with a live SVG preview thumbnail
(`${ICON_BASE}/<slug>.svg`). Selecting a row fills the slug.

The field stays **free-text**: the dropdown is a helper, not a gate. Any typed
value is still accepted (custom/unknown/brand-new slugs aren't blocked), and if
the metadata fetch fails (e.g. offline LAN) the component silently degrades to
exactly today's plain input.

## Data source

- **`metadata.json`:** `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json`
- Shape (verified): an object keyed by slug; each value is
  `{ base: "svg" | "png" | …, aliases: string[], categories: string[], update: {…} }`.
- We use the **keys** (slugs) and **`aliases`** for matching, **`categories`** for
  an optional faint hint, and **`base`** to keep only icons available as SVG
  (a few are png-only) — so a preview always matches what the node will render
  (the app renders `<slug>.svg`).
- **Runtime fetch** (not bundled): always current, no build step, and the app
  already depends on this CDN for the icons themselves.
- **Mixed content is fine:** an HTTP LAN page loading from the HTTPS CDN is
  permitted (upgrade direction) — it's how icons already render today.

## `iconIndex.ts` (fetch + cache + search)

- `loadIconIndex(): Promise<IconEntry[]>` — fetches `metadata.json` **once**,
  caches the parsed result at module scope, and **dedupes in-flight calls** (two
  focuses don't double-fetch). On failure, resolves to `[]` (graceful — the
  input still works as free text) and may retry on a later call.
- `IconEntry = { slug: string; aliases: string[]; categories: string[] }`,
  built only from entries whose `base` includes `svg`. Slug + aliases are stored
  lowercased alongside the display value for matching.
- `searchIcons(index, query, limit = 10): IconEntry[]` — pure, synchronous.
  Empty query → `[]` (no dropdown). Otherwise case-insensitive: rank **prefix
  matches on the slug first**, then prefix on an alias, then substring on
  slug/alias; stable within a tier by slug; capped at `limit`.

## `IconInput.tsx` (autocomplete input + dropdown)

- Props: `{ value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string }`
  — a drop-in for the current Inspector input.
- Renders the text `<input>`; on focus, kicks off `loadIconIndex()` (once).
- As `value` changes, computes `searchIcons(...)` and shows a dropdown of the
  matches: each row is `[preview <img>] <slug>  <faint category>`.
- **Free text preserved:** typing calls `onChange` with the raw value (or
  `undefined` when emptied, matching the current field). Selecting a row calls
  `onChange(slug)` and closes the dropdown.
- **Keyboard:** ArrowDown/ArrowUp move the highlighted row (wrapping), Enter
  selects the highlighted row (or, if none highlighted, just keeps the typed
  value and closes), Escape closes the dropdown without changing the value.
  Mouse click on a row selects it. Blur closes the dropdown (after a click has a
  chance to register).
- **First-fetch feedback:** a small "loading icons…" line in the dropdown while
  the index is loading and the query is non-empty; once loaded, matches replace
  it. No blocking spinner.
- **Broken preview:** an `<img>` that errors is hidden / replaced by a neutral
  placeholder box so the row (slug text) still reads.
- Only the filtered rows (≤ `limit`) render, so at most ~10 preview `<img>`s are
  ever in the DOM at once.

## Inspector integration

- In `Inspector.tsx`, replace the raw icon `<input>` (the "Icon slug" `Field`)
  with `<IconInput value={d.icon} onChange={(v) => onNodeData({ icon: v })} />`.
  Keep the field label and the existing placeholder text.
- No model/serialization change — `icon` is still a free-form string slug.

## Styling

- Reuse the app's existing panel/menu look (e.g. the `.addmenu`/dropdown styles)
  for the dropdown so it matches the Inspector. Small, self-contained CSS in
  `index.css` (a `.iconinput` / `.iconinput__menu` / `.iconinput__row` block).
- Not a native popup — an in-app dropdown, consistent with the no-native-popups
  rule (that rule targets `alert`/`prompt`/`confirm`).

## Testing

- **`iconIndex.test.ts`:** `searchIcons` is pure and fully unit-tested against a
  small fixture index — empty query → `[]`; slug prefix ranks above alias prefix
  above substring; alias matches surface the right slug; `limit` respected;
  case-insensitive. `loadIconIndex` caches (one fetch for repeated calls, via a
  mocked `fetch`) and returns `[]` on fetch failure without throwing.
- **`IconInput.test.tsx`** (jsdom/RTL if available, else a thin render smoke
  test): typing shows filtered rows; ArrowDown+Enter selects a slug and calls
  `onChange`; Escape closes without changing the value; a raw typed value still
  propagates via `onChange` (free-text preserved).
- **Browser (Playwright):** in the Inspector, type into the icon field → a
  dropdown of matching icons with previews appears; clicking one sets the node's
  icon and the canvas node shows it.

## Out of scope (follow-ups)

- A full icon **browser/gallery** modal (grid of all icons). The inline
  autocomplete covers the "I know roughly what I want" case; a gallery is a
  separate, larger feature.
- Caching the metadata to disk / bundling a static slug list. Runtime fetch +
  in-memory cache is enough; revisit only if CDN latency becomes a problem.
- Autocomplete anywhere other than the Inspector (the slug is entered only
  there today).
