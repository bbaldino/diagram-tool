# Configurable Entity Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a colour be set on notes and service nodes, from the Inspector and over MCP, and put every entity kind behind the same colour control.

**Architecture:** `Node` and `Note` gain an optional `color` hex. It flows model → canvas (`buildGraph`) → components (`nodes.tsx`, as a CSS custom property) and back (`nodesToDiagramParts`). Coordinated colours are derived in CSS with `color-mix`, which this codebase already uses for group tints. Absent colour means byte-identical appearance to today, enforced by applying derived styles only under a modifier class.

**Tech Stack:** React 18, TypeScript, Vite, vitest, `@testing-library/react` + jsdom, zod (MCP schemas), CSS `color-mix`.

## Global Constraints

- Prettier `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write <files>` before every commit; `npm run format:check` is a CI gate.
- All npm/vitest commands run from `webapp/`. Git commands from the repo root.
- Component tests need `// @vitest-environment jsdom` as the file's FIRST line. 349 existing tests run in the node environment and must stay there — no global vitest `environment` setting, no vitest config file.
- `npm run typecheck` and `npx vitest run` must both be clean before any commit.
- **Absent `color` must render exactly as today.** This is the compatibility promise for every existing note and node; it is tested explicitly in Tasks 2 and 3.
- Colour values are 6-digit hex strings matching `/^#[0-9a-fA-F]{6}$/`.
- Do not point a dev server at `webapp/` as its `DATA_DIR` — use a scratch directory.

---

### Task 1: Model field and canvas round-trip

**Files:**
- Modify: `webapp/src/model.ts` (the `Node` and `Note` interfaces, lines 29-54)
- Modify: `webapp/src/buildGraph.ts` (service node data ~line 57, note data ~line 76)
- Modify: `webapp/src/App.tsx` (`nodesToDiagramParts`, lines 90-147)
- Test: `webapp/src/buildGraph.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Node.color?: string` and `Note.color?: string` in the model; `data.color` on canvas nodes of type `service` and `note`, consumed by Task 2; `nodesToDiagramParts` writes `color` back for both kinds.

- [ ] **Step 1: Write the failing test**

Append to `webapp/src/buildGraph.test.ts`:

```ts
describe('color passthrough', () => {
  it('carries a note color onto the canvas node data', () => {
    const d = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      nodes: [], groups: [], edges: [], flows: [],
      notes: [
        { id: 'n1', text: 'x', color: '#3b82f6', position: { x: 0, y: 0 }, size: { width: 160, height: 90 } },
        { id: 'n2', text: 'y', position: { x: 0, y: 0 }, size: { width: 160, height: 90 } },
      ],
    }
    const g = buildDiagramGraph(d as never, [])
    expect((g.nodes.find((n) => n.id === 'n1')!.data as never as { color?: string }).color).toBe('#3b82f6')
    expect((g.nodes.find((n) => n.id === 'n2')!.data as never as { color?: string }).color).toBeUndefined()
  })

  it('carries a service node color onto the canvas node data', () => {
    const d = {
      id: 'd', name: 'D', title: 'D', type: 'canvas' as const,
      groups: [], notes: [], edges: [], flows: [],
      nodes: [
        { id: 's1', label: 'Plex', fields: [], color: '#10b981', position: { x: 0, y: 0 } },
        { id: 's2', label: 'Sonarr', fields: [], position: { x: 0, y: 0 } },
      ],
    }
    const g = buildDiagramGraph(d as never, [])
    expect((g.nodes.find((n) => n.id === 's1')!.data as never as { color?: string }).color).toBe('#10b981')
    expect((g.nodes.find((n) => n.id === 's2')!.data as never as { color?: string }).color).toBeUndefined()
  })
})
```

Check the top of the file for how `buildDiagramGraph` is imported and whether `describe` is already imported; reuse the existing imports rather than adding duplicates.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/buildGraph.test.ts`
Expected: FAIL — both `.color` reads are `undefined` because nothing passes it through.

- [ ] **Step 3: Add the model fields**

In `webapp/src/model.ts`, add one line to each interface. `Node` (after `note?: string`):

```ts
  color?: string // per-entity accent colour (hex); absent = default styling
```

`Note` (after `text: string`):

```ts
  color?: string // sticky colour (hex); absent = default yellow
