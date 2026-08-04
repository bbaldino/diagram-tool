# Node Tint and Palette Yellow — Design

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## Goal

Give a coloured service node the same visual treatment a coloured note gets —
tinted background, derived border, derived text — instead of the left accent bar
shipped in v0.4.0. Add a yellow to the colour palette.

## Background

v0.4.0 made colour configurable on notes and service nodes. A coloured note takes
a full tinted fill; a coloured node takes only a 4px left accent bar, on the
reasoning that flooding the card would fight its icon, status dot and field rows.

In use that reads as an inconsistency rather than a considered difference: the two
entity kinds respond to the same control in visibly different ways, and the bar is
easy to miss. The user's judgement is that the node should match the note.

Separately, `PALETTE` in `src/ColorPicker.tsx` holds ten Tailwind-500 tones and
contains no yellow, despite yellow being this app's own sticky idiom.

**Accepted limitation, decided explicitly:** colour is one-way. Removing the reset
affordance in v0.4.0 (it never persisted) combined with the palette having no
yellow means there is no path back to an entity's default appearance, via the UI
or MCP. This was weighed and accepted; adding yellow does **not** restore it,
because any chosen hex applies the tint modifier and produces derived values
rather than the literal defaults. This design does not change that.

## Design

### Palette

Insert Tailwind yellow-500 `#eab308` after amber, preserving the existing
Tailwind ordering. The contrast guard iterates `PALETTE`, so it covers the new
entry automatically.

Precomputed: yellow measures roughly **5.07:1** on the plain tinted background and
**4.62:1** on the code-span surface, making it the new worst case (amber was
4.91:1) while still clearing WCAG AA. No re-tuning of the existing ratios is
expected. The guard is authoritative — if it disagrees, the ratios move, not the
assertion threshold.

### Node tint replaces the accent bar

Delete `.node--accented::before` entirely. Rename the modifier
`node--accented` → `node--tinted`, since "accent" no longer describes it.

The card derives from `--node-color` using the same ratios the note uses:

- background — `color-mix(in srgb, var(--node-color) 15%, white)`
- border — `color-mix(in srgb, var(--node-color) 45%, white)`
- primary text — `color-mix(in srgb, var(--node-color) 55%, black)`

### Every surface that must derive

A node carries more fixed colours than a note. Leaving any of them literal
produces a visibly broken card — grey-on-blue text, an amber block inside a green
node. All of these live under `.node--tinted`:

| surface | today | becomes |
| --- | --- | --- |
| card background | `#ffffff` | 15% mix |
| card border | `#cbd5e1` | 45% mix |
| `.node__label` | inherited | primary text (55%) |
| `.node__field` value | `#475569` | primary text (55%) |
| `.node__sub` | `#64748b` | secondary text (45%) |
| `.node__field-k` | `#94a3b8` | secondary text (45%) |
| `.node__icon--placeholder` bg | `#eef2f7` | 25% mix |
| `.node__icon--placeholder` text | `#64748b` | primary text (55%) |
| `.node__note` background | `#fffbeb` | 18% mix over the card tint |
| `.node__note` border-top | `#fde68a` | 35% mix |
| `.node__note` text | `#92610a` | primary text (55%) |

**Deliberately NOT derived:**

- `.node__status` — the up/down/idle dot keeps its own colours. It answers "is
  this service healthy?", and tinting it would put that in competition with the
  card colour, turning a status signal into decoration.
- Icon images. These are external dashboard-icons SVGs sitting on a light tint;
  they are unmodified today and stay so.
- `.node.selected` — the indigo selection ring is chrome, not content.

### Contrast

The guard (`src/noteContrast.test.ts`) currently checks two note surfaces. It
gains the node's two text tiers and is renamed `src/entityContrast.test.ts`, since
it no longer covers only notes.

Requirement: for **every** colour in `PALETTE`, both the primary text (55%) and
the secondary text (45%) must reach at least 4.5:1 against the surface they sit
on. Secondary text at 45% is the untested tier — if it fails, darken it until it
passes rather than lowering the threshold.

## Error handling

No new failure modes. Colour is already a validated hex; this design changes only
how an already-valid colour is rendered. A node with no colour renders exactly as
today, which the existing compatibility test asserts.

## Testing

- The existing "renders exactly as before when no colour is set" test for
  `ServiceNode` must keep passing unchanged — it is the compatibility guard, and
  it is why every new rule is scoped under `.node--tinted`.
- Update the `ServiceNode` colour test for the renamed modifier class.
- Extend the contrast guard to the node's primary and secondary text tiers across
  all eleven palette colours.
- Assert the accent-bar rule is gone, so the change is a replacement rather than
  two treatments layered on one card.

## Consequences and risks

**Eleven colours now, and yellow is the tightest.** Any future ratio change has a
smaller margin than before. The guard makes that visible rather than silent.

**The tinted card is a bigger visual change than the bar.** A wall of coloured
nodes is louder than a wall of white cards with coloured edges. That is the
intent, but it is worth looking at a realistically-populated diagram rather than
a two-node scratch one before deciding it is right.

**Colour remains one-way**, and this change increases the cost of a wrong choice,
since a mis-coloured node is now far more prominent than a mis-coloured 4px bar.
The follow-ups that would fix it — `.nullable()` on the MCP edit patches, or the
ops-protocol clear sentinel — remain unbuilt and are the obvious next thing if
this becomes annoying in practice.

## Alternatives considered

**Keeping the accent bar and making it thicker or full-height.** Rejected: it
addresses visibility but not the inconsistency, which is the actual complaint.

**Tinting only the node's header row.** Rejected — a service node has no header;
its first row is the icon and label, so tinting it would look like a partially
painted card rather than a deliberate band.

**Deriving the status dot too.** Rejected, per the reasoning above.
