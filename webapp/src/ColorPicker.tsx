// A compact color picker: quick-pick swatches for colors already used in the
// diagram and a curated palette, plus a native color input as the escape hatch
// for any custom color. Used by the edge Inspector; reusable elsewhere.

interface Props {
  value: string // current effective color (hex)
  diagramColors: string[] // distinct colors already present in the diagram
  onChange: (hex: string) => void
  // How this entity kind looks with no colour set, drawn on the Default swatch.
  defaultSwatch: { background: string; border: string }
  isDefault: boolean // true when the entity has no colour of its own
  onSelectDefault: () => void
}

// A modern, cohesive palette — distinct but harmonious (Tailwind 500-ish tones).
export const PALETTE = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
]

function Swatch({
  color,
  active,
  onClick,
}: {
  color: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`swatch${active ? ' swatch--active' : ''}`}
      style={{ background: color }}
      title={color}
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

  return (
    <div className="colorpick">
      <div className="colorpick__section">
        <div className="colorpick__label">Default</div>
        <div className="colorpick__swatches">
          <button
            type="button"
            className={`swatch swatch--default${isDefault ? ' swatch--active' : ''}`}
            style={{ background: defaultSwatch.background, borderColor: defaultSwatch.border }}
            title="Default"
            onClick={onSelectDefault}
          />
        </div>
      </div>
      {inDiagram.length > 0 && (
        <div className="colorpick__section">
          <div className="colorpick__label">In this diagram</div>
          <div className="colorpick__swatches">
            {inDiagram.map((c) => (
              <Swatch
                key={c}
                color={c}
                active={!isDefault && c === cur}
                onClick={() => onChange(c)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="colorpick__section">
        <div className="colorpick__label">Palette</div>
        <div className="colorpick__swatches">
          {PALETTE.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={!isDefault && c.toLowerCase() === cur}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </div>
      <div className="colorpick__custom">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="Custom color"
        />
      </div>
    </div>
  )
}