```

- [ ] **Step 4: Pass it through buildGraph**

In `webapp/src/buildGraph.ts`, add `color: n.color,` to the service node's `data` object (alongside `status`), and change the note's data from `data: { text: nt.text }` to:

```ts
      data: { text: nt.text, color: nt.color },
```

- [ ] **Step 5: Write it back in nodesToDiagramParts**

In `webapp/src/App.tsx`, in the `note` branch add `color: d.color,` after `text: d.text ?? '',`. In the `service` branch add `color: d.color || undefined,` after `note: (d.note as string) || undefined,`.

The `|| undefined` on the service branch matters: it normalises an empty string to absent, matching how `sub`/`icon`/`status` are handled two lines above.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/buildGraph.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass, typecheck silent.

- [ ] **Step 8: Format and commit**

```bash
npx prettier --write src/model.ts src/buildGraph.ts src/App.tsx src/buildGraph.test.ts
npm run format:check
cd .. && git add webapp/src/model.ts webapp/src/buildGraph.ts webapp/src/App.tsx webapp/src/buildGraph.test.ts
git commit -m "feat(color): add optional color to Node and Note and plumb it through the canvas

Model -> buildGraph -> canvas node data -> nodesToDiagramParts and back.
Absent color stays absent; nothing renders differently yet."
```

---

### Task 2: Render note fill and node accent

**Files:**
- Modify: `webapp/src/nodes.tsx` (`ServiceNode` ~line 42, `NoteNode` ~line 97)
- Modify: `webapp/src/index.css` (the `.note` block ~line 148, the `.note__md` block added after it, and the `.node` block ~line 37)
- Test: `webapp/src/NoteNode.test.tsx`, `webapp/src/ServiceNode.test.tsx` (create)

**Interfaces:**
- Consumes: `data.color` on canvas nodes from Task 1.
- Produces: a note with colour renders `.note.note--tinted` with inline `--note-color`; a service node with colour renders `.node.node--accented` with inline `--node-color`. Task 5 verifies these in-app.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/src/NoteNode.test.tsx`:

```tsx
describe('NoteNode colour', () => {
  const coloured = (text: string, color?: string): NodeProps =>
    ({ id: 'n1', data: { text, color }, selected: false }) as unknown as NodeProps

  it('applies the tint modifier and custom property when a colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi', '#3b82f6')} />
      </ReactFlowProvider>,
    )
    const note = container.querySelector('.note') as HTMLElement
    expect(note.classList.contains('note--tinted')).toBe(true)
    expect(note.style.getPropertyValue('--note-color')).toBe('#3b82f6')
  })

  it('renders exactly as before when no colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi')} />
      </ReactFlowProvider>,
    )
    const note = container.querySelector('.note') as HTMLElement
    expect(note.classList.contains('note--tinted')).toBe(false)
    expect(note.style.getPropertyValue('--note-color')).toBe('')
  })
})
```

Create `webapp/src/ServiceNode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { ServiceNode } from './nodes'

afterEach(cleanup)

const props = (color?: string): NodeProps =>
  ({ id: 's1', data: { label: 'Plex', color }, selected: false }) as unknown as NodeProps

describe('ServiceNode colour', () => {
  it('applies the accent modifier and custom property when a colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props('#10b981')} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--accented')).toBe(true)
    expect(card.style.getPropertyValue('--node-color')).toBe('#10b981')
  })

  it('renders exactly as before when no colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props()} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--accented')).toBe(false)
    expect(card.style.getPropertyValue('--node-color')).toBe('')
  })

  it('keeps the label visible when accented', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props('#10b981')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.node__label')?.textContent).toBe('Plex')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/NoteNode.test.tsx src/ServiceNode.test.tsx`
Expected: FAIL — no `note--tinted` / `node--accented` class and no custom property.

- [ ] **Step 3: Set the class and custom property in the components**

In `webapp/src/nodes.tsx`, `NoteNode`: replace `<div className="note">` with

```tsx
    <div
      className={`note${d.color ? ' note--tinted' : ''}`}
      style={d.color ? ({ ['--note-color' as string]: d.color } as React.CSSProperties) : undefined}
    >
```

In `ServiceNode`: replace `<div className={`node ${selected ? 'selected' : ''}`}>` with

