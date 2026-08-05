// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemePicker } from './SchemePicker'
import { SCHEMES } from '../shared/schemes'

afterEach(cleanup)

const props = (over: Partial<React.ComponentProps<typeof SchemePicker>> = {}) => ({
  value: 'paper',
  diagramSchemes: [],
  onChange: () => {},
  ...over,
})

describe('SchemePicker', () => {
  it('renders one swatch per scheme', () => {
    const { container } = render(<SchemePicker {...props()} />)
    expect(container.querySelectorAll('.swatch--scheme').length).toBe(Object.keys(SCHEMES).length)
  })

  // The user's central requirement: a node or note always has a scheme, so
  // there is no absence to return to and nothing to reset. Picking `paper` is
  // how you get the plain white card.
  it('has no default swatch, section or reset', () => {
    const { container } = render(<SchemePicker {...props()} />)
    expect(container.querySelector('.swatch--default')).toBeNull()
    expect(container.textContent).not.toMatch(/default|reset/i)
  })

  it('marks exactly one swatch active, even when that scheme is also used in the diagram', () => {
    const { container } = render(<SchemePicker {...props({ diagramSchemes: ['paper'] })} />)
    const active = container.querySelectorAll('.swatch--active')
    expect(active.length).toBe(1)
    expect(active[0].getAttribute('title')).toBe('paper')
  })

  it('lists a custom hex used in the diagram, but not names already in the palette', () => {
    const { container } = render(
      <SchemePicker {...props({ diagramSchemes: ['#7c3aed', 'blue'] })} />,
    )
    const titles = [...container.querySelectorAll('.swatch')].map((s) => s.getAttribute('title'))
    expect(titles.filter((t) => t === '#7c3aed').length).toBe(1)
    expect(titles.filter((t) => t === 'blue').length).toBe(1) // the palette one only
  })

  it('emits the scheme name, not a rendered colour', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<SchemePicker {...props({ onChange })} />)
    const blue = [...container.querySelectorAll('.swatch--scheme')].find(
      (s) => s.getAttribute('title') === 'blue',
    )
    await user.click(blue as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('blue')
  })
})
