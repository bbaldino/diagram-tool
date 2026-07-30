# Inspector §5a Restyle (Chrome Phase 12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the existing single-selection Inspector (node / edge / group / note / empty) to the handoff's §5a rail pixel spec — tokens, sizes, radii, focus, destructive styling, a real toggle switch, entity-type chips, custom select `▾`, and the §5a "Nothing selected" empty state.

**Architecture:** Mostly CSS restyle of the existing `.insp__*` rules to §5a tokens (the Inspector markup is already class-based with no inline styles), plus a small `Switch` primitive for boolean fields and light markup for header chips + the empty state. Genuinely-new §5a screens that need infrastructure the app lacks — the **multi-select inspector** (no multi-selection state), the **group member-chip list** and **Collapse group** toggle (new features), and the **Diagram "Last edited" block** (model has no timestamp) — are OUT of scope and remain deferred.

**Tech Stack:** Vite + React 18 + TypeScript, plain CSS, Vitest (node env).

## Global Constraints

- Never use `window.alert` / `prompt` / `confirm`. [[no-native-popups]]
- Never commit `webapp/model.json` or `webapp/history.json`.
- Capitalize only the first letter of multi-letter acronyms.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Behavior-preserving (restyle only) except adding the Switch primitive and empty-state markup. Keep the Vitest suite green (currently 280).
- **§5a tokens (verbatim):** field group `gap: 5px`; label **11px** `#64748b`; input/select `padding: 7px 9px`, `border: 1px solid #dfe3ea`, `border-radius: 8px`, font **12.5px**; focus `border-color: #4f46e5` + `box-shadow: 0 0 0 3px rgba(79,70,229,0.13)`; select trailing `▾` **9px** `#94a3b8`; section body `padding: 12px 14px 16px`, stack `gap: 11px`; entity chip **11px**, `background: #eceff3`, `#64748b`, `padding: 2px 7px`, `border-radius: 5px`; button row flex `gap: 7px`, each `flex: 1`, `padding: 7px 0`, `border-radius: 7px`, **12px / 550**, secondary `border: 1px solid #dfe3ea`, destructive `border: 1px solid #f0d2d2` + `#b91c1c`, primary `background: #4f46e5` `#fff` 600; toggle track `30×18px` `border-radius: 9px`, `14px` white knob `2px` inset, on `#4f46e5` off `#dfe3ea`; member chip **11.5px** `background: #f1f2f4` `padding: 3px 8px` `border-radius: 5px`; empty state tile `34×34px` `#f1f2f4` `border-radius: 9px` with `◇` `#94a3b8`, title **13px / 600** "Nothing selected", body **12px / 1.55** `#64748b`.

---

## File Structure

- **Modify** `webapp/src/index.css` — restyle the `.insp*` block (~lines 175-244) to §5a tokens; add `.insp__chip`, `.insp__switch`, `.insp__empty*` styles.
- **Create** `webapp/src/Switch.tsx` — a small controlled toggle-switch primitive.
- **Modify** `webapp/src/Inspector.tsx` — use `Switch` for the edge "Inferred (dashed)" boolean; add an entity-type chip to each branch header; rebuild the empty branch to the §5a "Nothing selected" markup.

---

### Task 1: §5a Inspector CSS restyle

**Files:** `webapp/src/index.css`

**Interfaces:** none new; pure restyle of existing `.insp__*` classes (no markup change, no behavior change).

Restyle the `.insp*` block (~lines 175-244) to the §5a tokens above. Concretely:

- [ ] **Step 1: Container + section padding.** `.insp` — remove the fixed `width: 240px` (let it fill the rail; use `width: 100%` / `box-sizing: border-box`), set section body `padding: 12px 14px 16px`, and make the field stack `gap: 11px` (via the field `margin-bottom` or a flex column — match the existing structure).