```tsx
    <div
      className={`node ${selected ? 'selected' : ''}${d.color ? ' node--accented' : ''}`}
      style={d.color ? ({ ['--node-color' as string]: d.color } as React.CSSProperties) : undefined}
    >
```

`React` is not currently imported in `nodes.tsx`; use `import { type CSSProperties } from 'react'` added to the existing react import and write `as CSSProperties` instead of `React.CSSProperties`.

- [ ] **Step 4: Add the derived styles**

In `webapp/src/index.css`, add after the existing `.note textarea { … }` rule (before the `.note__md` block):

```css
/* Tinted note. Applied ONLY when a colour is set, so an uncoloured note keeps
   the literal defaults above byte-for-byte. Derivations mirror the existing
   --group-color approach. */
.note--tinted {
  background: color-mix(in srgb, var(--note-color) 15%, white);
  border-color: color-mix(in srgb, var(--note-color) 45%, white);
}
.note--tinted textarea,
.note--tinted .note__md,
.note--tinted .note__placeholder {
  color: color-mix(in srgb, var(--note-color) 70%, black);
}
.note--tinted .note__md code,
.note--tinted .note__md pre {
  background: color-mix(in srgb, var(--note-color) 18%, transparent);
}
.note--tinted .note__md blockquote {
  border-left-color: color-mix(in srgb, var(--note-color) 40%, transparent);
}
.note--tinted .note__md th,
.note--tinted .note__md td {
  border-color: color-mix(in srgb, var(--note-color) 35%, transparent);
}
.note--tinted .note__md hr {
  border-top-color: color-mix(in srgb, var(--note-color) 35%, transparent);
}
```

Then add after the `.node.selected { … }` rule:

```css
/* Accent bar for a coloured service node. The card stays white — its icon,
   status dot and field text all rely on contrast against white. */
.node--accented::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 12px 0 0 12px;
  background: var(--node-color);
}
```

`.node` already has `position: relative` (index.css:2212), so the pseudo-element anchors correctly with no structural change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/NoteNode.test.tsx src/ServiceNode.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify nothing else broke and the CSS parses**

Run: `npx vitest run && npm run typecheck && npx vite build`
Expected: all pass; build succeeds with no CSS warnings.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write src/nodes.tsx src/index.css src/NoteNode.test.tsx src/ServiceNode.test.tsx
npm run format:check
cd .. && git add webapp/src/nodes.tsx webapp/src/index.css webapp/src/NoteNode.test.tsx webapp/src/ServiceNode.test.tsx
git commit -m "feat(color): render tinted notes and accented service nodes

A note takes a full fill with background, border and text derived from the
chosen colour, including the markdown code/table/rule accents so a coloured
note stays internally consistent. A service node takes a left accent bar only,
keeping its white card so the icon, status dot and field text keep contrast.

Derived styles apply only under a modifier class, so an uncoloured note or node
renders byte-identically to before."
```

---

### Task 3: Inspector colour control for note, node and group

**Files:**
- Modify: `webapp/src/Inspector.tsx` (note panel ~line 188, service-node panel ~line 212, group panel ~line 136)
- Test: `webapp/src/Inspector.test.tsx` (create)

**Interfaces:**
- Consumes: `data.color` from Task 1; the existing `ColorPicker` from `./ColorPicker`, whose props are `{ value: string, overridden: boolean, defaultLabel: string, diagramColors: string[], onChange: (hex: string) => void, onReset: () => void }`.
- Produces: no new exports. All three panels write colour via the existing `onNodeData` prop.

- [ ] **Step 1: Write the failing test**

Create `webapp/src/Inspector.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'

afterEach(cleanup)

const baseProps = {
  edge: null,
  groups: [],
  onNodeParent: () => {},
  onEdge: () => {},
  diagramColors: [],
  onShrink: () => {},
  onGroupSize: () => {},
  onDelete: () => {},
  fields: [],
  onFieldShow: () => {},
}

const noteNode = (color?: string) =>
  ({ id: 'n1', type: 'note', data: { text: 'hi', color } }) as never
const serviceNode = (color?: string) =>
  ({ id: 's1', type: 'service', data: { label: 'Plex', color } }) as never

