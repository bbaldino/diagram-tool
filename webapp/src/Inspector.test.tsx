// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'
import { NEW_NODE_SCHEME, NEW_NOTE_SCHEME } from './schemes'

afterEach(cleanup)

const baseProps = {
  edge: null,
  groups: [],
  onNodeParent: () => {},
  onEdge: () => {},
  diagramColors: [],
  diagramSchemes: [],
  onShrink: () => {},
  onGroupSize: () => {},
  onDelete: () => {},
  fields: [],
  onFieldShow: () => {},
}

const noteNode = (scheme?: string) =>
  ({ id: 'n1', type: 'note', data: { text: 'hi', scheme } }) as never
const serviceNode = (scheme?: string) =>
  ({ id: 's1', type: 'service', data: { label: 'Plex', scheme } }) as never
const groupNode = (color?: string) =>
  ({ id: 'g1', type: 'group', data: { label: 'Media', color } }) as never
const edgeWith = (color?: string) =>
  ({ id: 'e1', source: 'a', target: 'b', data: { rel: 'talks-to', color } }) as never

describe('Inspector colour', () => {
  it('offers a colour picker for a note and writes the chosen scheme', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={onNodeData} />,
    )
    const swatch = container.querySelector('.colorpick .swatch--scheme') as HTMLElement
    expect(swatch).not.toBeNull()
    await user.click(swatch)
    expect(onNodeData).toHaveBeenCalledWith({ scheme: expect.any(String) })
  })

  it('offers a colour picker for a service node', () => {
    const { container } = render(
      <Inspector {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.colorpick')).not.toBeNull()
  })

  it('uses the shared picker for groups instead of a raw colour input', () => {
    const { container } = render(
      <Inspector {...baseProps} node={groupNode('#64748b')} onNodeData={() => {}} />,
    )
    expect(container.querySelector('.colorpick')).not.toBeNull()
    expect(container.querySelector('input[type="color"].insp__rawcolor')).toBeNull()
  })

  it('defaults an uncoloured note to the sticky scheme and a service node to the paper scheme', () => {
    const { container: noteC } = render(
      <Inspector {...baseProps} node={noteNode()} onNodeData={() => {}} />,
    )
    const noteActive = noteC.querySelector('.swatch--active')
    expect(noteActive?.getAttribute('title')).toBe(NEW_NOTE_SCHEME)

    const { container: svcC } = render(
      <Inspector {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
    )
    const svcActive = svcC.querySelector('.swatch--active')
    expect(svcActive?.getAttribute('title')).toBe(NEW_NODE_SCHEME)
  })

  it('marks the blue swatch active for a note explicitly set to the blue scheme', () => {
    const { container } = render(
      <Inspector {...baseProps} node={noteNode('blue')} onNodeData={() => {}} />,
    )
    const active = container.querySelector('.swatch--active')
    expect(active?.getAttribute('title')).toBe('blue')
  })
})

// Finding 1 (fix round 2): the edge and group colour pickers must only ever
// see plain hexes. A scheme name belonging to some other node/note in the
// diagram must never leak into their quick-pick list or reach onEdge/onNodeData.
describe('Inspector keeps scheme names out of the edge and group colour pickers', () => {
  it('never shows a scheme name as a swatch in the edge panel, even when the diagram also has a paper node', async () => {
    const user = userEvent.setup()
    const onEdge = vi.fn()
    // Simulates a diagram that also contains a `paper` node: `diagramColors`
    // (edges/groups only) stays plain hex, but `diagramSchemes` (notes/service
    // nodes) carries the scheme name — and must never reach the edge panel.
    const { container } = render(
      <Inspector
        {...baseProps}
        node={null}
        edge={edgeWith('#3b82f6')}
        onEdge={onEdge}
        onNodeData={() => {}}
        diagramColors={['#22c55e']}
        diagramSchemes={['paper']}
      />,
    )
    const swatches = Array.from(container.querySelectorAll('.colorpick .swatch'))
    expect(swatches.some((s) => s.getAttribute('title') === 'paper')).toBe(false)

    // More directly: clicking through every swatch in the edge picker can
    // never hand onEdge a non-hex value.
    for (const swatch of swatches) {
      await user.click(swatch as HTMLElement)
    }
    for (const call of onEdge.mock.calls) {
      const color = (call[0] as { color?: string }).color
      if (color !== undefined) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })
})

// Nodes and notes now always have a scheme — there is no absence, so a
// "default" swatch would just be a second name for paper/sticky. That was
// rejected and stays rejected. No Default swatch, no separate Default
// section, no reset control for either of these two entity kinds.
describe('Inspector has no default swatch/section/reset for nodes and notes', () => {
  it('renders no .swatch--default for a note or a service node', () => {
    const cases = [
      <Inspector key="note" {...baseProps} node={noteNode()} onNodeData={() => {}} />,
      <Inspector key="svc" {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
    ]
    for (const el of cases) {
      const { container, unmount } = render(el)
      expect(container.querySelector('.swatch--default')).toBeNull()
      expect(container.querySelector('.colorpick__label')?.textContent).not.toBe('Default')
      unmount()
    }
  })

  it('offers no reset affordance in the service-node colour picker', () => {
    render(<Inspector {...baseProps} node={serviceNode('blue')} onNodeData={() => {}} />)
    expect(screen.queryByText('reset')).toBeNull()
  })
})

// Edges and groups are different: an edge with no colour follows its
// relationship type (which can change later), and a group's colour field is
// required. Both need a real reset affordance, which is not the same thing
// as the node/note "default" above.
describe('Inspector keeps the edge and group reset', () => {
  it('renders a Default swatch for the edge panel and resets to the relationship colour on click', async () => {
    const user = userEvent.setup()
    const onEdge = vi.fn()
    const { container } = render(
      <Inspector
        {...baseProps}
        node={null}
        edge={edgeWith('#3b82f6')}
        onEdge={onEdge}
        onNodeData={() => {}}
      />,
    )
    const defaultSwatch = container.querySelector('.swatch--default')
    expect(defaultSwatch).not.toBeNull()
    await user.click(defaultSwatch as HTMLElement)
    expect(onEdge).toHaveBeenCalledWith({ color: undefined })
  })

  it('renders a Default swatch for the group panel and resets to slate on click', async () => {
    const user = userEvent.setup()
    const onNodeData = vi.fn()
    const { container } = render(
      <Inspector {...baseProps} node={groupNode('#3b82f6')} onNodeData={onNodeData} />,
    )
    const defaultSwatch = container.querySelector('.swatch--default')
    expect(defaultSwatch).not.toBeNull()
    await user.click(defaultSwatch as HTMLElement)
    expect(onNodeData).toHaveBeenCalledWith({ color: '#64748b' })
  })
})
