# Chrome redesign — deferred fast-follows

Non-blocking items surfaced during the phased chrome-redesign SDD runs. None block a phase; collect
and address in a dedicated polish pass (and definitely sweep before the whole redesign merges to `main`).
Each was reviewed and judged safe to defer at the time.

## From Phase 1 (menu bar + File menu)

- **Menu open/close transition** — README specifies a 120ms ease-out fade + 2px rise for menus/dropdowns; not implemented (menus appear instantly).
- **Reset confirm dialog** — `File ▸ Reset diagram…` is wired to the existing UNCONFIRMED `reset()` (no confirm has ever existed on that path). The redesign's Reset-confirm dialog is a later dialog-phase item; until then Reset is a one-click destructive action (styled red). Delete retains its existing confirm.
- **Submenu hover orphan** — moving the mouse from an open submenu-parent (e.g. Export) onto a disabled row can leave the submenu panel open/orphaned until the mouse reaches an enabled row (cosmetic; self-heals).
- **MenuBar internals** — dead `.menu__submenu-parent{position:relative}` rule; mouseenter sets highlight before the disabled check (visually inert); keydown effect dep-array churn; latent edge case if a menu item ever has BOTH `separatorBefore` and a `submenu` (not hit by current data).

## From Phase 2 (diagram tabs + Open dialog)

- **Tab strip a11y** — tabs and the `×` close are click-only `div`/`span`s with no `role`/`tabIndex`/keyboard/`aria`. Middle-click + `×` stopPropagation work; keyboard/ARIA is a genuine gap deferred with the lean cut.
- **Meta line pluralization** — `DiagramTabs` meta renders "1 groups · 1 edges" (no singular/plural handling).
- **Empty state not persisted across reload** — closing all tabs shows the empty state in-session, but a reload always resolves an active diagram and re-adds one tab (persisted `[]` is effectively overridden). Defensible ("always land on a diagram") — confirm as a product decision or add a comment.
- **⌘O shortcut guard** — ⌘O opening the Open dialog lacks the `!e.shiftKey` guard the other shortcuts (⌘N/⌘⇧E) have, so ⌘⇧O also opens it (harmless, inconsistent).
- **`onImport` zero-diagram edge case** — importing JSON with zero diagrams would leave `activeId` truthy-but-unresolved in the new nullable-`activeId` world; almost certainly prevented by `normalizeModel` guaranteeing ≥1 diagram, but a defensive check is cheap.
- **`newDiagram` dead return** — now `return id` but no caller consumes it (harmless).
- **Open dialog inline style** — selected-row name font-weight set via inline `style` instead of the `.is-selected` class that already carries the row background (cosmetic).
- **Tab meta count staleness** — tab/Open-dialog entity counts read from debounce-flushed `model.diagrams`, so the active diagram's counts can be transiently stale until the next autosave flush (inherited architecture; consistent across both readers).
- **`.tab` CSS redundancy** — inactive-tab padding is inferred (README only specs the active tab) and duplicated across `.is-active`/`:not(.is-active)`; could hoist to base `.tab`.

## From Phase 3 (canvas pill)

- **Pill vs old toolbar overlap at narrow widths** — below ~1725px the top-center pill's right edge visually overlaps the still-wide old top-right toolbar's `+Group`/`+Note`. The pill stays clickable (Panel `zIndex:6`); this resolves automatically as later phases move controls off that toolbar. Cosmetic/transitional.
- **Unchecked engine-id cast** — `onChooseEngine={(id) => chooseEngine(id as 'elk' | 'graphviz')}` casts a `string` to the engine union with no runtime guard. Safe today (the `engines` array is a hardcoded 2-element literal); becomes a latent bug only if an engine is added to that array that `setLayoutEngine` doesn't accept.
- **Dead `.pill__text:disabled` CSS** — no disabled state is wired for the pill's Tidy / Auto-layout buttons yet; the rule is inert (ready for future use).
- **`role="menuitem"` on pill dropdown items** — the pill sets it; MenuBar's `.menu__item`s don't. Not a regression (the pill is arguably more correct); align them in an a11y pass.
- **Tidy vs Re-run layout both call `tidy()`** — the design nominally separates Arrange ▸ Tidy up (⌘⇧T) from Auto-layout ▸ Re-run layout (⌘⇧L); collapsed onto one `/api/layout` call for now. Revisit when the Arrange menu / ⌘⇧T land.

## Explicitly deferred by scope decision (not defects — planned later phases)

- Tab strip: **drag-to-reorder** and the **overflow "+N more" picker chip**.
- Open dialog: **All/Recent/Open-tabs sub-tabs**, **real thumbnails**, **"edited Xm ago"** (model has no timestamp).
- Remaining redesign phases: **canvas pill** (Undo/Redo/Tidy/Auto-layout), **Edit/View/Arrange menu contents**, **right rail** (Inspector + Flows) + **flow playback transport bar**, **dialog restyle** to the shared shell.
