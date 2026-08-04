# Colour Schemes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an entity's colour a named scheme carrying outline, background and font, so an entity always has one and absence stops existing.

**Architecture:** A new `schemes.ts` owns a table of named schemes plus a `resolveScheme` function that looks a name up or derives from a hex. Nodes and notes render from a resolved scheme with no absent/present branch. The field is renamed `color` → `scheme` and back-filled on load.

**Tech Stack:** React 18, TypeScript, Vite, vitest, `@testing-library/react` + jsdom, zod.

## Global Constraints

- Prettier `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. `npm run format:check` is a CI gate.
- All npm/vitest commands run from `webapp/`. Git from the repo root.
- Component tests need `// @vitest-environment jsdom` as the FIRST line. Pure tests must NOT have one. No global vitest `environment` setting, no vitest config file.
- `npm run typecheck`, `npx vitest run` and `npx vite build` clean before every commit. The suite currently has **442** tests.
- **No scheme is named `default`.** "Default" exists only as `NEW_NODE_SCHEME` / `NEW_NOTE_SCHEME` — a starting value, not a kind of colour. Nothing may branch on defaultness.
- Contrast floor is **4.5:1** (WCAG AA). If a scheme fails, change the scheme's values — never the threshold.
- **Scope is nodes and notes only.** Edges keep absence-means-relationship-type-colour; groups already always carry a colour. Do not convert either.

---

### Task 1: The scheme table and resolver

**Files:**
- Create: `webapp/src/schemes.ts`
- Create: `webapp/src/schemes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface Scheme { background: string; border: string; text: string }`
  - `export const SCHEMES: Record<string, Scheme>` — 13 entries
  - `export const NEW_NODE_SCHEME = 'paper'` and `export const NEW_NOTE_SCHEME = 'sticky'`
  - `export function resolveScheme(value: string, fallback: string): Scheme`
  - `export function secondaryText(s: Scheme): string` and `export function accentFill(s: Scheme): string`

- [ ] **Step 1: Write the failing test**

Create `webapp/src/schemes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SCHEMES, NEW_NODE_SCHEME, NEW_NOTE_SCHEME, resolveScheme } from './schemes'

describe('scheme table', () => {
  it('has no scheme named "default" — default is a starting value, not a colour', () => {
    expect(Object.keys(SCHEMES)).not.toContain('default')
  })

  it('names the starting schemes for nodes and notes, and both are real entries', () => {
    expect(SCHEMES[NEW_NODE_SCHEME]).toBeDefined()
    expect(SCHEMES[NEW_NOTE_SCHEME]).toBeDefined()
  })

  it('reproduces the current node default exactly', () => {
    expect(SCHEMES.paper).toEqual({
      background: '#ffffff',
      border: '#cbd5e1',
      text: '#1f2937',
    })
  })

  it('reproduces the current note default exactly', () => {
    expect(SCHEMES.sticky).toEqual({
      background: '#fef9c3',
      border: '#fde047',
      text: '#713f12',
    })
  })
})

describe('resolveScheme', () => {
  it('looks up a known name', () => {
    expect(resolveScheme('blue', NEW_NODE_SCHEME)).toEqual(SCHEMES.blue)
  })

  it('derives a scheme from a hex, matching the previous derivation ratios', () => {
    // background 15% over white, border 45% over white, text 55% toward black
    expect(resolveScheme('#3b82f6', NEW_NODE_SCHEME)).toEqual({
      background: '#e2ecfe',
      border: '#a7c7fb',
      text: '#204887',
    })
  })

  it('falls back to the given scheme for an unknown name rather than throwing', () => {
    expect(resolveScheme('nonsense', NEW_NODE_SCHEME)).toEqual(SCHEMES.paper)
  })

  it('falls back for a malformed hex too', () => {
    expect(resolveScheme('#12345', NEW_NOTE_SCHEME)).toEqual(SCHEMES.sticky)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/schemes.test.ts`
