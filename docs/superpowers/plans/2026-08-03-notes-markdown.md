# Canvas Note Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canvas sticky notes as formatted markdown when they are not selected, while keeping the existing textarea as the editor when they are.

**Architecture:** `NoteNode` in `webapp/src/nodes.tsx` gains one branch on its existing `selected` prop: selected renders today's textarea unchanged, deselected renders a new `NoteMarkdown` component. Rendering lives in its own file so `nodes.tsx` does not absorb markdown configuration. Nothing new is persisted — `Note.text` stays raw markdown and the model, ops, diff, and MCP surface are untouched.

**Tech Stack:** React 18 (`^18.3.1`), TypeScript, Vite, vitest, `@testing-library/react` + jsdom (already present), `react-markdown` `^10.1.0`, `remark-gfm` `^4.0.1`, `remark-breaks` `^4.0.0`.

## Global Constraints

- Prettier config is `{ "singleQuote": true, "semi": false, "printWidth": 100 }`. Run `npx prettier --write <files>` before every commit; `npm run format:check` is a CI gate.
- All commands run from `webapp/`.
- Component tests need `// @vitest-environment jsdom` as the **first line** of the file. The other 300+ tests run in the node environment and must stay that way — do not add a global vitest `environment` setting.
- Never add `rehype-raw`. Raw HTML in note text must not execute; notes are writable over MCP.
- Add dependencies with `npm install` (never hand-edit `package.json`), so latest versions are picked up. Expect `react-markdown@^10.1.0`, `remark-gfm@^4.0.1`, `remark-breaks@^4.0.0`. These are deliberately NOT pinned exactly: react-markdown's peer range is `react: >=18` (satisfied by this project's `^18.3.1`), its last publish was 2025-03-07, and the caret range cannot cross to a v11. If `npm install` resolves a v11+, stop and report rather than adapting the code — the API in this plan is written against v10.
- `npm run typecheck` and `npx vitest run` must both be clean before any commit.
- Do not point a dev server at `webapp/` as its `DATA_DIR`. Use a scratch directory.

---

### Task 1: Add the markdown renderer component

