// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPicker } from './ColorPicker'
import { SCHEMES } from './schemes'

afterEach(cleanup)

const props = (over: Partial<React.ComponentProps<typeof ColorPicker>> = {}) => ({
  value: '#3b82f6',
  diagramColors: [],
  onChange: () => {},
  ...over,
})

describe('ColorPicker', () => {
  it('renders one swatch per scheme, with no separate default section', () => {
    const { container } = render(<ColorPicker {...props()} />)
    expect(container.querySelectorAll('.colorpick__swatches .swatch--scheme').length).toBe(
      Object.keys(SCHEMES).length,
    )
    expect(container.querySelector('.swatch--default')).toBeNull()
  })

  it('marks exactly the selected scheme active', () => {
    const { container } = render(<ColorPicker {...props({ value: 'blue' })} />)
    const active = container.querySelectorAll('.swatch--active')
    expect(active.length).toBe(1)
    expect(active[0].getAttribute('title')).toBe('blue')
  })

  it('renders a Default swatch when defaultSwatch/onSelectDefault are supplied, and calls onSelectDefault when clicked', async () => {
    const user = userEvent.setup()
    const onSelectDefault = vi.fn()
    const { container } = render(
      <ColorPicker
        {...props()}
        defaultSwatch={{ background: '#3b82f6', border: '#3b82f6' }}
        isDefault={false}
        onSelectDefault={onSelectDefault}
      />,
    )
    const defaultSwatch = container.querySelector('.swatch--default')
    expect(defaultSwatch).not.toBeNull()
    await user.click(defaultSwatch as HTMLElement)
    expect(onSelectDefault).toHaveBeenCalledTimes(1)
  })
})
