// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPicker, PALETTE } from './ColorPicker'
import { SCHEMES } from './schemes'

afterEach(cleanup)

// ColorPicker is the plain-hex picker, used only by the edge and group panels.
// Nodes and notes use SchemePicker instead — see SchemePicker.test.tsx.
const props = (over: Partial<React.ComponentProps<typeof ColorPicker>> = {}) => ({
  value: '#3b82f6',
  diagramColors: [],
  onChange: () => {},
  defaultSwatch: { background: '#64748b', border: '#64748b' },
  isDefault: false,
  onSelectDefault: () => {},
  ...over,
})

describe('ColorPicker', () => {
  it('renders the full hex palette', () => {
    const { container } = render(<ColorPicker {...props()} />)
    expect(
      container.querySelectorAll('.colorpick__swatches .swatch').length,
    ).toBeGreaterThanOrEqual(PALETTE.length)
  })

  it('never offers a scheme name — every value it can emit is a hex', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <ColorPicker {...props({ diagramColors: ['#10b981'], onChange })} />,
    )
    const swatches = [...container.querySelectorAll('.swatch:not(.swatch--default)')]
    for (const s of swatches) await user.click(s as HTMLElement)
    expect(onChange).toHaveBeenCalled()
    const names = Object.keys(SCHEMES)
    for (const [emitted] of onChange.mock.calls) {
      expect(emitted).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(names).not.toContain(emitted)
    }
  })

  it('renders a Default swatch and calls onSelectDefault when clicked', async () => {
    const user = userEvent.setup()
    const onSelectDefault = vi.fn()
    const { container } = render(<ColorPicker {...props({ onSelectDefault })} />)
    const defaultSwatch = container.querySelector('.swatch--default')
    expect(defaultSwatch).not.toBeNull()
    await user.click(defaultSwatch as HTMLElement)
    expect(onSelectDefault).toHaveBeenCalledTimes(1)
  })
})
