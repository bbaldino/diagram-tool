# Colour Schemes — Design

**Date:** 2026-08-04
**Status:** Approved (design), pending implementation plan

## Goal

Make an entity's colour a **named scheme** — outline, background and font picked
as one unit — rather than a single hex from which the other two are computed. An
entity always has a scheme; there is no absence and nothing to clear.

## Background

Colour today is one hex per entity, from which background, border and text are
derived by fixed ratios. Absence of a hex means "render the literal defaults".

That representation caused every colour problem this project has had:

- **The default is not expressible.** A white background forces the source hex to
  white, which then yields a white border and grey text. So "return to default"
  had to be implemented as *removing* the colour, which produced a reset control,
  then a Default swatch, and a persistent mismatch with how the feature is
  described.
- **Light colours degenerate.** Any hex paler than roughly `#cdcdcd` puts the
  label below WCAG AA, because the text is the hex mixed toward black.
- **Absence leaks.** `absent` vs `set` drove a `--tinted` modifier, a
  compatibility promise, a null sentinel in the ops layer, and a class of bugs
  where a swatch appeared selected for an entity that had no colour.

A scheme removes the cause rather than the symptoms: the three values are stated,
not computed, so the default is an ordinary member of the list.

## Design

### What a scheme is

```ts
interface Scheme {
  background: string
  border: string
  text: string
}
```

Three values, matching the three things a user is choosing. **Secondary tones are
derived from those three, not stored** — a node also has a sub-label, field keys,
field values, an icon placeholder and an inline note, and requiring every scheme
to spell out six values would make the table unmaintainable and easy to get
subtly wrong. Secondary text is `text` mixed toward `background`; accent fills are
`border` mixed toward `background`.

Secondary text mixes by a **clamp, not a fixed ratio**: it starts at 70% and
steps back toward `text` until the result clears 4.5:1. No single ratio serves
every scheme — `paper` sits on white and can lighten a long way, `sticky` sits on
`#fef9c3` and can barely lighten at all, so a fixed ratio must satisfy the
tightest scheme and over-darkens all the others. At a uniform 95% the secondary
tone lands within 24 RGB units of primary, which clears AA while erasing the
label/sub-label distinction entirely. The clamp gives each scheme the most
hierarchy its own background can afford: worst case 101 units, worst contrast
4.60.

This is also why the eleven colour schemes' `text` values are derived at 35%
toward black rather than the 55% the old renderer used — at 55% they sit near
5:1, leaving no headroom to lighten a secondary tone that still clears AA. The
custom-hex path keeps 55%, since a custom colour must look as it did before.

### The scheme table

One exported map, shared by every entity kind:

```
paper    { #ffffff, #cbd5e1, #1f2937 }   the white service card
sticky   { #fef9c3, #fde047, #713f12 }   the yellow note
slate · red · orange · amber · yellow · emerald · teal · blue · indigo · violet · pink
```

The eleven colour entries are the existing `PALETTE` hexes with their three values
computed **once, at authoring time**, and written into the table as literals. That
keeps a single source of truth at runtime and removes derivation from the render
path entirely.

`paper` and `sticky` are ordinary entries. Both appear in every entity's palette,
so a node can take the sticky scheme and vice versa. That was accepted
deliberately — it reads as a feature.

### Where "default" lives

Two constants, and nowhere else:

```ts
export const NEW_NODE_SCHEME = 'paper'
export const NEW_NOTE_SCHEME = 'sticky'
```

"Default" is a starting value, not a kind of colour. No scheme is named
`default`, nothing branches on defaultness, and no swatch is special-cased.

### Storage

The field holds **either a scheme name or a hex**:

- `'blue'` → looked up in the table
- `'#7c3aed'` → derives a scheme, exactly as the current code does

That keeps the custom colour picker working unchanged. Both paths produce the
same `Scheme`, so everything downstream sees one shape.

The field is renamed `color` → `scheme`, since it no longer holds a colour. **This
is a breaking change to the MCP tool surface** — `add_node`, `edit_node`,
`add_note` and `edit_note` take `scheme` instead of `color`. Accepted because the
old name would actively mislead an agent into sending only hexes.