- [ ] **Step 2: Field labels + inputs.** `.insp__field` → `gap: 5px`; its `> span` label → **11px** `#64748b`. `.insp__field input, .insp__field select` → `padding: 7px 9px`, `border: 1px solid #dfe3ea`, `border-radius: 8px`, font **12.5px**, color `#1e293b`, `box-sizing: border-box`, `width: 100%`. Focus (`:focus`) → `border-color: #4f46e5`; `box-shadow: 0 0 0 3px rgba(79,70,229,0.13)`; `outline: none`.

- [ ] **Step 3: Custom select `▾`.** `.insp__field select` → `appearance: none; -webkit-appearance: none;` + a right-aligned `▾` via `background-image` (an inline SVG data-URI chevron in `#94a3b8`, ~9px) at `right 9px center`, `background-repeat: no-repeat`, with extra right padding so text doesn't overlap the arrow.

- [ ] **Step 4: Note textarea + checkboxes.** `.insp__note` → `border: 1px solid #dfe3ea`, `border-radius: 8px`, font **12.5px**, focus ring as Step 2. `.insp__check` → **11.5px** `#475569` (label text). (The inferred checkbox becomes a Switch in Task 2; the per-node field checkboxes stay native, restyled minimally with `accent-color: #4f46e5`.)

- [ ] **Step 5: Buttons.** `.insp__delete` → §5a destructive: `border: 1px solid #f0d2d2`, `color: #b91c1c`, `background: #fff`, `border-radius: 7px`, `padding: 7px 0`, **12px / 550** (hover a faint `#fdf3f3`). `.insp__action` → secondary: `border: 1px solid #dfe3ea`, `color: #475569`, same shape. If the branches render a button row (delete + action), ensure it's flex `gap: 7px` with each `flex: 1` (check the markup; the group branch has Shrink + Delete).

- [ ] **Step 6: Direction button group.** `.insp__dir` active state → `#4f46e5` accent (border `#c7cdfa`, bg `#eef0fb`, text `#4338ca`) to match the §5a accent ramp; inactive border `#dfe3ea`.

- [ ] **Step 7: Chip + switch + empty placeholders.** Add the CSS rules `.insp__chip` (entity chip: **11px**, `background: #eceff3`, `#64748b`, `padding: 2px 7px`, `border-radius: 5px`), `.insp__header` (flex row, gap 8px, align center, title + chip), and the switch/empty styles Task 2 will use:

```css
.insp__switch { position: relative; width: 30px; height: 18px; flex: none; }
.insp__switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.insp__switch-track { position: absolute; inset: 0; border-radius: 9px; background: #dfe3ea; transition: background 120ms; }
.insp__switch input:checked + .insp__switch-track { background: #4f46e5; }
.insp__switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 120ms; }
.insp__switch input:checked ~ .insp__switch-knob { transform: translateX(12px); }
.insp__switch-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12.5px; color: #475569; }
.insp__empty-tile { width: 34px; height: 34px; border-radius: 9px; background: #f1f2f4; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 16px; }
.insp__empty-title { font-size: 13px; font-weight: 600; color: #1e293b; margin-top: 10px; }
.insp__empty-body { font-size: 12px; line-height: 1.55; color: #64748b; margin-top: 4px; }
```

- [ ] **Step 8: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run   # expect 280 passed
git add webapp/src/index.css
git commit -m "style(inspector): restyle rail fields to §5a tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Switch primitive + header chips + §5a empty state

**Files:** `webapp/src/Switch.tsx` (create), `webapp/src/Inspector.tsx`

**Interfaces:**
- Produces `Switch`:

```tsx
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element
```

- [ ] **Step 1: Create the Switch primitive.** Create `webapp/src/Switch.tsx`:

```tsx
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { checked, onChange, label } = props
  return (
    <label className="insp__switch-row">
      <span>{label}</span>
      <span className="insp__switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span className="insp__switch-track" />
        <span className="insp__switch-knob" />
      </span>
    </label>
  )
}
```

- [ ] **Step 2: Use Switch for the edge "Inferred (dashed)" toggle.** In `Inspector.tsx`, the edge branch's inferred `.insp__check` checkbox (~lines 94-99) — replace with `<Switch checked={!!edge.data?.inferred} onChange={(v) => onEdge({ inferred: v })} label="Inferred (dashed)" />` (match the actual current prop shape used to read/write inferred — read the branch first). Import `Switch`.

