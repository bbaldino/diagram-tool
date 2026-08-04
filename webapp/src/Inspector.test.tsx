// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'

afterEach(cleanup)

const baseProps = {
  edge: null,
  groups: [],
  onNodeParent: () => {},
  onEdge: () => {},
  diagramColors: [],
  onShrink: () => {},
  onGroupSize: () => {},
  onDelete: () => {},
  fields: [],
  onFieldShow: () => {},
}

const noteNode = (color?: string) =>
  ({ id: 'n1', type: 'note', data: { text: 'hi', color } }) as never
const serviceNode = (color?: string) =>
  ({ id: 's1', type: 'service', data: { label: 'Plex', color } }) as never

describe('Inspector colour', () => {
  it('offers a colour picker for a note and writes the chosen hex', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={onNodeData} />,
    )
    const swatch = container.querySelector(
      '.colorpick .swatch:not(.swatch--default)',
    ) as HTMLElement
    expect(swatch).not.toBeNull()
    await user.click(swatch)
    expect(onNodeData).toHaveBeenCalledWith({ color: expect.stringMatching(/^#[0-9a-f]{6}$/i) })
  })

  it('offers a colour picker for a service node', () => {
    const { container } = render(
      <Inspector {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.colorpick')).not.toBeNull()
  })

  it('does not offer a reset affordance for a coloured note', () => {
    render(<Inspector {...baseProps} node={noteNode('#3b82f6')} onNodeData={() => {}} />)
    expect(screen.queryByText('reset')).toBeNull()
  })

  it('does not offer a reset affordance for a coloured service node', () => {
    render(<Inspector {...baseProps} node={serviceNode('#3b82f6')} onNodeData={() => {}} />)
    expect(screen.queryByText('reset')).toBeNull()
  })

  it('uses the shared picker for groups instead of a raw colour input', () => {
    const group = { id: 'g1', type: 'group', data: { label: 'Media', color: '#64748b' } } as never
    const { container } = render(<Inspector {...baseProps} node={group} onNodeData={() => {}} />)
    expect(container.querySelector('.colorpick')).not.toBeNull()
    expect(container.querySelector('input[type="color"].insp__rawcolor')).toBeNull()
  })

  it('still offers a Default affordance for a coloured group and sets it to the default slate hex', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const group = { id: 'g1', type: 'group', data: { label: 'Media', color: '#3b82f6' } } as never
    const { container } = render(<Inspector {...baseProps} node={group} onNodeData={onNodeData} />)
    await user.click(container.querySelector('.swatch--default') as HTMLElement)
    expect(onNodeData).toHaveBeenCalledWith({ color: '#64748b' })
  })

  it('marks only the Default swatch active for an uncoloured note', () => {
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.swatch--active:not(.swatch--default)')).toBeNull()
    expect(container.querySelector('.swatch--default.swatch--active')).not.toBeNull()
  })

  it('marks the yellow swatch active for a note explicitly coloured yellow', () => {
    const { container } = render(
      <Inspector {...baseProps} node={noteNode('#eab308')} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.swatch--active')).not.toBeNull()
  })

  it('does not offer a reset affordance for a coloured edge', () => {
    const edge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      data: { rel: 'talks-to', color: '#3b82f6' },
    } as never
    render(<Inspector {...baseProps} node={null} edge={edge} onNodeData={() => {}} />)
    expect(screen.queryByText('reset')).toBeNull()
  })
})

describe('Inspector default swatch', () => {
  const defaultSwatchOf = (c: HTMLElement) => c.querySelector('.swatch--default') as HTMLElement

  it('shows Default active for an uncoloured note and clears when clicked', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={onNodeData} />,
    )
    expect(defaultSwatchOf(container).className).toContain('swatch--active')
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: undefined })
  })

  it('shows Default inactive for a coloured note', () => {
    const { container } = render(
      <Inspector {...baseProps} node={noteNode('#3b82f6')} onNodeData={() => {}} />,
    )
    expect(defaultSwatchOf(container).className).not.toContain('swatch--active')
  })

  it('clears a service node colour when Default is clicked', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={serviceNode('#10b981')} onNodeData={onNodeData} />,
    )
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: undefined })
  })

  it('SETS the default hex for a group rather than clearing, since Group.color is required', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const group = { id: 'g1', type: 'group', data: { label: 'Media', color: '#3b82f6' } } as never
    const { container } = render(<Inspector {...baseProps} node={group} onNodeData={onNodeData} />)
    await user.click(defaultSwatchOf(container))
    expect(onNodeData).toHaveBeenCalledWith({ color: '#64748b' })
  })
})
