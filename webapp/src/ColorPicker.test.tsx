// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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
})
