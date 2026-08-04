// A compact color picker: quick-pick swatches for colors already used in the
// diagram and the scheme palette, plus a native color input as the escape
// hatch for any custom color. Used by the edge/group Inspector panels (plain
// hex) and the note/service-node panels (a scheme name or a custom hex).
import { SCHEMES, isSchemeName, type SchemeName } from './schemes'

interface Props {
  value: string // current effective value: a scheme name or a hex
  diagramColors: string[] // distinct values already present in the diagram
  onChange: (value: string) => void
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

export function ColorPicker({ value, diagramColors, onChange }: Props) {
  const cur = value.toLowerCase()
  const inDiagram = diagramColors.map((c) => c.toLowerCase())

  return (
    <div className="colorpick">
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
