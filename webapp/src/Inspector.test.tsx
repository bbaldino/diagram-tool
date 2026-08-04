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

// There must be no "default" as a named or special-cased thing anywhere in
// the picker or the panels that host it — no Default swatch, no separate
// Default section, no reset control — for any of the four entity kinds that
// use ColorPicker (note, service node, group, edge).
describe('Inspector has no default swatch/section/reset', () => {
  it('renders no .swatch--default for a note, a service node, a group, or an edge', () => {
    const cases = [
      <Inspector key="note" {...baseProps} node={noteNode()} onNodeData={() => {}} />,
      <Inspector key="svc" {...baseProps} node={serviceNode()} onNodeData={() => {}} />,
      <Inspector key="group" {...baseProps} node={groupNode('#3b82f6')} onNodeData={() => {}} />,
      <Inspector
        key="edge"
        {...baseProps}
        node={null}
        edge={edgeWith('#3b82f6')}
        onNodeData={() => {}}
      />,
    ]
    for (const el of cases) {
      const { container, unmount } = render(el)
      expect(container.querySelector('.swatch--default')).toBeNull()
      expect(container.querySelector('.colorpick__label')?.textContent).not.toBe('Default')
      unmount()
    }
  })

  it('offers no reset affordance anywhere in the picker', () => {
    render(<Inspector {...baseProps} node={serviceNode('blue')} onNodeData={() => {}} />)
    expect(screen.queryByText('reset')).toBeNull()
  })
})
