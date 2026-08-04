// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { ServiceNode } from './nodes'

afterEach(cleanup)

const props = (color?: string): NodeProps =>
  ({ id: 's1', data: { label: 'Plex', color }, selected: false }) as unknown as NodeProps

describe('ServiceNode colour', () => {
  it('applies the accent modifier and custom property when a colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props('#10b981')} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--tinted')).toBe(true)
    expect(card.style.getPropertyValue('--node-color')).toBe('#10b981')
  })

  it('renders exactly as before when no colour is set', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props()} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--tinted')).toBe(false)
    expect(card.style.getPropertyValue('--node-color')).toBe('')
  })

  it('keeps the label visible when accented', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props('#10b981')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.node__label')?.textContent).toBe('Plex')
  })

  it('drops the accent-bar treatment in favour of a tint', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode {...props('#10b981')} />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    // The tint replaces the bar rather than layering on top of it.
    expect(card.classList.contains('node--accented')).toBe(false)
    expect(card.classList.contains('node--tinted')).toBe(true)
  })
})
