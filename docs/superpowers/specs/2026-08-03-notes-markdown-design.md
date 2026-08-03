# Markdown Formatting in Canvas Notes — Design

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## Goal

Render canvas sticky notes as formatted markdown when they are not being
edited, so notes can carry structure — headings, lists, emphasis, inline code,
links — instead of a single run of plain text.

## Scope

**Canvas notes only** (the resizable `Note` entity). The other thing called a
"note" — `Node.note`, the small text blob rendered inside a service node —
stays plain text. It is a one-liner in a 180px-wide box where headings and
lists have no room to pay off.

Explicitly out of scope:

- **Images.** `![alt](url)` will not render. A note is a small box and an image
  would dominate it, and rendering one means the canvas fetches remote content.
  Implemented via `disallowedElements={['img']}` with `unwrapDisallowed` left
  off, so an image renders as nothing rather than as a broken-image icon or its
  alt text. This is a rendering choice only — the markdown source is preserved
  in `Note.text` and is still visible when the note is selected.
- Any change to how note text is stored. `Note.text` remains raw markdown; the
  model, ops, diff, and MCP surface are untouched.

## Background

Two facts about the current implementation shape everything below.

**The note is a permanently-editable `<textarea>`.** `NoteNode` in
`src/nodes.tsx` renders a bare textarea filling the sticky; the Inspector says
"Edit the text directly on the note." There is no reading mode today, so
markdown requires introducing one.

**Notes already contain multi-line text written by agents.** `add_note` and
`edit_note` are MCP tools, and the live instance has notes with 5–6 newlines
listing one field per line. These currently display correctly in the textarea.

## Design

### Edit vs rendered mode

Reuse React Flow's existing selection rather than inventing an interaction:

| state | shows |
| --- | --- |
| selected | the textarea, raw markdown — exactly today's behaviour, and the resizer already appears |
| deselected | rendered markdown |

Nothing new is persisted and there is no mode toggle to discover. Clicking a
note to edit it already selects it, so the gesture is unchanged.

A deselected note whose text is empty or whitespace-only renders the same muted
`note…` placeholder the textarea shows. Without this an empty note becomes an
invisible yellow rectangle that is hard to find and click.

### Renderer

`react-markdown` with `remark-gfm` and `remark-breaks`.

**`react-markdown`** does not render raw HTML unless `rehype-raw` is added, and
it will not be added. This matters concretely rather than theoretically: notes
are writable over MCP, so note text is not always hand-typed.

**`remark-gfm`** supplies strikethrough, task lists, tables, and autolinks.

**`remark-breaks` is load-bearing, not a nicety.** In CommonMark a single
newline is a soft wrap rendered as a space. Without it, the existing
agent-written notes that list one field per line would collapse into a run-on
paragraph — a visible regression on real data, caused by this feature.
`remark-breaks` maps a single newline to `<br>`, which is also what someone
typing into a sticky note expects.

### Styling

All rules scoped under `.note__md` in `src/index.css`.

- Match the textarea exactly — `font-size: 12px`, `color: #713f12` — so text
  does not shift when the mode flips.
- `overflow: auto`, matching the textarea's existing scroll behaviour, since
  the note is a fixed-size box driven by `Note.size`.
- Tame block elements for a small sticky: headings only slightly larger than
  body (h1 ~15px down to h3 ~12.5px), tight list padding, `code`/`pre` on a
  translucent tint, blockquote with a left rule. Untamed, one `# heading`
  blows out the box.
- Tables get their own `overflow-x: auto` wrapper.
- Collapse first/last child margins so content sits flush against the existing
  8px padding.

### Links

Links need two things beyond default rendering:

- `target="_blank" rel="noreferrer noopener"`, or a click navigates the whole
  canvas away.
- `className="nodrag"` plus `onMouseDown` stop-propagation. Otherwise clicking
  a link also selects the note, which flips it into the textarea and the link
  vanishes mid-click.

## Error handling

Malformed markdown is not an error condition — `react-markdown` renders
unparseable constructs as literal text, which is the desired behaviour for a
sticky note. No error UI is needed.

The one real failure mode is content that overflows its box; `overflow: auto`
handles it, and the note is user-resizable.

## Testing

The project gained a component-test harness (`jsdom` +
`@testing-library/react`, scoped per-file with a `// @vitest-environment jsdom`
docblock) while fixing the caret bug that preceded this work. These tests use
it.

- Deselected renders markdown: `**bold**` produces a `<strong>`, `- a\n- b`
  produces a list.
- Selected renders the textarea containing the raw source, not the rendered
  output.
- A single newline produces a line break (`remark-breaks` is wired).
- Raw HTML in note text is NOT executed — `<script>` / `<img onerror=…>`
  appears as text.
- Empty and whitespace-only notes render the placeholder when deselected.
- Links carry `target="_blank"` and `rel`.
- An image in note text renders nothing, and its markdown source is still
  present in the textarea when the note is selected.
- **Draft survives a deselect → reselect cycle.** The textarea now unmounts on
  deselect, so unsaved local draft state must have reached the store first.
  This is the regression risk introduced by putting the editor behind
  `selected`, and it is the one case the existing caret tests do not cover.

## Consequences and risks

**The textarea unmounts on deselect.** The caret fix (`b1f9d79`) holds the
in-progress text in local `draft` state and syncs outward on change, so the
store already has the text before unmount. The test above pins that.

**Existing notes with literal `\n` are unaffected by this change.** They are
repaired on write by `8da523b`, but notes already stored keep their literal
until rewritten. Rendered as markdown they will show a literal `\n`, exactly as
they do today in the textarea — no better, no worse.

**Bundle size grows** by the react-markdown/remark tree. Acceptable next to the
`@hpcc-js/wasm-graphviz` and `elkjs` already shipping.

## Alternatives considered

**Double-click to edit** (the Miro/FigJam idiom). Rejected: it changes existing
muscle memory — a single click would no longer type — for no gain over reusing
selection.

**Always rendered, edit in the Inspector.** Rejected: it contradicts the
Inspector's own hint and adds a sidebar trip to every edit.

**Hand-rolled subset renderer.** Zero dependencies and no XSS surface, but it
is a parser to own, and nesting and edge cases are where those fail.

**`marked`/`markdown-it` + DOMPurify.** The only option that builds a raw HTML
string, so correctness rests entirely on sanitizer configuration — the worst
fit for MCP-authored content.
