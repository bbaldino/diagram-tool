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

## From Phase 5 (Edit + View menus)

- ~~⌘I Inspector-toggle intercepted Ctrl+Shift+I (DevTools)~~ — **FIXED** during Phase 5 (added `&& !e.shiftKey && !e.altKey` to the ⌘I handler so Ctrl+Shift+I / ⌘⌥I pass through to the browser).
- **View zoom items show ⌘+/⌘−/⌘0/⇧1 hints but those keys aren't wired** (only the menu click works; the keys were intentionally not bound to avoid clobbering browser zoom). If desired later, wire them with `preventDefault` (best-effort) or drop the hints.
- **Snap-to-grid defaults OFF** (behavior-preserving) rather than the handoff's "on by default" — deliberate; revisit if the redesign wants grid-snap on by default.

## From Phase 6 (right rail — Inspector + Flows tabs)

- **`fitView` vs React Flow's ResizeObserver timing** — the `useEffect([railVisible])` calls `rf.fitView` synchronously after commit, but RF updates its container width via a ResizeObserver that fires afterward, so the fit can momentarily run against pre-resize dimensions. Works fine in practice (Task-3 verified); wrapping the `fitView` call in `requestAnimationFrame` removes the dependence on RF's resize timing.
- **`.rightrail` lacks `flex-shrink: 0`** — with `width:292px` as flex-basis and positive free space it holds 292px, but below a ~292px viewport it could shrink. Desktop-only scope makes it academic; add `flex-shrink:0` to harden.
- **Flows tab is the relocated (old) flow UI, not the handoff's redesign** — the §3a from-scratch Flows-tab (flow-list rows + steps block + ⋯ menus) was deferred; the existing flow select/+Flow/Edit/Play/Rename/Delete + FlowPanel were moved in as-is.
- **Inspector fields not restyled to §5a** — the Inspector's internal markup was kept as-is (just hosted in the rail); the pixel-perfect rail field styling (labels/inputs/toggles/chips) is a later restyle pass.

## From Phase 7 (Flows-tab redesign)

- **Footer `⋯` popover can open off the right viewport edge** — the flow row/footer `⋯` menu opens at a fixed offset and can extend past the right edge of the rail/viewport; it should flip to open inward (leftward) when near the edge.
- **Steps block stays fully editable during Play mode** — in `mode === 'play'` the caption input, chip `×`, "+ Add step", and Reorder ↑/↓ still render and mutate the model via `M.updateFlow`. Acceptable for the minimal-play cut, but odd; gate step edits to `mode === 'edit'` when the transport-bar phase lands.

## From Phase 8 (flow playback transport bar)

