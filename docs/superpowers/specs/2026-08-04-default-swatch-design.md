# Default Colour Swatch — Design

**Date:** 2026-08-04
**Status:** Approved (design), pending implementation plan

## Goal

Put each entity's default appearance in the colour picker as a selectable swatch,
so "go back to how it looked" is a normal choice alongside the palette. Make
clearing a colour actually persist, which is what that requires.

## Background

An entity's colour is a single hex; the rendered background, border and text are
all derived from it. There is currently no way to get back to an entity's default
appearance:

- **No hex can express it.** For a service node the default is white background,
  `#cbd5e1` border, near-black label. Getting a white background from the
  derivation requires the source colour to be white — and that same white then
  yields a white (invisible) border and `rgb(140,140,140)` grey text. A source
  colour producing the correct border would have to be `(139,162,188)`, which
  contradicts. Three targets, one input, no solution.
- **No affordance clears it.** `reset` was removed from notes, nodes and edges
  earlier because it never worked: `diffById` builds an update patch from the
  whole item, so a cleared field arrives as `color: undefined`, which
  `JSON.stringify` drops before the op reaches the server; the spread-merge in
  the update mutators then leaves the old value. Only groups kept a reset, and
  only because it writes a concrete hex rather than clearing.

The consequence has surfaced three times: colour being one-way, a yellow tint
nearly indistinguishable from the default sticky, and a picker that pre-selected
a swatch so a click that looked idempotent committed a permanent change.

## Design

### One affordance: a Default swatch

The picker gains a **Default swatch in first position**, rendered as that entity
kind's real default appearance, and shown active when the entity has no colour.
The separate `reset` control is removed entirely — the swatch is the reset, and
keeping both would be two controls for one action.

| entity | swatch shows | clicking it |
| --- | --- | --- |
| note | the default yellow sticky | clears `color` → literal defaults |
| service node | white card, slate border | clears `color` → literal defaults |
| edge | its relationship-type colour | clears `color` → back to type colour |
| group | slate `#64748b` | **sets** that hex |

Groups set rather than clear because `Group.color` is required in the model and
cannot be absent. Same gesture and same visual; different mechanism underneath.

### Making a clear persist

Two changes, and `applyOps` is shared between the client and the server, so this
lands once for both.

1. **`src/diff.ts`** — when `diffById` builds an update patch, a key that was
   present on the previous item and is absent on the next emits `null` rather
   than being dropped. `null` survives JSON; `undefined` does not.
2. **A shared patch helper** — applying an update patch deletes keys whose value
   is `null` instead of merging them. Wired in once where update ops are applied,
   so every entity kind gets it rather than each mutator reimplementing it.

`null` never reaches the model: it is a wire-level signal meaning "remove this
key", consumed when the op is applied. `Node.color` and `Note.color` stay
`string | undefined`.

### ColorPicker props

`overridden` and `defaultLabel` lose their purpose — the hint reading "custom"
or "default" is redundant once a swatch shows that state directly. Both are
removed, along with `onReset`. The component's inputs become `value`,
`diagramColors`, `onChange`, plus what it needs to render and select the Default
swatch for the calling entity kind.

## Error handling

Clearing an already-absent colour is a no-op: `diffById` sees no change and emits
no op.

A `null` arriving for a required field (e.g. `Group.color`) would produce an
invalid entity. The group panel never sends one — its Default swatch writes a
hex — so this is prevented by construction rather than guarded at runtime.

## Testing

- A clear round-trips: diff → `JSON.stringify` → `JSON.parse` → apply, and the
  field is genuinely **absent** afterwards — not `null`, not the previous value.
  This is the exact path that silently dropped the change before, so it is tested
  end to end rather than at either end.
- An update patch that omits `color` leaves an existing colour untouched. This is
  the regression the `null` sentinel could plausibly introduce.
- The Default swatch renders active for an uncoloured entity and inactive for a
  coloured one, per entity kind.
- Clicking Default on a group writes `#64748b` rather than clearing, since its
  field is required.
- In-app: pick a colour, pick Default, reload, and confirm the entity is back to
  its literal default values — the failure mode being a change that looks right
  until the page reloads.

## Consequences and risks

**Colour stops being one-way.** That is the point, and it retires the class of
problem behind the last three reports.

**`null` becomes meaningful in ops.** Anything constructing an update patch by
hand must know that `null` deletes. The helper is the single place that
interprets it, and the round-trip test pins the behaviour.

**A pale custom hex still derives grey text and a faint border**, and the
contrast guard still only covers `PALETTE`, not arbitrary input. That is
unchanged by this design and deliberately out of scope — but it is now
*recoverable*, since Default undoes it. Worth revisiting separately if custom
colours turn out to be used much.

## Alternatives considered

**A sentinel hex in the palette that renders as the default.** Rejected: the
arithmetic above shows no hex can produce the required background, border and
text simultaneously.

**Keeping `reset` alongside a Default swatch.** Rejected as two controls for one
action.

**Special-casing white to mean "untinted".** Rejected — it makes a legitimate
colour unusable and hides a magic value in the CSS.