Expected: FAIL — cannot resolve `./schemes`.

- [ ] **Step 3: Write the implementation**

Create `webapp/src/schemes.ts`. The eleven colour entries are the former `PALETTE` hexes with their three values computed once and written as literals, so nothing derives at render time:

```ts
// A colour is a SCHEME: outline, background and font chosen as one unit. This
// replaces deriving all three from a single hex, which could not express the
// entity defaults (a white background forces the source hex to white, which then
// yields a white border and grey text) and degenerated on pale colours.
//
// There is deliberately NO scheme named 'default'. "Default" is a starting
// value — NEW_NODE_SCHEME / NEW_NOTE_SCHEME below — not a kind of colour.
export interface Scheme {
  background: string
  border: string
  text: string
}

export const SCHEMES: Record<string, Scheme> = {
  // The two starting schemes, byte-identical to the previous literal defaults.
  paper: { background: '#ffffff', border: '#cbd5e1', text: '#1f2937' },
  sticky: { background: '#fef9c3', border: '#fde047', text: '#713f12' },
  // The former PALETTE, resolved once at authoring time.
  slate: { background: '#e8eaee', border: '#b9c0cb', text: '#37404c' },
  red: { background: '#fde3e3', border: '#f8abab', text: '#832525' },
  orange: { background: '#feeadc', border: '#fcc096', text: '#893f0c' },
  amber: { background: '#fef0da', border: '#fad391', text: '#875706' },
  yellow: { background: '#fcf4da', border: '#f6dd90', text: '#816204' },
  emerald: { background: '#dbf4ec', border: '#93e0c6', text: '#096647' },
  teal: { background: '#dcf4f2', border: '#95dfd7', text: '#0b655b' },
  blue: { background: '#e2ecfe', border: '#a7c7fb', text: '#204887' },
  indigo: { background: '#e8e8fd', border: '#b9baf9', text: '#363885' },
  violet: { background: '#eee7fe', border: '#cbb6fb', text: '#4c3387' },
  pink: { background: '#fce4f0', border: '#f6add1', text: '#822854' },
}

// The ONLY place "default" exists: which scheme a new entity starts with.
export const NEW_NODE_SCHEME = 'paper'
export const NEW_NOTE_SCHEME = 'sticky'

const HEX = /^#[0-9a-fA-F]{6}$/

function rgb(hex: string): [number, number, number] {
  const n = hex.slice(1)
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  const p = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`
}

// Per-channel linear interpolation — the same maths color-mix(in srgb, …) used.
function mix(a: [number, number, number], pct: number, b: [number, number, number]) {
  const p = pct / 100
  return toHex([a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)])
}

const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]

// A custom hex derives a scheme using the ratios the old renderer used, so a
// custom colour looks exactly as it did before this change.
function deriveScheme(hex: string): Scheme {
  const c = rgb(hex)
  return { background: mix(c, 15, WHITE), border: mix(c, 45, WHITE), text: mix(c, 55, BLACK) }
}

// A stored value is either a scheme name or a custom hex. Anything else — a
// typo, hand-edited data, a bad MCP call — falls back rather than rendering
// unstyled.
export function resolveScheme(value: string, fallback: string): Scheme {
  if (SCHEMES[value]) return SCHEMES[value]
  if (HEX.test(value)) return deriveScheme(value)
  return SCHEMES[fallback]
}

// Secondary tones are derived from the scheme rather than stored, so a scheme
// stays the three things a user is actually choosing.
export function secondaryText(s: Scheme): string {
  return mix(rgb(s.text), 70, rgb(s.background))
}

