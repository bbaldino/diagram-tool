export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { checked, onChange, label } = props
  return (
    <label className="insp__switch-row">
      <span>{label}</span>
      <span className="insp__switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className="insp__switch-track" />
        <span className="insp__switch-knob" />
      </span>
    </label>
  )
}
