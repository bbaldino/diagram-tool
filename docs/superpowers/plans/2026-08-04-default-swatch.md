# Default Colour Swatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put each entity's default appearance in the colour picker as a selectable swatch, and make clearing a colour actually persist.

**Architecture:** A `null` in an update patch becomes a wire-level "delete this key" signal. `diffById` emits it for a key that was present and is now absent; a `mergePatch` helper deletes such keys instead of merging them. `applyOps` is shared with the server, so both sides get it. On top of that, `ColorPicker` gains a Default swatch and loses the now-redundant `overridden` / `defaultLabel` / `onReset` props.

**Tech Stack:** React 18, TypeScript, Vite, vitest, `@testing-library/react` + jsdom.

## Global Constraints

- Prettier `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write <files>` before every commit; `npm run format:check` is a CI gate.
- All npm/vitest commands run from `webapp/`. Git commands from the repo root.
- Component tests need `// @vitest-environment jsdom` as the file's FIRST line. Pure logic tests must NOT have one. No global vitest `environment` setting, no vitest config file.
- `npm run typecheck` and `npx vitest run` must both be clean before any commit. The suite currently has **426** passing tests.
- **`null` never reaches the model.** It is a wire-level signal consumed when a patch is applied. `Node.color` and `Note.color` stay `string | undefined`; no model type gains `| null`.
- `Group.color` is **required**. Its Default swatch writes `#64748b` rather than clearing. Do not make it optional.
- Do not touch `webapp/server/` — `applyOps` is shared, so the server inherits the fix with no change of its own.

---

### Task 1: Make a cleared field persist

**Files:**
- Modify: `webapp/src/model.ts` (add `mergePatch`; use it in `updateNode`, `updateNote`, `updateEdge`)
- Modify: `webapp/src/diff.ts` (`diffById`, lines 25-35)
- Test: `webapp/src/diff.test.ts` (existing)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function mergePatch<T extends object>(entity: T, patch: Record<string, unknown>): T` in `model.ts` — merges non-`null` keys and **deletes** keys whose value is `null`. `diffById` emits `null` for a key present on `prev` and absent on `next`. Tasks 2-3 rely on a clear surviving the round trip.

- [ ] **Step 1: Write the failing test**

Append to `webapp/src/diff.test.ts`. Check the file's existing imports first and reuse them rather than duplicating:

```ts
describe('clearing an optional field', () => {
  const model = (color?: string) =>
    ({
      version: 2,
      templates: [],
      diagrams: [
        {
          id: 'd', name: 'D', title: 'D', type: 'canvas',
          groups: [], notes: [], edges: [], flows: [],
          nodes: [{ id: 'n1', label: 'Plex', fields: [], position: { x: 0, y: 0 }, ...(color ? { color } : {}) }],
        },
      ],
    }) as never

  it('emits null for a field that was present and is now absent', () => {
    const ops = diffToOps(model('#3b82f6'), model())
    const patch = (ops[0] as never as { patch: Record<string, unknown> }).patch
    expect(patch.color).toBeNull()
  })

  it('survives JSON serialisation, which undefined does not', () => {
    const ops = diffToOps(model('#3b82f6'), model())
    const wire = JSON.parse(JSON.stringify(ops))
    expect((wire[0] as { patch: Record<string, unknown> }).patch).toHaveProperty('color', null)
  })

  it('round-trips to a genuinely absent field, not null and not the old value', () => {
    const before = model('#3b82f6')
    const ops = JSON.parse(JSON.stringify(diffToOps(before, model())))
    const after = applyOps(before, ops) as never as {
      diagrams: { nodes: { color?: string | null }[] }[]
    }
    const node = after.diagrams[0].nodes[0]
    expect('color' in node).toBe(false)
    expect(node.color).toBeUndefined()
  })

  it('leaves an existing colour untouched when the patch does not mention it', () => {
    const before = model('#3b82f6')
    const renamed = JSON.parse(JSON.stringify(before))
    renamed.diagrams[0].nodes[0].label = 'Renamed'
    const ops = JSON.parse(JSON.stringify(diffToOps(before, renamed)))
    const after = applyOps(before, ops) as never as {
      diagrams: { nodes: { label: string; color?: string }[] }[]
    }
    expect(after.diagrams[0].nodes[0].color).toBe('#3b82f6')
    expect(after.diagrams[0].nodes[0].label).toBe('Renamed')
  })
})
```

`applyOps` comes from `./ops`; add it to the imports if the file does not already have it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/diff.test.ts`
Expected: the first three FAIL — `patch.color` is `undefined`, not `null`, because the key is dropped. The fourth should already PASS; it is the regression guard.

