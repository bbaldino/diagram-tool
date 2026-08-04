// A compact color picker: quick-pick swatches for colors already used in the
// diagram and the scheme palette, plus a native color input as the escape
// hatch for any custom color. Used by the edge/group Inspector panels (plain
// hex) and the note/service-node panels (a scheme name or a custom hex).
import { SCHEMES, isSchemeName, type SchemeName } from './schemes'

interface Props {
  value: string // current effective value: a scheme name or a hex
  diagramColors: string[] // distinct values already present in the diagram
  onChange: (value: string) => void
  // Supplied only by the edge and group panels, whose colour is a plain hex
  // and whose "default" is a real state: an edge with no colour follows its
  // relationship type, and a group resets to slate. Nodes and notes never
  // pass these — under schemes a colour is always set, so there is no
  // absence to return to and no default swatch to show.
  defaultSwatch?: { background: string; border: string }
  isDefault?: boolean
  onSelectDefault?: () => void
}

// A scheme name renders from its table entry; anything else (a custom hex, or
// a raw color like Edge.color/Group.color) renders as itself.
function swatchStyle(value: string): { background: string; borderColor?: string } {
  if (isSchemeName(value)) {
    const s = SCHEMES[value]
    return { background: s.background, borderColor: s.border }
  }
  return { background: value }
}

function Swatch({
  value,
  title,
  active,
  onClick,
  variant,
}: {
  value: string
  title: string
  active: boolean
  onClick: () => void
  variant?: string
}) {
  return (
    <button
      type="button"
      className={`swatch${variant ? ` swatch--${variant}` : ''}${active ? ' swatch--active' : ''}`}
      style={swatchStyle(value)}
      title={title}
      onClick={onClick}
    />
  )
}

export function ColorPicker({
  value,
  diagramColors,
  onChange,
  defaultSwatch,
  isDefault,
  onSelectDefault,
}: Props) {
  const cur = value.toLowerCase()
  const inDiagram = diagramColors.map((c) => c.toLowerCase())
  // Same signal the "Default" section below already keys off of: only the
  // edge and group panels pass defaultSwatch/onSelectDefault, and their
  // value is a plain hex — the scheme Palette below must never be offered to
  // them, or clicking a scheme swatch would write a scheme name into a field
  // rendered straight as CSS (see ColorPicker's file comment).
  const isHexOnly = Boolean(defaultSwatch && onSelectDefault)

  return (
    <div className="colorpick">
      {isHexOnly && (
        <div className="colorpick__section">
          <div className="colorpick__label">Default</div>
          <div className="colorpick__swatches">
            <button
              type="button"
              className={`swatch swatch--default${isDefault ? ' swatch--active' : ''}`}
              style={{ background: defaultSwatch!.background, borderColor: defaultSwatch!.border }}
              title="Default"
              onClick={onSelectDefault}
            />
          </div>
        </div>
      )}
      {inDiagram.length > 0 && (
        <div className="colorpick__section">
          <div className="colorpick__label">In this diagram</div>
          <div className="colorpick__swatches">
            {inDiagram.map((c) => (
              <Swatch key={c} value={c} title={c} active={c === cur} onClick={() => onChange(c)} />
            ))}
          </div>
        </div>
      )}
      {!isHexOnly && (
        <div className="colorpick__section">
          <div className="colorpick__label">Palette</div>
          <div className="colorpick__swatches">
            {(Object.keys(SCHEMES) as SchemeName[]).map((name) => (
              <Swatch
                key={name}
                value={name}
                title={name}
                active={name === value}
                onClick={() => onChange(name)}
                variant="scheme"
              />
            ))}
          </div>
        </div>
      )}
      <div className="colorpick__custom">
        <input
          type="color"
          value={isSchemeName(value) ? SCHEMES[value].border : value}
          onChange={(e) => onChange(e.target.value)}
          title="Custom color"
        />
      </div>
    </div>
  )
}
