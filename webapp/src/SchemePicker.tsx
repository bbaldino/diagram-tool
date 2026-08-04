// Picks a colour SCHEME for a node or a note: outline, background and font
// chosen as one unit.
//
// Deliberately separate from ColorPicker rather than a mode of it. The two look
// alike but hold incompatible values — this one stores a scheme name (or a
// custom hex), while ColorPicker stores a plain hex for Edge.color/Group.color.
// Sharing one component meant a scheme name could reach a field rendered
// straight as CSS, and every attempt to gate that off took an affordance away
// from edges and groups instead. Two small components, no mode flag.
//
// There is no "default" swatch here, and there must not be: a node or note
// always has a scheme, so there is no absence to return to. Picking `paper` is
// how you get the plain white card. (Edges are different — an edge with no
// colour follows its relationship type — which is why ColorPicker keeps one.)
import { SCHEMES, isSchemeName, type SchemeName } from './schemes'

interface Props {
  value: string // a scheme name, or a custom hex
  diagramSchemes: string[] // scheme values already used by nodes/notes here
  onChange: (value: string) => void
}

// A name renders from its table entry; a custom hex renders as itself.
//
// The swatch fills with `border`, not `background`. Every scheme's background
// is a 15%-strength tint — #e2ecfe, #fde3e3, #dbf4ec — which at 20px reads as
// "off-white" for all thirteen and gives the eye nothing to tell them apart.
// `border` is the chromatic mid tone, and the ring in `text` gives the swatch
// definition against the panel.
function swatchStyle(value: string): { background: string; borderColor?: string } {
  if (isSchemeName(value)) {
    const s = SCHEMES[value]
    return { background: s.border, borderColor: s.text }
  }
  return { background: value }
}

function Swatch({
  value,
  title,
  active,
  onClick,
}: {
  value: string
  title: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`swatch swatch--scheme${active ? ' swatch--active' : ''}`}
      style={swatchStyle(value)}
      title={title}
      onClick={onClick}
    />
  )
}

export function SchemePicker({ value, diagramSchemes, onChange }: Props) {
  const names = Object.keys(SCHEMES) as SchemeName[]
  // Compared by stored value, never by rendered colour: a name and the
  // equivalent hex deliberately render differently (the table's text is derived
  // at 35% toward black, a custom hex at 55%), so hex equality would mark the
  // wrong swatch active.
  const inDiagram = diagramSchemes.filter((s) => !names.includes(s as SchemeName))

  return (
    <div className="colorpick">
      {inDiagram.length > 0 && (
        <div className="colorpick__section">
          <div className="colorpick__label">In this diagram</div>
          <div className="colorpick__swatches">
            {inDiagram.map((s) => (
              <Swatch
                key={s}
                value={s}
                title={s}
                active={s === value}
                onClick={() => onChange(s)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="colorpick__section">
        <div className="colorpick__label">Palette</div>
        <div className="colorpick__swatches">
          {names.map((name) => (
            <Swatch
              key={name}
              value={name}
              title={name}
              active={name === value}
              onClick={() => onChange(name)}
            />
          ))}
        </div>
      </div>
      <div className="colorpick__custom">
        <input
          type="color"
          value={isSchemeName(value) ? SCHEMES[value].background : value}
          onChange={(e) => onChange(e.target.value)}
          title="Custom color"
        />
      </div>
    </div>
  )
}