- [ ] **Step 3: Add the merge helper**

In `webapp/src/model.ts`, near the other shared helpers:

```ts
// Apply an update patch. A `null` value means "remove this key" — the wire-level
// signal for clearing an optional field, since JSON.stringify drops `undefined`
// and a plain spread cannot express a deletion. `null` is consumed here and
// never stored: model types keep `string | undefined`, not `| null`.
export function mergePatch<T extends object>(entity: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...entity }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out as T
}
```

- [ ] **Step 4: Use it in the three mutators with optional fields**

In `updateNode`, `updateNote` and `updateEdge`, replace the object spread that applies the patch — the `{ ...n, ...patch, id: n.id }` shape — with:

```ts
        n.id === id ? { ...mergePatch(n, patch as Record<string, unknown>), id: n.id } : n
```

Keep the `id: n.id` restoration exactly as it is: it prevents a patch from rewriting an entity's identity. Leave `updateGroup`, `updateFlow` and `updateTemplate` alone — their fields are required, so they have nothing to clear.

- [ ] **Step 5: Emit null from the diff**

In `webapp/src/diff.ts`, inside `diffById`, replace the patch construction:

```ts
      if (changed(before, item)) {
        const { id, ...rest } = item as T & { id: string }
        const patch = rest as Record<string, unknown>
        // A key that `before` had and the patch no longer carries a value for is
        // a deliberate clear. Emit null so it survives JSON; `undefined` would be
        // dropped and the old value would silently persist.
        //
        // The test is `patch[key] === undefined`, NOT `!(key in patch)`. Callers
        // routinely build entities with explicit-undefined keys — e.g.
        // nodesToDiagramParts writes `color: d.color`, so an uncoloured note has
        // the key present with value undefined. `'color' in patch` is TRUE there,
        // so an `in` check would skip exactly the case this exists to handle.
        for (const key of Object.keys(before as object)) {
          if (key !== 'id' && patch[key] === undefined) patch[key] = null
        }
        ops.push(updateOp(id, patch as Partial<Omit<T, 'id'>>))
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/diff.test.ts`
Expected: PASS, all four.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

`webapp/src/diff.test.ts` contains three assertions on **exact** patch contents (search `patch: {`). A `null` only appears for a key that `before` had and the new patch has no value for, so a test where no key disappears is unaffected — the three existing ones look like that, but confirm rather than assume.

If one does fail, read it before editing: if it was asserting the old silently-drop-the-key behaviour, updating it is correct and belongs in your report. If it is asserting something else, you have a real regression — do not paper over it by loosening the assertion to `objectContaining`.

- [ ] **Step 8: Format and commit**

```bash
npx prettier --write src/model.ts src/diff.ts src/diff.test.ts
npm run format:check
cd .. && git add webapp/src/model.ts webapp/src/diff.ts webapp/src/diff.test.ts
git commit -m "fix(ops): let a cleared optional field persist

diffById built update patches from the whole item, so a cleared field arrived
as \`color: undefined\` and JSON.stringify dropped it before the op reached the
server; the spread-merge then kept the old value. Clearing has never worked.

A key present before and absent now is emitted as null, and mergePatch deletes
null keys rather than merging them. null is consumed on apply and never stored.
applyOps is shared with the server, so both sides are fixed."
```

---

### Task 2: Default swatch in ColorPicker

**Files:**
- Modify: `webapp/src/ColorPicker.tsx` (the `Props` interface lines 5-12, and the render)
- Test: `webapp/src/ColorPicker.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1 directly.
- Produces: `ColorPicker` props become
  `{ value: string, diagramColors: string[], onChange: (hex: string) => void, defaultSwatch: { background: string; border: string }, isDefault: boolean, onSelectDefault: () => void }`.
  `overridden`, `defaultLabel` and `onReset` are **removed**. Task 3 updates all four call sites.

- [ ] **Step 1: Write the failing test**

Create `webapp/src/ColorPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPicker } from './ColorPicker'