### Migration

On load, any node without a value gets `paper` and any note gets `sticky`,
written back on the next save. Additive and idempotent — a second run finds
nothing to do.

Counts, measured against `http://diagram.home/api/model` on 2026-08-04: **83
nodes and 9 notes, and not one of them carries a colour.** An earlier draft of
this section said 82 and 8 with "the two entities already carrying hexes keep
them" — that was wrong, and the local `webapp/model.json` (87 nodes, 5 notes,
also none coloured) is a different, stale dataset that should not be used to
check migration counts.

The consequence matters for testing: the "leave an existing value alone" branch
is not exercised by any real data, so it is covered only by unit-test fixtures.
Verifying it in-app requires deliberately colouring an entity first.

After migration, absence does not occur. The `--tinted` / `--accented` modifier
classes disappear, along with the "renders byte-identically when absent"
compatibility promise, because there is no absent case left to protect.

### Scope: nodes and notes only

**Edges are excluded.** An edge's default is its *relationship type's* colour, so
`talks-to` and `via` differ. Storing a scheme would freeze an edge's appearance
against later type changes. Absence-means-type-colour is correct there and stays.

**Groups are excluded.** `Group.color` is already required, so groups have no
absence to remove. Converting them would be churn for no behavioural gain.

Both keep working exactly as they do now.

## Error handling

An unknown scheme name — from hand-edited data or a mistaken MCP call — falls
back to the entity kind's starting scheme rather than rendering unstyled, and the
MCP schema rejects a value that is neither a known name nor a valid 6-digit hex,
so a bad value is refused at the boundary rather than stored.

## Testing

- Every scheme in the table clears WCAG AA (4.5:1) for both primary and derived
  secondary text against its own background. The existing contrast guard is
  repointed from derived palette hexes to the scheme table, which is now the
  complete set of what can render.
- Secondary text is **visibly lighter** than primary — at least 60 RGB units of
  summed per-channel difference. AA alone does not catch the failure that
  matters here: a secondary tone can clear 4.5:1 while being indistinguishable
  from primary, which is exactly what a uniform 95% mix produced.
- A hex value still derives a scheme equal to what the current code produces, so
  custom colours are unchanged.
- Migration: a node with no value becomes `paper`, a note becomes `sticky`, an
  entity already holding a hex is untouched, and a second run is a no-op.
- An unknown scheme name renders the starting scheme rather than throwing.
- MCP accepts a known name and a valid hex, and rejects `'nonsense'`.

## Consequences and risks

**The `--tinted` branch disappears.** Every node and note renders through one
path. That removes the largest source of "looks right until it doesn't" bugs on
this feature, but it does mean every entity's appearance is touched by this
change — the migration must produce visually identical results for the 90
entities that currently render as defaults. That is the thing to verify in-app.

**With one known exception: secondary text shifts slightly.** A node's sub-label
is `#64748b` today, and the `paper` scheme derives `#626973`. These cannot be
made equal — `#64748b` is bluer than any mix of `#1f2937` and white (matching it
would need 69% on the red channel and 58% on blue), so no derivation reproduces
it. Forcing a match would mean storing a sixth value per scheme, which is the
thing "secondary tones are derived, not stored" exists to avoid. The shift is a
near-match in practice and was accepted deliberately; it applies equally to
field keys and values.

**Breaking MCP change.** Any agent sending `color` will be rejected. That is
deliberate and preferable to silently accepting a field that no longer describes
what it sets.

**Two shapes in one field.** A name and a hex coexist. The alternative — a
separate field per shape — was rejected as more machinery for no user-visible
gain, but it does mean the lookup-or-derive branch must be in exactly one place.

## Alternatives considered

**Keep the hex and reserve one value to mean "default".** Rejected: it puts a
magic value in the data and leaves the light-colour degeneration untouched.

**Store the three colours expanded on each entity.** Self-describing, but
retuning a scheme could never reach entities already using it.

**Per-entity-kind scheme lists.** Rejected as several near-duplicate tables to
maintain; the shared list's only side effect is that a node can look like a
sticky, which is harmless.
