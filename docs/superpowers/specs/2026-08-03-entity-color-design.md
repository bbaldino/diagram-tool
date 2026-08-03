# Configurable Entity Colour — Design

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## Goal

Let a colour be set on **notes** and **service nodes**, from the Inspector and over
MCP, and put every entity kind behind the same colour control.

## Background

Colour support is currently uneven, which is the actual problem:

| entity | model field | Inspector control | renders as |
| --- | --- | --- | --- |
| Edge | `color?` optional | `ColorPicker` — swatches, custom, reset | per-edge stroke override |
| Group | `color` required | raw `<input type="color">` | `--group-color` CSS var |
| Service node | — | none | fixed white card |
| Note | — | none | fixed yellow sticky |

So two kinds cannot be coloured at all, and the two that can use different
controls. Adding two more without reconciling that would leave four.

**The shared control already exists.** `src/ColorPicker.tsx` provides a curated
ten-colour `PALETTE`, "in this diagram" quick-picks, a native colour input as an
escape hatch, and reset-to-default. Its header comment already states it is
"reusable elsewhere". This design reuses it rather than inventing anything.

**`color-mix` is already an established pattern here** — `index.css:285` derives
the group tint with it. Deriving note and node colours the same way is consistent
with existing code, not a new dependency.

## Design

### Colour model: derive, don't restrict

A sticky has three coordinated colours (background, border, text) and they must
stay legible together. Rather than restricting the user to a fixed set of
pre-tuned stickies, the chosen colour is a single hex and the coordinated values
are **derived from it** in CSS:

- background — `color-mix(in srgb, var(--note-color) 15%, white)`
- border — `color-mix(in srgb, var(--note-color) 45%, white)`
- text — `color-mix(in srgb, var(--note-color) 70%, black)`

This keeps the palette swatches as the one-click path while leaving custom hex
safe, because legibility comes from the derivation rather than from limiting the
choice. It also means there is exactly one palette in the product — the one
`ColorPicker` already ships — not a second sticky-specific one.

### Model

Two new optional fields:

```ts
export interface Node extends Entity { /* … */ color?: string }
export interface Note extends Entity { /* … */ color?: string }
```

Both hold a hex string. **Absent means exactly today's appearance** — the yellow
sticky, the white node card — so every existing note and node is untouched and no
migration is needed. `Group.color` and `Edge.color` are unchanged.

### Rendering

Each element sets one CSS custom property; the stylesheet does the rest, following
the existing `--group-color` pattern including its fallback default.

**Note — full fill.** The whole sticky takes the colour, per the three
derivations above. The markdown styles added for note rendering currently hardcode
the brown `#713f12` and `rgba(113, 63, 18, …)` in five places — the code tint,
`pre` background, blockquote rule, table borders, and `hr`. Those become
derivations of `--note-color` so a coloured note stays internally consistent
rather than showing brown accents on a blue sticky.

**Service node — accent only.** The card keeps its white background; the colour
appears as a left accent bar via `::before` (`.node` already has
`position: relative`). A node carries an icon, label, sub-label, field rows and a
status dot, all of which rely on contrast against white — flooding the background
would fight every one of them.

### Inspector

- **Note panel** and **service-node panel** each gain a `Color` field rendering
  `ColorPicker`. Reset clears the field back to `undefined`, restoring the default.
- **Group panel** swaps its raw `<input type="color">` for the same component.
  No model change and existing group hex values keep working; this removes the
  inconsistency rather than adding to it.
- **Edge panel** is unchanged — it already uses `ColorPicker`.

`ColorPicker` needs `diagramColors`; the note and node panels pass the distinct
colours already present in the diagram, as the edge panel does.

### MCP

Optional `color` on `add_note`, `edit_note`, `add_node`, and `edit_node`,
validated by zod as a hex string (`/^#[0-9a-fA-F]{6}$/`) so a malformed value is
rejected rather than stored. Omitting `color` in an edit patch leaves the existing
colour untouched — it is not cleared.

## Error handling

A malformed hex over MCP is a validation error returned to the caller; nothing is
written. In the UI the value comes from `ColorPicker`, which can only produce
valid hex, so there is no invalid-input path to handle.

An unset colour is not an error state — it is the default, and the reset control
returns to it deliberately.

## Testing

- Model: a note and a node round-trip with and without `color`; absent stays absent.
- MCP: `add_note` / `add_node` accept a valid hex; a malformed hex is rejected and
  the store is unchanged; an edit patch omitting `color` leaves it untouched.
- Component: an uncoloured note and node render exactly as they do today (guards
  the "absent means unchanged" promise); a coloured note exposes `--note-color`
  and a coloured node exposes its accent.
- Inspector: the picker renders for note, node and group; reset clears the field.

## Consequences and risks

**A very light chosen colour yields a low-contrast sticky.** The 70%-toward-black
text derivation is what keeps it readable; that ratio is the thing to check when
verifying in-app, not just that colour appears.

**`color-mix` is Chrome 111+.** Already relied upon for groups, so this adds no
new constraint.

**Notes and nodes gain a field agents can set.** That is intended — agents author
most diagrams here — but it means an agent can colour-code inconsistently. The
palette swatches make a shared vocabulary available; nothing enforces it.

## Alternatives considered

**A fixed set of pre-tuned sticky presets** (yellow/blue/green/pink/grey with
hand-picked border and text per preset). Rejected once it became clear
`ColorPicker` already exists with a palette: this would have meant two palettes in
one product and no custom-colour path, to solve a legibility problem that
derivation solves without restricting anything.

**Flooding the node card background with colour.** Rejected — it fights the icon,
status dot and field text that all assume a white card.

**Leaving groups on the raw hex input.** Rejected as the cheaper option that
preserves the inconsistency this design exists to remove.