afterEach(cleanup)

const props = (over: Partial<React.ComponentProps<typeof ColorPicker>> = {}) => ({
  value: '#3b82f6',
  diagramColors: [],
  onChange: () => {},
  defaultSwatch: { background: '#ffffff', border: '#cbd5e1' },
  isDefault: false,
  onSelectDefault: () => {},
  ...over,
})

describe('ColorPicker default swatch', () => {
  it('renders a default swatch showing the entity default appearance', () => {
    const { container } = render(<ColorPicker {...props()} />)
    const sw = container.querySelector('.swatch--default') as HTMLElement
    expect(sw).not.toBeNull()
    expect(sw.style.background).toBe('rgb(255, 255, 255)')
    expect(sw.style.borderColor).toBe('rgb(203, 213, 225)')
  })

  it('marks the default swatch active when the entity has no colour', () => {
    const { container } = render(<ColorPicker {...props({ isDefault: true })} />)
    expect(container.querySelector('.swatch--default')?.className).toContain('swatch--active')
  })

  it('does not mark it active when the entity has a colour', () => {
    const { container } = render(<ColorPicker {...props({ isDefault: false })} />)
    expect(container.querySelector('.swatch--default')?.className).not.toContain('swatch--active')
  })

  it('calls onSelectDefault when clicked, not onChange', async () => {
    const user = userEvent.setup()
    const onSelectDefault = vi.fn()
    const onChange = vi.fn()
    const { container } = render(<ColorPicker {...props({ onSelectDefault, onChange })} />)
    await user.click(container.querySelector('.swatch--default') as HTMLElement)
    expect(onSelectDefault).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('no longer renders a reset control', () => {
    const { container } = render(<ColorPicker {...props()} />)
    const reset = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'reset',
    )
    expect(reset).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ColorPicker.test.tsx`
Expected: FAIL — no `.swatch--default`, and TypeScript will object to the new props.

- [ ] **Step 3: Change the props and render the swatch**

In `webapp/src/ColorPicker.tsx`, replace the `Props` interface with:

```ts
interface Props {
  value: string // current effective color (hex)
  diagramColors: string[] // distinct colors already present in the diagram
  onChange: (hex: string) => void
  // How this entity kind looks with no colour set, drawn on the Default swatch.
  defaultSwatch: { background: string; border: string }
  isDefault: boolean // true when the entity has no colour of its own
  onSelectDefault: () => void
}
```

Update the destructuring accordingly, dropping `overridden`, `defaultLabel` and `onReset`. Add a Default section as the FIRST section inside `.colorpick`:

```tsx
      <div className="colorpick__section">
        <div className="colorpick__label">Default</div>
        <div className="colorpick__swatches">
          <button
            type="button"
            className={`swatch swatch--default${isDefault ? ' swatch--active' : ''}`}
            style={{ background: defaultSwatch.background, borderColor: defaultSwatch.border }}
            title="Default"
            onClick={onSelectDefault}
          />
        </div>
      </div>
```

Then delete the `.colorpick__custom` block's hint span and reset button, keeping the native colour input:

```tsx
      <div className="colorpick__custom">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="Custom color"
        />
      </div>
```

- [ ] **Step 4: Give the default swatch a visible border**

In `webapp/src/index.css`, after the existing `.swatch` rule, add:

```css
/* The Default swatch draws the entity's own default appearance, so it needs a
   real border rather than the palette swatches' uniform one — a white node
   default would otherwise be invisible against the picker. */
.swatch--default {
  border-style: solid;
  border-width: 2px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ColorPicker.test.tsx`
Expected: PASS, 5 tests. Other suites will fail to typecheck at this point because the call sites still pass removed props — that is expected and Task 3 fixes it.

- [ ] **Step 6: Format and commit**

Do NOT run the full suite here; it cannot pass until Task 3 updates the call sites.

```bash
npx prettier --write src/ColorPicker.tsx src/ColorPicker.test.tsx src/index.css
npm run format:check
cd .. && git add webapp/src/ColorPicker.tsx webapp/src/ColorPicker.test.tsx webapp/src/index.css
git commit -m "feat(color): add a Default swatch to ColorPicker

Shows the entity's own default appearance as a selectable swatch, active when
the entity has no colour. Removes overridden/defaultLabel/onReset: the swatch
shows that state directly, so the hint text and the separate reset control are
redundant. Call sites are updated in the next commit."
```

---

### Task 3: Wire Default per entity kind

**Files:**
- Modify: `webapp/src/Inspector.tsx` (edge panel ~line 88, group ~line 136, note ~line 201, service node ~line 253)
- Test: `webapp/src/Inspector.test.tsx` (existing)

**Interfaces:**
- Consumes: the `ColorPicker` props from Task 2; the persisting clear from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/src/Inspector.test.tsx`, reusing its existing `baseProps` / `noteNode` / `serviceNode` helpers:

```tsx
describe('Inspector default swatch', () => {
  const defaultSwatchOf = (c: HTMLElement) => c.querySelector('.swatch--default') as HTMLElement

  it('shows Default active for an uncoloured note and clears when clicked', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={onNodeData} />,
    )
    expect(defaultSwatchOf(container).className).toContain('swatch--active')
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: undefined })
  })

  it('shows Default inactive for a coloured note', () => {
    const { container } = render(
      <Inspector {...baseProps} node={noteNode('#3b82f6')} onNodeData={() => {}} />,
    )
    expect(defaultSwatchOf(container).className).not.toContain('swatch--active')
  })

  it('clears a service node colour when Default is clicked', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={serviceNode('#10b981')} onNodeData={onNodeData} />,
    )
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: undefined })
  })

  it('SETS the default hex for a group rather than clearing, since Group.color is required', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const group = { id: 'g1', type: 'group', data: { label: 'Media', color: '#3b82f6' } } as never
    const { container } = render(
      <Inspector {...baseProps} node={group} onNodeData={onNodeData} />,
    )
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: '#64748b' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/Inspector.test.tsx`
Expected: FAIL — no `.swatch--default`, plus type errors from the removed props.

- [ ] **Step 3: Update all four call sites**

In `webapp/src/Inspector.tsx`, every `<ColorPicker …>` drops `overridden`, `defaultLabel` and `onReset`, and gains `defaultSwatch`, `isDefault` and `onSelectDefault`.

**Edge panel** — its default is the relationship-type colour, already computed as `REL[type].color`:

```tsx
            defaultSwatch={{ background: REL[type].color, border: REL[type].color }}
            isDefault={!colorOverridden}
            onSelectDefault={() => onEdge({ color: undefined })}
```

**Group panel** — required field, so Default *sets* the hex:

```tsx
            defaultSwatch={{ background: '#64748b', border: '#64748b' }}
            isDefault={d.color === '#64748b'}
            onSelectDefault={() => onNodeData({ color: '#64748b' })}
```

**Note panel** — the default sticky:

```tsx
            defaultSwatch={{ background: '#fef9c3', border: '#fde047' }}
            isDefault={typeof d.color !== 'string'}
            onSelectDefault={() => onNodeData({ color: undefined })}
```

**Service-node panel** — the default card:

```tsx
            defaultSwatch={{ background: '#ffffff', border: '#cbd5e1' }}
            isDefault={typeof d.color !== 'string'}
            onSelectDefault={() => onNodeData({ color: undefined })}
```

Leave each panel's existing `value` and `onChange` exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the whole suite and types**

Run: `npx vitest run && npm run typecheck && npx vite build`
Expected: all pass. Any remaining failure is a call site still passing a removed prop — fix it rather than restoring the prop.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/Inspector.tsx src/Inspector.test.tsx
npm run format:check
cd .. && git add webapp/src/Inspector.tsx webapp/src/Inspector.test.tsx
git commit -m "feat(color): wire the Default swatch for every entity kind

Notes, service nodes and edges clear their colour; groups set #64748b, since
Group.color is required and cannot be absent. Same gesture and visual across
all four, different mechanism where the model demands it."
```

---

### Task 4: Verify in the running app

**Files:** none modified. Verification only — no commits.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Seed a scratch data directory**

Never point the dev server at `webapp/`, and never at the live instance `diagram.home`. From `webapp/`:

```bash
SCRATCH=$(mktemp -d)
python3 - "$SCRATCH/model.json" <<'EOF'
import json, sys
json.dump({"version": 2, "templates": [], "diagrams": [{
  "id": "d-def", "name": "Default", "title": "Default", "type": "canvas",
  "groups": [], "edges": [], "flows": [],
  "nodes": [
    {"id": "s1", "label": "Coloured", "sub": "media", "fields": [], "color": "#3b82f6",
     "position": {"x": 40, "y": 300}},
    {"id": "s2", "label": "Plain", "sub": "media", "fields": [], "position": {"x": 260, "y": 300}}
  ],
  "notes": [
    {"id": "n1", "text": "## Coloured\n\n- one\n- two", "color": "#3b82f6",
     "position": {"x": 40, "y": 40}, "size": {"width": 240, "height": 160}},
    {"id": "n2", "text": "## Plain\n\n- one\n- two",
     "position": {"x": 320, "y": 40}, "size": {"width": 240, "height": 160}}
  ]}]}, open(sys.argv[1], "w"), indent=2)
EOF
echo "$SCRATCH"
```

- [ ] **Step 2: Start the dev server**

Check the port is free first (`ss -ltn | grep 8185`); other services occupy various ports on this machine. If taken, pick another and set BOTH variables to it.

```bash
DATA_DIR=$SCRATCH PORT=8185 API_TARGET=http://localhost:8185 npm run dev
```

Note the Vite URL printed — it may not be 5173.

- [ ] **Step 3: Open the diagram**

In the browser console, then reload:

```js
localStorage.setItem('homelab-open-tabs', JSON.stringify(['d-def']))
localStorage.setItem('homelab-active-diagram', 'd-def')
```

- [ ] **Step 4: Check the Default swatch reflects state**

- Select the plain note `n2`. Its Default swatch has `swatch--active`; no palette swatch does.
- Select the coloured note `n1`. Its Default swatch does NOT have `swatch--active`; the blue palette swatch does.
- Confirm no element with the text `reset` exists in the picker for any entity kind.

- [ ] **Step 5: The check this whole plan exists for**

- Select coloured node `s1`, click **Default**. The card returns to white immediately.
- **Reload the page.** It must STILL be white — computed background `rgb(255, 255, 255)`, border `rgb(203, 213, 225)`, and the node must no longer carry `node--tinted`.
- Confirm via `/api/model` on your scratch server that the node has **no** `color` key at all — not `null`, not the old hex.

That reload is the whole point: the previous implementation looked correct until the page reloaded.

- [ ] **Step 6: Check the group's different mechanism**

Add a group (`+ Group` in the toolbar), give it a colour from the palette, then click Default. It must return to slate — and via `/api/model`, its `color` must be `"#64748b"`, NOT absent. A group with no colour is invalid.

- [ ] **Step 7: Check an unrelated edit does not wipe a colour**

Colour node `s2`, then rename it by editing its label. Reload and confirm `s2` still has its colour. This is the regression the `null` sentinel could plausibly introduce.

- [ ] **Step 8: Stop the server and clean up**

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 9: Commit nothing**

This task produces no code. Any failure is fixed in the owning task (1-3), test first.

---

## Notes for the implementer

- **`null` is a wire signal, never model state.** After a patch is applied nothing should hold `null`. If a test or type wants `string | null`, something has leaked — fix the leak rather than widening the type.
- **`Group.color` is required.** Its Default swatch writes a hex. Do not "harmonise" the four panels into one shape; three clear and one sets, deliberately.
- **The spec says the helper wires in "once where update ops are applied".** That is not literally achievable: `applyOp` dispatches to per-entity mutators that spread-merge, and a spread cannot express a deletion. The helper is shared but used in three mutators. This plan is the accurate version.
- **Do not touch `webapp/server/`.** It calls the same `applyOps`, so it inherits the fix.
- **Task 2 deliberately leaves the build broken** between its commit and Task 3's. That is why Task 2's step list does not run the full suite.