describe('Inspector colour', () => {
  it('offers a colour picker for a note and writes the chosen hex', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={onNodeData} />,
    )
    const swatch = container.querySelector('.colorpick .swatch') as HTMLElement
    expect(swatch).not.toBeNull()
    await user.click(swatch)
    expect(onNodeData).toHaveBeenCalledWith({ color: expect.stringMatching(/^#[0-9a-f]{6}$/i) })
  })

  it('offers a colour picker for a service node', () => {
    const { container } = render(
      <Inspector {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.colorpick')).not.toBeNull()
  })

  it('clears the colour when reset is used on a coloured note', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    render(<Inspector {...baseProps} node={noteNode('#3b82f6')} onNodeData={onNodeData} />)
    await user.click(screen.getByRole('button', { name: 'reset' }))
    expect(onNodeData).toHaveBeenCalledWith({ color: undefined })
  })

  it('uses the shared picker for groups instead of a raw colour input', () => {
    const group = { id: 'g1', type: 'group', data: { label: 'Media', color: '#64748b' } } as never
    const { container } = render(
      <Inspector {...baseProps} node={group} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.colorpick')).not.toBeNull()
    expect(container.querySelector('input[type="color"].insp__rawcolor')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/Inspector.test.tsx`
Expected: FAIL — no `.colorpick` in the note or service panels.

- [ ] **Step 3: Add the colour field to the note panel**

In `webapp/src/Inspector.tsx`, inside the `node.type === 'note'` branch, add after the `insp__hint` div and before the `Group` field:

```tsx
        <Field label="Color">
          <ColorPicker
            value={(d.color as string) ?? '#eab308'}
            overridden={typeof d.color === 'string'}
            defaultLabel="default"
            diagramColors={diagramColors}
            onChange={(hex) => onNodeData({ color: hex })}
            onReset={() => onNodeData({ color: undefined })}
          />
        </Field>
```

The note branch does not currently destructure `d`; add `const d = node.data as any` at the top of that branch if it is not already present, matching how the group and service branches do it.

- [ ] **Step 4: Add the colour field to the service-node panel**

In the service-node branch, add the same `Field` block, with `'#64748b'` as the fallback `value` instead of `'#eab308'`:

```tsx
        <Field label="Color">
          <ColorPicker
            value={(d.color as string) ?? '#64748b'}
            overridden={typeof d.color === 'string'}
            defaultLabel="default"
            diagramColors={diagramColors}
            onChange={(hex) => onNodeData({ color: hex })}
            onReset={() => onNodeData({ color: undefined })}
          />
        </Field>
```

- [ ] **Step 5: Swap the group panel onto the shared picker**

Replace the group panel's existing colour `Field` — the one containing `<input type="color" value={d.color ?? '#64748b'} … />` — with:

```tsx
        <Field label="Color">
          <ColorPicker
            value={d.color ?? '#64748b'}
            overridden={typeof d.color === 'string'}
            defaultLabel="default"
            diagramColors={diagramColors}
            onChange={(hex) => onNodeData({ color: hex })}
            onReset={() => onNodeData({ color: '#64748b' })}
          />
        </Field>
```

Note the group's reset writes the default hex rather than `undefined`: `Group.color` is a **required** field in the model, unlike the optional colour on notes and nodes. Clearing it to `undefined` would produce an invalid group.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/Inspector.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass, typecheck silent.

- [ ] **Step 8: Format and commit**

```bash
npx prettier --write src/Inspector.tsx src/Inspector.test.tsx
npm run format:check
cd .. && git add webapp/src/Inspector.tsx webapp/src/Inspector.test.tsx
git commit -m "feat(color): colour picker in the note, node and group inspectors

Notes and service nodes gain a Color field using the existing ColorPicker,
with reset clearing back to the default. The group panel swaps its raw
<input type=color> for the same component, so all four entity kinds now share
one control. Group reset writes the default hex rather than undefined, since
Group.color is required in the model."
```

---

### Task 4: Colour over MCP

**Files:**
- Modify: `webapp/server/mcp.ts` (`AddNodeArgs` ~line 39, `EditNodeArgs` ~line 91, `addNode` ~line 282, `editNode` ~line 428, `addNote` ~line 339, `editNote` ~line 365, and the four `registerTool` schemas)
- Test: `webapp/server/mcp.test.ts`

**Interfaces:**
- Consumes: `Node.color` / `Note.color` from Task 1.
- Produces: optional `color` on the `add_node`, `edit_node`, `add_note`, `edit_note` tools.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('writes', …)` block in `webapp/server/mcp.test.ts`:

```ts
    it('add_note stores a colour when given one', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as { diagramId: string }
      const { id } = handlers.addNote(store, {
        diagramId,
        text: 'x',
        color: '#3b82f6',
      }) as { id: string }
      const note = getDiagram(store.getState().model, diagramId)!.notes.find((n) => n.id === id)!
      expect(note.color).toBe('#3b82f6')
    })

    it('add_note leaves colour absent when not given one', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as { diagramId: string }
      const { id } = handlers.addNote(store, { diagramId, text: 'x' }) as { id: string }
      const note = getDiagram(store.getState().model, diagramId)!.notes.find((n) => n.id === id)!
      expect(note.color).toBeUndefined()
    })

    it('edit_note sets a colour, and omitting it leaves the existing one', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as { diagramId: string }
      const { id } = handlers.addNote(store, { diagramId, text: 'x' }) as { id: string }
      handlers.editNote(store, { diagramId, id, patch: { color: '#10b981' } })
      const read = () =>
        getDiagram(store.getState().model, diagramId)!.notes.find((n) => n.id === id)!
      expect(read().color).toBe('#10b981')
      handlers.editNote(store, { diagramId, id, patch: { text: 'changed' } })
      expect(read().color).toBe('#10b981')
      expect(read().text).toBe('changed')
    })

    it('add_node and edit_node carry colour the same way', async () => {
      const store = await mkStore()
      const { diagramId } = (await handlers.authorDiagram(store, {
        name: 'Flow',
        nodes: ['Plex'],
      })) as { diagramId: string }
      const { id } = handlers.addNode(store, {
        diagramId,
        label: 'Sonarr',
        color: '#ec4899',
      }) as { id: string }
      const read = () =>
        getDiagram(store.getState().model, diagramId)!.nodes.find((n) => n.id === id)!
      expect(read().color).toBe('#ec4899')
      handlers.editNode(store, { diagramId, id, patch: { label: 'Renamed' } })
      expect(read().color).toBe('#ec4899')
    })
```

And a schema test, appended to the existing schema/tool describe block near the bottom of the file (search for `edgeAttrsShape` to find it):

```ts
  it('rejects a malformed colour at the tool schema', () => {
    const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
    expect(hex.safeParse('#3b82f6').success).toBe(true)
    expect(hex.safeParse('blue').success).toBe(false)
    expect(hex.safeParse('#3b82f').success).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/mcp.test.ts -t "colour"`
Expected: FAIL — colour is not stored (reads are `undefined`).

- [ ] **Step 3: Add colour to the handler arg types and bodies**

In `webapp/server/mcp.ts`:

- Add `color?: string` to `AddNodeArgs`.
- Add `color?: string` to the `patch` type inside `EditNodeArgs`.
- Add `color?: string` to `AddNoteArgs` and to `EditNoteArgs`'s patch type. (Search for `AddNoteArgs` / `EditNoteArgs` — they are declared near the other arg interfaces.)

In `addNote`, add the assignment **immediately after the `const note: Note = { … }` literal and before the `if (a.parentId)` block**:

```ts
    if (a.color !== undefined) note.color = a.color
```

Placement matters: the `if (a.parentId)` branch applies its op and **returns early**, so an assignment made after that block would be skipped for any note created inside a group.

In `addNode`, add the same line alongside the existing optional-field assignments — after `if (a.status !== undefined) node.status = a.status` and before the `if (a.parentId)` block, which returns early for the same reason:

```ts
    if (a.color !== undefined) node.color = a.color
```

`editNote` and `editNode` need **no code change**. Both destructure `parentId` out and spread the remainder (`const patch = { ...rest }`), so `color` flows through untouched — verified by reading both. Adding explicit handling there would be redundant.

- [ ] **Step 4: Add colour to the four tool schemas**

Define once, near `edgeAttrsShape`:

```ts
// A 6-digit hex colour. Validated at the schema so a malformed value is
// rejected rather than stored and rendered as a broken CSS custom property.
const colorShape = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex like #3b82f6')
  .optional()
```

Add `color: colorShape,` to the `inputSchema` of `add_note` and `add_node`, and to the patch shape of `edit_note` and `edit_node`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/mcp.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass, typecheck silent.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write server/mcp.ts server/mcp.test.ts
npm run format:check
cd .. && git add webapp/server/mcp.ts webapp/server/mcp.test.ts
git commit -m "feat(color): accept an optional colour on the note and node MCP tools

add_note, edit_note, add_node and edit_node take an optional 6-digit hex,
validated at the schema so a malformed value is rejected rather than stored.
Omitting colour in an edit patch leaves the existing value untouched."
```

---

### Task 5: Verify in the running app

**Files:** none modified. Verification only — no commits.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Seed a scratch data directory**

Never point the dev server at `webapp/`. From `webapp/`:

```bash
SCRATCH=$(mktemp -d)
python3 - "$SCRATCH/model.json" <<'EOF'
import json, sys
json.dump({"version": 2, "templates": [], "diagrams": [{
  "id": "d-color", "name": "Color", "title": "Color", "type": "canvas",
  "groups": [], "edges": [], "flows": [],
  "nodes": [
    {"id": "s1", "label": "Plex", "fields": [], "color": "#10b981", "position": {"x": 40, "y": 300}},
    {"id": "s2", "label": "Sonarr", "fields": [], "position": {"x": 260, "y": 300}}
  ],
  "notes": [
    {"id": "n1", "text": "## Coloured\n\n- one\n- two\n\n`code` and [link](http://example.com)",
     "color": "#3b82f6", "position": {"x": 40, "y": 40}, "size": {"width": 260, "height": 180}},
    {"id": "n2", "text": "## Default\n\n- one\n- two\n\n`code` here",
     "position": {"x": 340, "y": 40}, "size": {"width": 260, "height": 180}}
  ]}]}, open(sys.argv[1], "w"), indent=2)
EOF
echo "$SCRATCH"
```

- [ ] **Step 2: Start the dev server**

Check the port is free first (`ss -ltn | grep 8183`); other services on this machine occupy various ports. If taken, pick another and set both variables to it.

```bash
DATA_DIR=$SCRATCH PORT=8183 API_TARGET=http://localhost:8183 npm run dev
```

Note the Vite URL it prints — it may not be 5173.

- [ ] **Step 3: Open the diagram**

In the browser console, then reload:

```js
localStorage.setItem('homelab-open-tabs', JSON.stringify(['d-color']))
localStorage.setItem('homelab-active-diagram', 'd-color')
```

- [ ] **Step 4: Check rendering**

Confirm by DOM assertion, not by eye:

- `n1` has class `note--tinted`, is visibly blue, and its heading/list/code are legible against the tint.
- `n2` has NO `note--tinted` class and looks exactly like a note did before this change (yellow).
- `s1` has class `node--accented` with a green left bar, and its label, icon placeholder and card background are unchanged white.
- `s2` has NO `node--accented` class.

- [ ] **Step 5: Check the Inspector round-trip**

- Click `n2`, pick a colour from the palette. The note tints immediately.
- Click away, then reload the page. The colour persisted.
- Select it again and press `reset`. It returns to yellow, and after a reload it is still yellow (colour was cleared, not set to a default hex).
- Repeat the pick-and-reset on `s2` and confirm the accent bar appears and disappears.
- Select a group and confirm its colour control is now the swatch picker, and that changing it still works.

- [ ] **Step 6: Check contrast on a pale colour**

Set `n2` to the palette's lightest colour (amber `#f59e0b`). Confirm the body text is still readable — this is the derivation the spec flags as the risk. If it is not readable, that is a finding against Task 2's derivation ratios, not something to fix here.

- [ ] **Step 7: Stop the server and clean up**

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 8: Commit nothing**

This task produces no code. Any failure is fixed in the owning task (1-4), test first.

---

## Notes for the implementer

- **`color-mix` is already used in this codebase** (`index.css:285`, the group tint). It is not a new dependency and needs no fallback beyond the modifier-class approach already specified.
- **The compatibility promise is load-bearing.** "Absent colour renders exactly as today" is why derived styles live under `.note--tinted` / `.node--accented` rather than being applied with `var(--x, default)` fallbacks. Do not refactor them into unconditional rules with fallbacks — that would change the default rendering subtly and silently.
- **`Group.color` is required; `Node.color` and `Note.color` are optional.** That asymmetry is deliberate and is why the group panel's reset writes a hex while the others write `undefined`.
- **Do not touch `Edge` colour.** It already works and is out of scope.