export function accentFill(s: Scheme): string {
  return mix(rgb(s.border), 35, rgb(s.background))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/schemes.test.ts`
Expected: PASS, 8 tests.

If the derived-hex test fails, the expected literals came from the same maths — print the actual value and check the rounding, rather than changing the ratios.

- [ ] **Step 5: Repoint the contrast guard at the scheme table**

`webapp/src/entityContrast.test.ts` currently iterates `PALETTE` and recomputes derivations. The scheme table is now the complete set of what can render, so replace its body with:

```ts
import { describe, it, expect } from 'vitest'
import { SCHEMES, secondaryText, type Scheme } from './schemes'

const MIN_CONTRAST = 4.5 // WCAG AA for normal text

function rgb(hex: string): [number, number, number] {
  const n = hex.slice(1)
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const entries = Object.entries(SCHEMES) as [string, Scheme][]

describe('scheme contrast', () => {
  it.each(entries)('%s: primary text clears AA on its own background', (_name, s) => {
    expect(contrast(s.text, s.background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it.each(entries)('%s: secondary text clears AA on its own background', (_name, s) => {
    expect(contrast(secondaryText(s), s.background)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })
})
```

- [ ] **Step 6: Run the guard and confirm it has teeth**

Run: `npx vitest run src/entityContrast.test.ts`
Expected: PASS, 26 cases. The worst primary case is `yellow` at about 5.18; `paper` is about 14.68.

Then temporarily change `SCHEMES.yellow.text` to `'#d4d4d4'`, re-run, and confirm the yellow cases FAIL. Revert and confirm they pass again. A guard you have not watched fail is not yet a guard — record both outputs in your report.

**If a secondary-text case fails**, change the ratio in `secondaryText` (mixing further toward `text` raises contrast) — never `MIN_CONTRAST`.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass. Nothing imports `schemes.ts` yet, so this task is purely additive.

- [ ] **Step 8: Format and commit**

```bash
npx prettier --write src/schemes.ts src/schemes.test.ts src/entityContrast.test.ts
npm run format:check
cd .. && git add webapp/src/schemes.ts webapp/src/schemes.test.ts webapp/src/entityContrast.test.ts
git commit -m "feat(schemes): add the named colour scheme table and resolver

A colour becomes a scheme — outline, background, font — chosen as one unit.
The eleven palette colours are resolved once at authoring time and written as
literals, so nothing derives at render. paper and sticky reproduce the current
node and note defaults byte-for-byte.

No scheme is named 'default': that exists only as NEW_NODE_SCHEME and
NEW_NOTE_SCHEME, a starting value rather than a kind of colour.

The contrast guard now iterates the scheme table, which is the complete set of
what can render, instead of recomputing derivations from palette hexes."
```

---

### Task 2: Rename the field and back-fill on load

**Files:**
- Modify: `webapp/src/model.ts` (`Node` and `Note` interfaces)
- Modify: `webapp/src/buildGraph.ts` (service node data, note data)
- Modify: `webapp/src/App.tsx` (`nodesToDiagramParts`)
- Modify: `webapp/server/app-store.ts` (back-fill on load)
- Test: `webapp/src/schemeMigration.test.ts` (create)

**Interfaces:**
- Consumes: `NEW_NODE_SCHEME`, `NEW_NOTE_SCHEME` from Task 1.
- Produces: `Node.scheme?: string` and `Note.scheme?: string` in the model; `data.scheme` on canvas nodes; `export function backfillSchemes(model: Model): Model` in `webapp/src/model.ts`.

The field stays **optional in the type** so old data loads, but `backfillSchemes` means nothing reaches the renderer without one.

- [ ] **Step 1: Write the failing test**

Create `webapp/src/schemeMigration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { backfillSchemes } from './model'
import { NEW_NODE_SCHEME, NEW_NOTE_SCHEME } from './schemes'

const model = (nodeScheme?: string, noteScheme?: string) =>
  ({
    version: 2,
    templates: [],
    diagrams: [
      {
        id: 'd', name: 'D', title: 'D', type: 'canvas',
        groups: [], edges: [], flows: [],
        nodes: [
          { id: 'n1', label: 'Plex', fields: [], position: { x: 0, y: 0 },
            ...(nodeScheme ? { scheme: nodeScheme } : {}) },
        ],
        notes: [
          { id: 't1', text: 'x', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
            ...(noteScheme ? { scheme: noteScheme } : {}) },
        ],
      },
    ],
  }) as never

const read = (m: unknown) => {
  const d = (m as { diagrams: { nodes: { scheme?: string }[]; notes: { scheme?: string }[] }[] })
    .diagrams[0]
  return { node: d.nodes[0].scheme, note: d.notes[0].scheme }
}

describe('backfillSchemes', () => {
  it('gives a node with no scheme the node starting scheme', () => {
    expect(read(backfillSchemes(model())).node).toBe(NEW_NODE_SCHEME)
  })

  it('gives a note with no scheme the note starting scheme', () => {
    expect(read(backfillSchemes(model())).note).toBe(NEW_NOTE_SCHEME)
  })

  it('leaves an entity that already has one untouched, including a custom hex', () => {
    const out = read(backfillSchemes(model('#7c3aed', 'blue')))
    expect(out.node).toBe('#7c3aed')
    expect(out.note).toBe('blue')
  })

  it('is idempotent — a second run changes nothing', () => {
    const once = backfillSchemes(model())
    expect(backfillSchemes(once)).toEqual(once)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/schemeMigration.test.ts`
Expected: FAIL — `backfillSchemes` is not exported.

- [ ] **Step 3: Rename the model fields**

In `webapp/src/model.ts`, change `color?: string` to `scheme?: string` on **`Node` and `Note` only**. Update the comment to say it holds a scheme name or a custom hex. Leave `Group.color` and `Edge.color` exactly as they are — those are out of scope.

- [ ] **Step 4: Add the back-fill**

In `webapp/src/model.ts`:

```ts
// Give every node and note a scheme. The field is optional in the type so data
// written before schemes existed still loads, but nothing reaches the renderer
// without one — so there is no absent case to handle downstream. Idempotent.
export function backfillSchemes(model: Model): Model {
  return {
    ...model,
    diagrams: model.diagrams.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.scheme ? n : { ...n, scheme: NEW_NODE_SCHEME })),
      notes: d.notes.map((t) => (t.scheme ? t : { ...t, scheme: NEW_NOTE_SCHEME })),
    })),
  }
}
```

Import `NEW_NODE_SCHEME` and `NEW_NOTE_SCHEME` from `./schemes`.

- [ ] **Step 5: Rename the field everywhere it flows**

- `webapp/src/buildGraph.ts` — the service node's `data` and the note's `data` pass `scheme: n.scheme` / `scheme: nt.scheme` instead of `color`.
- `webapp/src/App.tsx`, `nodesToDiagramParts` — the note branch writes `scheme: d.scheme`, the service branch writes `scheme: d.scheme || undefined`. Keep that asymmetry; it normalises an empty string on the service side, matching the `sub`/`icon`/`status` lines beside it.

- [ ] **Step 6: Run the back-fill when the model loads**

In `webapp/server/app-store.ts`, wrap the loaded model:

```ts
    load: async () => backfillSchemes(JSON.parse(await readFile(file, 'utf8'))),
```

importing `backfillSchemes` from `../src/model`. This is the one server change in the plan; it is a single call, not new logic.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/schemeMigration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: any test still referring to `Node.color` or `Note.color` will now fail to compile. Rename those references — they are the same field. If a test asserts on the *absence* of a colour, it is asserting behaviour this change deliberately removes: update it to assert the starting scheme instead, and say so in your report.

- [ ] **Step 9: Format and commit**

```bash
npx prettier --write src/model.ts src/buildGraph.ts src/App.tsx src/schemeMigration.test.ts server/app-store.ts
npm run format:check
cd .. && git add webapp/src/model.ts webapp/src/buildGraph.ts webapp/src/App.tsx webapp/src/schemeMigration.test.ts webapp/server/app-store.ts
git commit -m "feat(schemes): rename color -> scheme on nodes and notes, back-fill on load

The field no longer holds a colour, so the name would mislead. Nodes and notes
without one get the starting scheme when the model loads, written back on the
next save — after which absence does not occur.

The field stays optional in the type so data written before schemes existed
still loads. Group.color and Edge.color are unchanged: an edge's default comes
from its relationship type, and a group always had a colour."
```

---

### Task 3: Render from schemes

**Files:**
- Modify: `webapp/src/nodes.tsx` (`ServiceNode`, `NoteNode`)
- Modify: `webapp/src/index.css` (delete `.node--tinted` / `.note--tinted` blocks; drive the base rules from custom properties)
- Modify: `webapp/src/ServiceNode.test.tsx`, `webapp/src/NoteNode.test.tsx`

**Interfaces:**
- Consumes: `resolveScheme`, `secondaryText`, `accentFill`, `NEW_NODE_SCHEME`, `NEW_NOTE_SCHEME` from Task 1; `data.scheme` from Task 2.
- Produces: every node and note renders with `--scheme-bg`, `--scheme-border`, `--scheme-text`, `--scheme-text-2`, `--scheme-accent` set inline. No modifier class.

- [ ] **Step 1: Write the failing tests**

Replace the colour tests in `webapp/src/ServiceNode.test.tsx` — the ones asserting `node--tinted` and `--node-color` — with:

```tsx
  it('renders the starting scheme when the entity has that scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...({ id: 's1', data: { label: 'Plex', scheme: 'paper' }, selected: false } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.style.getPropertyValue('--scheme-bg')).toBe('#ffffff')
    expect(card.style.getPropertyValue('--scheme-border')).toBe('#cbd5e1')
    expect(card.style.getPropertyValue('--scheme-text')).toBe('#1f2937')
  })

  it('renders a named scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...({ id: 's1', data: { label: 'Plex', scheme: 'blue' }, selected: false } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    )
    expect((container.querySelector('.node') as HTMLElement).style.getPropertyValue('--scheme-bg')).toBe('#e2ecfe')
  })

  it('has no tinted/accented modifier class — every node renders one way', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...({ id: 's1', data: { label: 'Plex', scheme: 'blue' }, selected: false } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--tinted')).toBe(false)
    expect(card.classList.contains('node--accented')).toBe(false)
  })

  it('falls back to the starting scheme for an unknown value rather than rendering unstyled', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...({ id: 's1', data: { label: 'Plex', scheme: 'nonsense' }, selected: false } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    )
    expect((container.querySelector('.node') as HTMLElement).style.getPropertyValue('--scheme-bg')).toBe('#ffffff')
  })
```

Add the equivalent four to `webapp/src/NoteNode.test.tsx`, using `sticky` / `#fef9c3` and `NEW_NOTE_SCHEME` as the fallback. **Keep the four caret tests in that file unchanged** — they guard a real bug and are unrelated to colour.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ServiceNode.test.tsx src/NoteNode.test.tsx`
Expected: FAIL — no `--scheme-*` properties.

- [ ] **Step 3: Set the properties in the components**

In `webapp/src/nodes.tsx`, add the import:

```tsx
import { resolveScheme, secondaryText, accentFill, NEW_NODE_SCHEME, NEW_NOTE_SCHEME } from './schemes'
```

In `ServiceNode`, replace the className/style expression with:

```tsx
  const scheme = resolveScheme((d.scheme as string) ?? NEW_NODE_SCHEME, NEW_NODE_SCHEME)
  const schemeVars = {
    ['--scheme-bg']: scheme.background,
    ['--scheme-border']: scheme.border,
    ['--scheme-text']: scheme.text,
    ['--scheme-text-2']: secondaryText(scheme),
    ['--scheme-accent']: accentFill(scheme),
  } as CSSProperties
```

and render `<div className={`node ${selected ? 'selected' : ''}`} style={schemeVars}>`.

Do the same in `NoteNode` with `NEW_NOTE_SCHEME`, rendering `<div className="note" style={schemeVars}>`. Leave `NoteNode`'s `draft` / `editing` logic completely alone — it fixes a caret bug and is unrelated.

- [ ] **Step 4: Drive the CSS from the properties**

In `webapp/src/index.css`:

- `.node` — change `background: #ffffff` to `background: var(--scheme-bg)` and `border: 1.5px solid #cbd5e1` to `border: 1.5px solid var(--scheme-border)`.
- `.node__label`, `.node__field` — `color: var(--scheme-text)`.
- `.node__sub`, `.node__field-k` — `color: var(--scheme-text-2)`.
- `.node__icon--placeholder` — `background: var(--scheme-accent)`, `color: var(--scheme-text)`.
- `.node__note` — `background: var(--scheme-accent)`, `border-top-color: var(--scheme-border)`, `color: var(--scheme-text)`.
- `.note` — `background: var(--scheme-bg)`, `border: 1px solid var(--scheme-border)`.
- `.note textarea`, `.note__md`, `.note__placeholder` — `color: var(--scheme-text)`.
- `.note__md code`, `.note__md pre` — `background: var(--scheme-accent)`.
- `.note__md blockquote` — `border-left-color: var(--scheme-border)`.
- `.note__md th`, `.note__md td`, `.note__md hr` — border colours to `var(--scheme-border)`.

Then **delete every `.node--tinted` and `.note--tinted` rule block**, and the `.node--accented` block if any remains. There is no longer a coloured-versus-uncoloured distinction.

**Do not** touch `.node__status`, icon images, `.node.selected`, or `.node__flow-badge` — those are deliberately scheme-independent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/ServiceNode.test.tsx src/NoteNode.test.tsx`
Expected: PASS, including the four untouched caret tests.

- [ ] **Step 6: Confirm no modifier classes survive anywhere**

Run: `grep -rn "tinted\|accented" webapp/src/`
Expected: no output.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run && npm run typecheck && npx vite build
npx prettier --write src/nodes.tsx src/index.css src/ServiceNode.test.tsx src/NoteNode.test.tsx
npm run format:check
cd .. && git add webapp/src/nodes.tsx webapp/src/index.css webapp/src/ServiceNode.test.tsx webapp/src/NoteNode.test.tsx
git commit -m "feat(schemes): render nodes and notes from a resolved scheme

Every node and note now renders through one path with its scheme exposed as CSS
custom properties. The tinted/accented modifier classes are gone along with the
coloured-versus-uncoloured distinction they encoded.

The status dot, icon images, selection ring and flow badge remain
scheme-independent, as before."
```

---

### Task 4: Inspector and MCP

**Files:**
- Modify: `webapp/src/ColorPicker.tsx`
- Modify: `webapp/src/Inspector.tsx` (note and service-node panels)
- Modify: `webapp/server/mcp.ts`
- Test: `webapp/src/ColorPicker.test.tsx`, `webapp/src/Inspector.test.tsx`, `webapp/server/mcp.test.ts`

**Interfaces:**
- Consumes: `SCHEMES`, `resolveScheme` from Task 1; `Node.scheme` / `Note.scheme` from Task 2.
- Produces: the picker lists schemes by name; MCP tools take `scheme` instead of `color`.

- [ ] **Step 1: Write the failing tests**

In `webapp/src/ColorPicker.test.tsx`, replace the default-swatch tests with:

```tsx
  it('renders one swatch per scheme, with no separate default section', () => {
    const { container } = render(<ColorPicker {...props()} />)
    expect(container.querySelectorAll('.colorpick__swatches .swatch--scheme').length).toBe(
      Object.keys(SCHEMES).length,
    )
    expect(container.querySelector('.swatch--default')).toBeNull()
  })

  it('marks exactly the selected scheme active', () => {
    const { container } = render(<ColorPicker {...props({ value: 'blue' })} />)
    const active = container.querySelectorAll('.swatch--active')
    expect(active.length).toBe(1)
    expect(active[0].getAttribute('title')).toBe('blue')
  })
```

In `webapp/server/mcp.test.ts`, add:

```ts
    it('add_node accepts a scheme name and a custom hex, and rejects nonsense', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow', nodes: ['Plex'],
      })) as { diagramId: string }
      const named = handlers.addNode(store, { diagramId, label: 'A', scheme: 'blue' }) as { id: string }
      const hex = handlers.addNode(store, { diagramId, label: 'B', scheme: '#7c3aed' }) as { id: string }
      const d = getDiagram(store.getState().model, diagramId)!
      expect(d.nodes.find((n) => n.id === named.id)!.scheme).toBe('blue')
      expect(d.nodes.find((n) => n.id === hex.id)!.scheme).toBe('#7c3aed')
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ColorPicker.test.tsx server/mcp.test.ts`
Expected: FAIL — no `.swatch--scheme`, and `scheme` is not accepted by the tool schema.

- [ ] **Step 3: Rework the picker**

In `webapp/src/ColorPicker.tsx`, the Palette section iterates `Object.entries(SCHEMES)` rather than `PALETTE`. Each swatch renders with `className="swatch swatch--scheme"`, `title={name}`, `style={{ background: scheme.background, borderColor: scheme.border }}`, and calls `onChange(name)`. A swatch is active when `name === value`.

Delete the separate Default section, the `defaultSwatch` / `isDefault` / `onSelectDefault` props, and `swatch--default`. The starting schemes appear in the list as `paper` and `sticky` like any other entry — that is the whole point.

Keep "In this diagram" and the custom colour input. The custom input still calls `onChange` with a hex.

- [ ] **Step 4: Update the two Inspector panels**

The note and service-node panels pass `value={d.scheme ?? NEW_NOTE_SCHEME}` (or `NEW_NODE_SCHEME`) and `onChange={(v) => onNodeData({ scheme: v })}`, dropping the three removed props. **Leave the edge and group panels alone** — they still use colour and are out of scope.

- [ ] **Step 5: Update the MCP surface**

In `webapp/server/mcp.ts`, rename the `color` parameter to `scheme` on `add_node`, `edit_node`, `add_note` and `edit_note`, and replace `colorShape` for those four with:

```ts
// A scheme name or a custom 6-digit hex. Rejected at the boundary so a typo is
// refused rather than stored and silently falling back at render.
export const schemeShape = z
  .string()
  .refine((v) => v in SCHEMES || /^#[0-9a-fA-F]{6}$/.test(v), {
    message: 'scheme must be a known scheme name or a 6-digit hex like #3b82f6',
  })
  .optional()
```

importing `SCHEMES` from `../src/schemes`. Then set `scheme: schemeShape` in the `inputSchema` of `add_node` and `add_note`, and in the patch shape used by `edit_node` and `edit_note` — all four, or the validation exists but never runs. Rename the corresponding fields on the handler arg types and in the handler bodies that assign them.

**Leave `colorShape` in place** — `add_group` and `edit_group` still use it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/ColorPicker.test.tsx src/Inspector.test.tsx server/mcp.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run && npm run typecheck && npx vite build
npx prettier --write src/ColorPicker.tsx src/Inspector.tsx src/ColorPicker.test.tsx src/Inspector.test.tsx server/mcp.ts server/mcp.test.ts
npm run format:check
cd .. && git add webapp/src/ColorPicker.tsx webapp/src/Inspector.tsx webapp/src/ColorPicker.test.tsx webapp/src/Inspector.test.tsx webapp/server/mcp.ts webapp/server/mcp.test.ts
git commit -m "feat(schemes): pick schemes by name in the inspector and over MCP

The palette lists schemes; paper and sticky appear in it like any other entry,
so choosing the appearance an entity starts with is an ordinary selection. The
separate Default swatch and its three props are gone.

BREAKING: the node and note MCP tools take \`scheme\` instead of \`color\`, and
accept a scheme name or a custom hex. Groups and edges keep \`color\`."
```

---

### Task 5: Verify in the running app

**Files:** none modified. Verification only — no commits.

- [ ] **Step 1: Copy the real diagram data to a scratch directory**

This is the one verification where real data matters — the migration must leave 90 existing entities looking identical. Do NOT point the server at the repo or at `diagram.home`.

```bash
SCRATCH=$(mktemp -d)
curl -s http://diagram.home/api/model | python3 -c "import json,sys; json.dump(json.load(sys.stdin)['model'], open('$SCRATCH/model.json','w'), indent=2)"
python3 -c "import json; m=json.load(open('$SCRATCH/model.json')); print('diagrams', len(m['diagrams']))"
echo "$SCRATCH"
```

If `diagram.home` is unreachable, say so and stop — this task needs real data, and a synthetic model would not prove the migration.

- [ ] **Step 2: Capture how it looks BEFORE the change**

**`http://diagram.home` is the "before"** — it runs the previous release, on this exact data. Use it read-only rather than checking out old code locally; a `git checkout` of `webapp/src` risks leaving the tree dirty and proves nothing extra.

Open a populated diagram there and record, via `browser_evaluate`, the computed `backgroundColor`, `borderTopColor` and `.node__label` colour for the first five nodes and the first three notes. Note which entities by id, so the after-capture reads the same ones.

**Read only. Do not click anything that writes** — no colour changes, no drags, no Tidy.

- [ ] **Step 3: Capture how it looks AFTER, and compare**

Start the dev server on `$SCRATCH` and record the same values for the same entity ids.

```bash
DATA_DIR=$SCRATCH PORT=8186 API_TARGET=http://localhost:8186 npm run dev
```

Check the port is free first (`ss -ltn | grep 8186`); if taken pick another and set both variables.

**Every one must match the before-capture exactly.** This is the claim the whole task exists to check: the migration gives 90 entities an explicit scheme, and `paper`/`sticky` are supposed to reproduce their previous appearance byte-for-byte. Report the two tables side by side, and flag ANY difference however small.

- [ ] **Step 4: Check the picker**

- Every scheme appears as a swatch, including `paper` and `sticky`.
- Exactly one swatch is active for any entity.
- There is no separate Default section and no `reset` control.
- Selecting `paper` on a note makes it look like a white card; selecting `sticky` on a node makes it look like a sticky. Both should work — the shared list was chosen deliberately.

- [ ] **Step 5: Check persistence**

Change a node's scheme, reload, confirm it persisted. Then check `/api/model` and confirm the value is the scheme *name*, not a hex.

- [ ] **Step 6: Clean up**

```bash
rm -rf "$SCRATCH"
```

Confirm `git status --short` shows no modified tracked files.

- [ ] **Step 7: Commit nothing**

Any failure is fixed in the owning task (1-4), test first.

---

## Notes for the implementer

- **No scheme may be named `default`.** If you find yourself wanting one, the model has drifted — "default" is `NEW_NODE_SCHEME` / `NEW_NOTE_SCHEME` and nothing else.
- **`paper` and `sticky` must reproduce the old defaults exactly.** They are the migration's correctness condition for 90 entities. Task 1 pins them with equality assertions; Task 5 checks them in a browser.
- **Edges and groups are out of scope.** An edge's default comes from its relationship type; a group always had a colour. Leave `Edge.color`, `Group.color`, `colorShape`, and both Inspector panels alone.
- **Do not touch `NoteNode`'s `draft`/`editing` logic.** It fixes a caret bug and has nothing to do with colour. Its four tests must keep passing unchanged.
- **The status dot, icon images, selection ring and flow badge stay scheme-independent** — that is deliberate and documented in the CSS.