- [ ] **Step 3: Add entity-type chips to headers.** For each branch, wrap the title + a chip in an `.insp__header` row:
  - Node branch (`Edit node`): chip text `Entity`.
  - Edge branch (`Edit edge`): chip text `Edge`.
  - Group branch (`Edit group`): chip text `Group`.
  - Note branch (`Edit note`): chip text `Note`.
  Render as `<div className="insp__header"><h4>…</h4><span className="insp__chip">Entity</span></div>` (match the existing title element/tag — if it's a bare string or an `<h4>`, adapt). Keep the existing sub-line (edge `source → target`) below the header.

- [ ] **Step 4: §5a empty state.** Replace the nothing-selected branch (`.insp--empty` with `.insp__hint`) markup with the §5a structure:

```tsx
<div className="panel insp insp--empty">
  <div className="insp__empty-tile">◇</div>
  <div className="insp__empty-title">Nothing selected</div>
  <div className="insp__empty-body">Select a node, group, or edge to edit its fields. Double-click the canvas and choose Add → Entity to create one; use + Group / + Note for diagram structure.</div>
</div>
```

(Keep the existing copy text; only restructure to the tile + title + body.)

- [ ] **Step 5: Verify + commit**

```bash
cd webapp && npx tsc --noEmit && npx vitest run
git add webapp/src/Switch.tsx webapp/src/Inspector.tsx
git commit -m "feat(inspector): §5a toggle switch, header chips, empty state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Browser validation (controller-run)

**Files:** none (verification only; use a **throwaway** diagram [[sdd-smokes-use-throwaway-diagram]]).

- [ ] **Step 1: Empty state.** With nothing selected, the Inspector shows the `◇` tile + "Nothing selected" + the body copy, styled per §5a.
- [ ] **Step 2: Node.** Select an entity → header shows the name + `Entity` chip; Name/Icon/Status/Group fields use §5a inputs/selects (radius 8, border `#dfe3ea`, custom `▾`, focus ring `#4f46e5`); Delete button is §5a destructive.
- [ ] **Step 3: Edge.** Select an edge → `Edge` chip; the "Inferred (dashed)" control is now a **toggle switch** (30×18, on = `#4f46e5`) that still writes `inferred` to the model; Direction group + Delete styled per §5a.
- [ ] **Step 4: Group.** Select a group → `Group` chip; Label/Width/Height/Parent fields + Shrink/Delete styled per §5a.
- [ ] **Step 5: Regression.** Confirm every field still EDITS the model (rename a node, change status, toggle inferred, resize a group) — restyle didn't break wiring. Confirm the rail width (292px) and layout are intact.
- [ ] **Step 6: Cleanup.** Delete the throwaway; confirm no `model.json`/`history.json` staged.

---

## Self-Review

**Coverage of §5a (achievable subset):**
- Field labels/inputs/selects/focus → Task 1. ✅
- Custom select `▾` → Task 1. ✅
- Destructive + secondary buttons → Task 1. ✅
- Toggle switch (inferred) → Task 1 (CSS) + Task 2 (Switch + wiring). ✅
- Entity-type chips in headers → Task 2. ✅
- §5a "Nothing selected" empty state → Task 2. ✅

**Explicitly OUT of scope (need infra the app lacks — remain deferred, tracked in fast-follows):** multi-select Inspector (no multi-selection state), group **member-chip list** + **Collapse group** toggle (new features), the **Diagram read-only block** with "Last edited" (no model timestamp), the §5a header **icon tile** (cosmetic; the entity chip carries the type signal).

**Placeholder scan:** none — each step names the file/anchor and concrete change or full code. ✅

**Type consistency:** `Switch` prop shape identical between Task 2 Step 1 (definition) and Step 2 (use); `.insp__switch*`/`.insp__chip`/`.insp__empty*` classes defined in Task 1 Step 7 and consumed by Task 2 markup. ✅