- ~~`playing` not reset on diagram switch~~ — **FIXED** in 6f47f19 (added `setPlaying(false)` to the re-seed reset).
- ~~Rail step-click doesn't pause auto-advance in play mode~~ — **FIXED** in 6f47f19 (rail `onSelStep` now pauses + jumps, matching the transport scrubber).
- **`setPlaying(false)` inside the `setCurrentStep` updater** (auto-advance effect) — works and batches, but a setter inside another setter's updater isn't pure and runs twice under React StrictMode. Cosmetic; could hoist the `atEnd` decision out of the reducer.
- **Selecting a different flow while playing** keeps `playing` true and auto-plays the newly selected flow from the clamped step, with no explicit pause. Acceptable but undecided — make it a deliberate product choice (pause on flow-switch vs. keep rolling).
- **Periodic no-op write-back during playback** — each auto-advance step churns node data → schedules a 400ms `flushCanvasInto`→`setModel` that is a structural no-op (badge/flowState aren't persisted, so `diffToOps` yields zero ops) but still toggles `skipReseed` each cycle, marginally widening the pre-existing race where a concurrent external re-seed could be swallowed. Pre-existing mechanism, not introduced here; a fast-follow could skip write-back scheduling when nothing geometric changed.
- **Scrubber bars are a 5px hit target** — the transport step bars are only 5px tall; fine with a mouse but a small target. Consider a taller invisible hit area. (Also why the browser smoke exercised jump via arrows/next rather than a direct bar click.)

## From Phase 9 (dialog restyle → shared §6 shell)

- ~~Import silent-wipe footgun~~ — **FIXED** in 5453840 (a valid-JSON-but-not-a-model / old catalog-shaped file normalizes to 0 diagrams; that now shows an import error and keeps Import disabled, so the replace-toggle-off path can't wipe the model with nothing).
- **New dialogs lack initial focus (a11y).** `DestructiveDialog` and `ImportDialog` don't autofocus a control; and `DialogShell`'s Enter-fires-primary fires the (possibly destructive) primary regardless of which control has focus. Fold into a dialog focus-trap / tab-cycling a11y pass (also covers the prompt/confirm dialogs).
- **Dead dialog CSS.** The old `.dialog*` block (index.css ~262-291) is unused after the shell refactor, and `.dialog` is still listed in the shared panel selector (index.css:119). Remove both in a cleanup sweep.
- **Open dialog not on the shared shell.** `OpenDiagramDialog` keeps its own `.opendlg*` markup + `.opendlg__scrim` (z-index 1000 vs the shared shell's 100). Harmless (mutually exclusive) but unify onto `DialogShell` when the Open dialog's deferred niceties (All/Recent/Open-tabs sub-tabs, real thumbnails, "edited Xm ago") are built.
- **`buildSeed` now dead in graph.ts.** Reset no longer reseeds the demo graph, so `buildSeed` (graph.ts:509) and the module-level `GROUPS` seed it uses may be fully unused — remove in a cleanup sweep after confirming no other caller.

## From Phase 10 (empty state + Group/Ungroup)

- ~~`⌘⇧T` / `⌘⇧L` bypassed the `canTidy` gate~~ — **FIXED** in 453c763 (`tidy()` now no-ops when the canvas has zero nodes, so the keyboard shortcuts match the disabled pill/menu).
- **Group/Ungroup keyboard shortcuts not wired.** The Arrange items advertise `⌘G` / `⇧⌘G` but only menu-click triggers them (consistent with the deferred View-zoom keys). Wire them (with `preventDefault`) in a later a11y/shortcuts pass, minding the browser `⌘G` "find next" clash.
- **Group is top-level only.** `canGroup` requires all selected nodes be top-level (`parentId == null`); grouping already-nested nodes and ungrouping a nested group are deferred. Group also **preserves arrangement** (doesn't re-flow into a row) and sizes the new group from estimated service-node dimensions — a later pass could read React Flow `measured` sizes for a tighter fit.
- **Notes are groupable.** `canGroup` includes selected `note` nodes (not just entities); grouping a note works end-to-end. If grouping should be entities-only, tighten the filter.
- **Group + Ungroup can both enable at once** when the selection holds a top-level group AND 2+ top-level non-group nodes; `groupSelection` groups the non-group members and ignores the selected group. Coherent but slightly surprising — consider making the two mutually exclusive.
- **Read-only / sample mode deferred.** No read-only flag exists on the model and nothing marks a diagram read-only; the §5b read-only chrome (muted status + disabled mutating controls) is deferred until there's a product trigger for it.

## From Phase 11 (merge-readiness polish sweep)

Most Phase-1→10 fast-follows above were CLEARED in this sweep: dead `.dialog*` CSS + `buildSeed` removed; meta pluralization; ⌘O guard; engine-id guard; `.rightrail` flex-shrink; fitView rAF; group/ungroup mutual exclusion; ⌘G/⇧⌘G wired + zoom hints dropped; tab-strip + dialog + menu a11y; menu 120ms transition; play-mode step lock; footer `⋯` edge-flip; scrubber hit area. Residual items:

- ~~`ACTORS`/`EDGES`/`interface E` orphaned by `buildSeed` removal~~ — **FIXED** in 67bf354 (removed; `N`/`G`/`GROUPS` retained).
- **Redundant `.tabstrip__tabs` vs `.tabstrip__tablist` CSS** — after the a11y wrapper split the two rules are byte-identical (`display:flex; align-items:flex-end; gap:3px`); collapse into one.
- **Open dialog not focus-managed** — `OpenDiagramDialog` uses its own `role="dialog"` (not `DialogShell`), so it doesn't inherit the new initial-focus + Tab-trap. Fold in when the Open dialog migrates onto `DialogShell`.
- **Scrubber 5px bar corners squared** — the taller hit-area (`background-clip: content-box`) left the painted band with square corners (was a rounded pill). Cosmetic.

## From Phase 12 (Inspector §5a restyle)

- ~~header `h4` margin misaligned in `.insp__header`~~ and ~~dead `.insp--empty .insp__hint`~~ — **FIXED** in 03b5096.
- **§5a screens needing infra (deferred):** the **multi-select Inspector** (app has no multi-selection state — `selNode` is single), the group **member-chip list** + **Collapse group** toggle (new features), the **Diagram read-only block** with "Last edited" (model has no timestamp), and the §5a header **icon tile** (cosmetic; the entity chip carries the type). Build these when the underlying state/model support lands.
- **Select `▾` on Firefox** — the custom chevron uses `appearance:none` + `-webkit-appearance:none` but not `-moz-appearance:none`; older Firefox may show a faint native arrow. Add `-moz-appearance:none`.
- **Empty state is left-aligned** — the §5a "Nothing selected" tile/title/body stack is left-aligned (matches the rest of the inspector padding); center it if the design intended a centered empty state.

## Explicitly deferred by scope decision (not defects — planned later phases)

- Tab strip: **drag-to-reorder** and the **overflow "+N more" picker chip**.
- Open dialog: **All/Recent/Open-tabs sub-tabs**, **real thumbnails**, **"edited Xm ago"** (model has no timestamp).
- Remaining redesign phases: **canvas pill** (Undo/Redo/Tidy/Auto-layout), **Edit/View/Arrange menu contents**, **right rail** (Inspector + Flows) + **flow playback transport bar**, **dialog restyle** to the shared shell.
