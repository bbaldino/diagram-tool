// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPicker } from './ColorPicker'

afterEach(cleanup)

const props = (over: Partial<React.ComponentProps<typeof ColorPicker>> = {}) => ({
  value: '#3b82f6',
  diagramColors: [],
  onChange: () => {},
  defaultSwatch: { background: '#ffffff', border: '#cbd5e1' },
  isDefault: false,
  onSelectDefault: () => {},
  ...over,
})

describe('ColorPicker default swatch', () => {
  it('renders a default swatch showing the entity default appearance', () => {
    const { container } = render(<ColorPicker {...props()} />)
    const sw = container.querySelector('.swatch--default') as HTMLElement
    expect(sw).not.toBeNull()
    expect(sw.style.background).toBe('rgb(255, 255, 255)')
    expect(sw.style.borderColor).toBe('rgb(203, 213, 225)')
  })

  it('marks the default swatch active when the entity has no colour', () => {
    const { container } = render(<ColorPicker {...props({ isDefault: true })} />)
    expect(container.querySelector('.swatch--default')?.className).toContain('swatch--active')
  })

  it('does not mark it active when the entity has a colour', () => {
    const { container } = render(<ColorPicker {...props({ isDefault: false })} />)
    expect(container.querySelector('.swatch--default')?.className).not.toContain('swatch--active')
  })

  it('calls onSelectDefault when clicked, not onChange', async () => {
    const user = userEvent.setup()
    const onSelectDefault = vi.fn()
    const onChange = vi.fn()
    const { container } = render(<ColorPicker {...props({ onSelectDefault, onChange })} />)
    await user.click(container.querySelector('.swatch--default') as HTMLElement)
    expect(onSelectDefault).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('no longer renders a reset control', () => {
    const { container } = render(<ColorPicker {...props()} />)
    const reset = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'reset',
    )
    expect(reset).toBeUndefined()
  })

  // A palette (or "in this diagram") swatch that happens to equal the
  // fallback `value` used for an uncoloured entity must NOT double-highlight
  // alongside the Default swatch — active-ness of those swatches has to be
  // gated on `!isDefault`, not just on a value match. A `value` outside the
  // palette would pass without the fix, which is why this uses '#64748b' —
  // it is both the fallback value AND a PALETTE entry.
  it('marks only the Default swatch active when isDefault is true, even if value matches a palette entry', () => {
    const { container } = render(
      <ColorPicker {...props({ value: '#64748b', isDefault: true, diagramColors: ['#64748b'] })} />,
    )
    const active = container.querySelectorAll('.swatch--active')
    expect(active.length).toBe(1)
    expect(active[0].className).toContain('swatch--default')
  })
})