**Files:**
- Create: `webapp/src/NoteMarkdown.tsx`
- Create: `webapp/src/NoteMarkdown.test.tsx`
- Modify: `webapp/package.json` (via `npm install`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function NoteMarkdown({ text }: { text: string }): JSX.Element` — renders `text` as markdown inside `<div className="note__md">`. Used by Task 2.

- [ ] **Step 1: Install the dependencies**

```bash
npm install react-markdown remark-gfm remark-breaks
```

- [ ] **Step 2: Write the failing test**

Create `webapp/src/NoteMarkdown.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { NoteMarkdown } from './NoteMarkdown'

afterEach(cleanup)

describe('NoteMarkdown', () => {
  it('renders emphasis as real elements', () => {
    const { container } = render(<NoteMarkdown text="**bold** and *italic*" />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
  })

  it('renders a list', () => {
    const { container } = render(<NoteMarkdown text={'- one\n- two'} />)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('treats a single newline as a line break', () => {
    // remark-breaks. Without it CommonMark folds this into one paragraph and
    // the existing agent-written notes collapse into a run-on line.
    const { container } = render(<NoteMarkdown text={'first line\nsecond line'} />)
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  it('supports gfm strikethrough', () => {
    const { container } = render(<NoteMarkdown text="~~gone~~" />)
    expect(container.querySelector('del')?.textContent).toBe('gone')
  })

  it('does NOT execute raw HTML', () => {
    const { container } = render(<NoteMarkdown text={'<img src=x onerror="alert(1)">'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img')
  })

  it('does not render markdown images', () => {
    const { container } = render(<NoteMarkdown text="![alt text](http://example.com/a.png)" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('opens links in a new tab with a safe rel', () => {
    render(<NoteMarkdown text="[site](http://example.com)" />)
    const a = screen.getByRole('link', { name: 'site' })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noreferrer')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.className).toContain('nodrag')
  })

  it('wraps its output in .note__md', () => {
    const { container } = render(<NoteMarkdown text="hi" />)
    expect(container.querySelector('.note__md')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/NoteMarkdown.test.tsx`
Expected: FAIL — cannot resolve `./NoteMarkdown`.

- [ ] **Step 4: Write the implementation**

Create `webapp/src/NoteMarkdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// Rendered (deselected) view of a canvas note.
//
// remark-breaks is load-bearing, not a nicety: CommonMark treats a single
// newline as a soft wrap, so without it the agent-written notes that list one
// field per line collapse into a run-on paragraph.
//
// rehype-raw is deliberately absent — react-markdown does not execute raw HTML
// without it, and note text is writable over MCP.
const PLUGINS = [remarkGfm, remarkBreaks]

// Images would dominate a small sticky and make the canvas fetch remote
// content. Disallowed at render only; the source stays in Note.text.
const DISALLOWED = ['img']

export function NoteMarkdown({ text }: { text: string }) {
  return (
    <div className="note__md">
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        disallowedElements={DISALLOWED}
        components={{
          // Without target/rel a click navigates the whole canvas away.
          // `nodrag` + stopPropagation keep React Flow from treating the click
          // as a node select, which would swap the link out mid-click.
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="nodrag"
              target="_blank"
              rel="noreferrer noopener"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/NoteMarkdown.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, typecheck silent.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write src/NoteMarkdown.tsx src/NoteMarkdown.test.tsx package.json
npm run format:check
cd .. && git add webapp/src/NoteMarkdown.tsx webapp/src/NoteMarkdown.test.tsx webapp/package.json webapp/package-lock.json
git commit -m "feat(notes): add markdown renderer for canvas notes

react-markdown with remark-gfm and remark-breaks. No rehype-raw, so raw HTML
in note text is not executed — note text is writable over MCP. Images are
disallowed at render; a sticky is too small for them and rendering one would
make the canvas fetch remote content.

remark-breaks is load-bearing: CommonMark folds a single newline into a space,
which would collapse the existing agent-written notes into a run-on paragraph."
```

---

### Task 2: Switch NoteNode between editor and rendered view

**Files:**
- Modify: `webapp/src/nodes.tsx` (the `NoteNode` function, currently at lines 74-121)
- Modify: `webapp/src/NoteNode.test.tsx` (add cases; keep all existing ones)

**Interfaces:**
- Consumes: `NoteMarkdown` from Task 1 — `({ text }: { text: string })`.
- Produces: no new exports. `NoteNode` renders the textarea when `selected` is truthy and `NoteMarkdown` otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/src/NoteNode.test.tsx`, inside the existing top-level scope (after the current `describe` block). The existing `noteProps` helper hardcodes `selected: false`, so add a second helper next to it:

```tsx
const notePropsSelected = (text: string): NodeProps =>
  ({ id: 'n1', data: { text }, selected: true }) as unknown as NodeProps

describe('NoteNode selected vs rendered', () => {
  it('shows the raw markdown in a textarea while selected', () => {
    render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('**bold**')} />
      </ReactFlowProvider>,
    )
    const el = screen.getByPlaceholderText('note…') as HTMLTextAreaElement
    expect(el.value).toBe('**bold**')
  })

  it('renders markdown and hides the textarea while deselected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...noteProps('**bold**')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('shows the placeholder hint for an empty note while deselected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...noteProps('   ')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.note__placeholder')?.textContent).toBe('note…')
  })

  it('still shows text typed just before deselecting, even if the store lagged', async () => {
    // The textarea unmounts on deselect. NoteNode itself does not, so its local
    // `draft` survives and the rendered view must use it — otherwise a keystroke
    // taken in the last moments before deselect disappears from view. Note
    // `data.text` is deliberately UNCHANGED across the rerender: that is the
    // React Flow store lagging, which is the condition the caret fix exists for.
    const user = userEvent.setup()
    const { rerender, container } = render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('start')} />
      </ReactFlowProvider>,
    )
    const el = screen.getByPlaceholderText('note…') as HTMLTextAreaElement
    el.focus()
    el.setSelectionRange(5, 5)
    await user.keyboard(' more')
    expect(el.value).toBe('start more')

    rerender(
      <ReactFlowProvider>
        <NoteNode {...noteProps('start')} />
      </ReactFlowProvider>,
    )

    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('start more')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/NoteNode.test.tsx`
Expected: the four new tests FAIL — the textarea renders regardless of `selected`, so `container.querySelector('textarea')` is not null and no `strong` or `.note__placeholder` exists. The original four caret tests must still PASS.

- [ ] **Step 3: Implement the branch**

In `webapp/src/nodes.tsx`, add the import at the top with the other local imports:

```tsx
import { NoteMarkdown } from './NoteMarkdown'
```

Then replace the `return (...)` block of `NoteNode` (keep everything above it — `draft`, `editing`, and the `useEffect` — exactly as it is):

```tsx
  return (
    <div className="note">
      <NodeResizer minWidth={140} minHeight={70} isVisible={!!selected} color="#eab308" />
      <SideHandles />
      {selected ? (
        <textarea
          spellCheck={noteSpellcheck}
          value={draft}
          placeholder="note…"
          onFocus={() => {
            editing.current = true
          }}
          // Deliberately does NOT reset draft: the store may not have caught up
          // yet, and resetting here would revert what was just typed.
          onBlur={() => {
            editing.current = false
          }}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            setNodes((ns) =>
              ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: next } } : n)),
            )
          }}
        />
      ) : draft.trim() ? (
        <NoteMarkdown text={draft} />
      ) : (
        // An empty note would otherwise be an invisible yellow rectangle.
        <div className="note__placeholder">note…</div>
      )}
    </div>
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/NoteNode.test.tsx`
Expected: PASS, 8 tests (4 original caret tests + 4 new).

- [ ] **Step 5: Verify nothing else broke**

Run: `npx vitest run && npm run typecheck`
Expected: all pass, typecheck silent.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/nodes.tsx src/NoteNode.test.tsx
npm run format:check
cd .. && git add webapp/src/nodes.tsx webapp/src/NoteNode.test.tsx
git commit -m "feat(notes): render canvas notes as markdown when not selected

Reuses React Flow selection instead of adding a mode toggle: selected shows
today's textarea with the raw source, deselected shows the rendered markdown.
Nothing new is persisted — Note.text stays raw markdown.

An empty note renders the placeholder hint so it does not become an invisible
yellow rectangle."
```

---

### Task 3: Style the rendered view

**Files:**
- Modify: `webapp/src/index.css` (add after the existing `.note textarea` rule, which ends at line 169)

**Interfaces:**
- Consumes: the `.note__md` and `.note__placeholder` class names produced by Tasks 1 and 2.
- Produces: no code interfaces — CSS only.

- [ ] **Step 1: Add the styles**

Insert immediately after the `.note textarea { … }` rule in `webapp/src/index.css`:

```css
/* Rendered (deselected) note. Metrics deliberately match .note textarea so
   text does not shift when selection flips between the two. */
.note__md,
.note__placeholder {
  width: 100%;
  height: 100%;
  overflow: auto;
  font-size: 12px;
  color: #713f12;
}
.note__placeholder {
  opacity: 0.55;
}
/* Sit flush against .note's 8px padding. */
.note__md > *:first-child {
  margin-top: 0;
}
.note__md > *:last-child {
  margin-bottom: 0;
}
/* A sticky is small: keep headings close to body size or one `# x` blows the
   box out. */
.note__md h1 {
  font-size: 15px;
}
.note__md h2 {
  font-size: 13.5px;
}
.note__md h3,
.note__md h4,
.note__md h5,
.note__md h6 {
  font-size: 12.5px;
}
.note__md h1,
.note__md h2,
.note__md h3,
.note__md h4,
.note__md h5,
.note__md h6 {
  margin: 6px 0 3px;
  font-weight: 700;
  line-height: 1.2;
}
.note__md p {
  margin: 0 0 6px;
  line-height: 1.35;
}
.note__md ul,
.note__md ol {
  margin: 0 0 6px;
  padding-left: 18px;
}
.note__md li {
  margin: 1px 0;
  line-height: 1.35;
}
.note__md code {
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(113, 63, 18, 0.1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.note__md pre {
  margin: 0 0 6px;
  padding: 6px;
  overflow-x: auto;
  border-radius: 4px;
  background: rgba(113, 63, 18, 0.1);
}
.note__md pre code {
  padding: 0;
  background: none;
}
.note__md blockquote {
  margin: 0 0 6px;
  padding-left: 8px;
  border-left: 3px solid rgba(113, 63, 18, 0.3);
}
.note__md a {
  color: #4f46e5;
}
.note__md table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}
.note__md th,
.note__md td {
  padding: 2px 6px;
  border: 1px solid rgba(113, 63, 18, 0.25);
}
.note__md hr {
  margin: 6px 0;
  border: 0;
  border-top: 1px solid rgba(113, 63, 18, 0.25);
}
```

- [ ] **Step 2: Verify the build and tests are unaffected**

Run: `npx vitest run && npm run typecheck`
Expected: all pass. (CSS is not covered by tests; this step guards against a syntax error breaking the Vite build.)

- [ ] **Step 3: Confirm the stylesheet parses**

Run: `npx vite build`
Expected: build succeeds with no CSS warnings.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src/index.css
npm run format:check
cd .. && git add webapp/src/index.css
git commit -m "style(notes): style the rendered markdown view of canvas notes

Metrics match .note textarea so text does not shift when selection flips.
Headings are kept close to body size and tables/pre scroll inside the note,
since a sticky is a small fixed-size box."
```

---

### Task 4: Verify in the running app

**Files:**
- None modified. This task is verification only.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Seed a scratch data directory**

Never point the dev server at `webapp/`. From `webapp/`:

```bash
SCRATCH=$(mktemp -d)
python3 - "$SCRATCH/model.json" <<'EOF'
import json, sys
note = lambda i, x, y, t: {"id": i, "text": t, "position": {"x": x, "y": y},
                           "size": {"width": 260, "height": 170}}
json.dump({"version": 2, "templates": [], "diagrams": [{
  "id": "d-md", "name": "MD", "title": "MD", "type": "canvas",
  "nodes": [], "groups": [], "edges": [], "flows": [],
  "notes": [
    note("n1", 40, 40, "## Backup plan\n\n- nightly to **NAS**\n- offsite *weekly*\n\n`restic check`"),
    note("n2", 340, 40, "tool: npm\nroot: repo path\nmarkerFile: package.json"),
    note("n3", 640, 40, "[docs](http://example.com) and ~~old~~ new"),
    note("n4", 940, 40, ""),
  ]}]}, open(sys.argv[1], "w"), indent=2)
EOF
echo "$SCRATCH"
```

- [ ] **Step 2: Start the dev server**

```bash
DATA_DIR=$SCRATCH PORT=8182 API_TARGET=http://localhost:8182 npm run dev
```

Note the Vite URL it prints (it will pick a free port if 5173 is taken).

- [ ] **Step 3: Open the diagram and check each note**

In the browser, set the active diagram before loading:

```js
localStorage.setItem('homelab-open-tabs', JSON.stringify(['d-md']))
localStorage.setItem('homelab-active-diagram', 'd-md')
```

then reload. Confirm, with nothing selected:

- `n1` shows a heading, a bulleted list, bold and italic, and inline code — not raw `##` and `-` characters.
- `n2` shows **three separate lines** (this is the `remark-breaks` check; if it renders as one run-on line, `remark-breaks` is not wired).
- `n3` shows a link and struck-through text.
- `n4` shows the faint `note…` hint rather than an empty yellow box.

- [ ] **Step 4: Check the edit round-trip**

- Click `n1`. It must switch to the textarea showing the raw `## Backup plan…` source, with the resize handles visible.
- Type a character in the **middle** of the text. The caret must stay put (this is the `b1f9d79` regression check).
- Click empty canvas to deselect. The note must re-render with the edit included.

- [ ] **Step 5: Check the link trap**

Click the link in `n3`. It must open a new tab and the note must **not** flip into edit mode mid-click.

- [ ] **Step 6: Stop the server and clean up**

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 7: Commit nothing**

This task produces no code. If any check failed, fix it in the owning task (1, 2, or 3) with a test first.

---

## Notes for the implementer

- **The caret fix is already in** (`b1f9d79`). Do not rewrite `draft`/`editing` handling in `NoteNode` — the four original tests in `NoteNode.test.tsx` pin it, and they must stay green.
- **Notes already stored with a literal `\n`** (backslash + `n`) still exist on the live instance. They will render that literal, exactly as they do today in the textarea. That is expected and out of scope; `8da523b` repairs only new writes.
- **`Node.note`** — the small note inside a service node — is out of scope. Leave `nodes.tsx` line ~68 alone.
