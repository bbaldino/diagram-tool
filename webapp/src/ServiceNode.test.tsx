// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import type { ServiceNode as ServiceNodeType } from './canvasData'
import { ServiceNode } from './nodes'
import { SCHEMES, secondaryText, accentFill } from './schemes'

afterEach(cleanup)

describe('ServiceNode colour', () => {
  it('renders the starting scheme when the entity has that scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode
          {...({
            id: 's1',
            data: { label: 'Plex', scheme: 'paper' },
            selected: false,
          } as unknown as NodeProps<ServiceNodeType>)}
        />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.style.getPropertyValue('--scheme-bg')).toBe('#ffffff')
    expect(card.style.getPropertyValue('--scheme-border')).toBe('#cbd5e1')
    expect(card.style.getPropertyValue('--scheme-text')).toBe('#1f2937')
    expect(card.style.getPropertyValue('--scheme-text-2')).toBe(secondaryText(SCHEMES.paper))
    expect(card.style.getPropertyValue('--scheme-accent')).toBe(accentFill(SCHEMES.paper))
  })

  it('renders a named scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode
          {...({
            id: 's1',
            data: { label: 'Plex', scheme: 'blue' },
            selected: false,
          } as unknown as NodeProps<ServiceNodeType>)}
        />
      </ReactFlowProvider>,
    )
    expect(
      (container.querySelector('.node') as HTMLElement).style.getPropertyValue('--scheme-bg'),
    ).toBe('#e2ecfe')
  })

  it('has no tinted/accented modifier class — every node renders one way', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode
          {...({
            id: 's1',
            data: { label: 'Plex', scheme: 'blue' },
            selected: false,
          } as unknown as NodeProps<ServiceNodeType>)}
        />
      </ReactFlowProvider>,
    )
    const card = container.querySelector('.node') as HTMLElement
    expect(card.classList.contains('node--tinted')).toBe(false)
    expect(card.classList.contains('node--accented')).toBe(false)
  })

  it('falls back to the starting scheme for an unknown value rather than rendering unstyled', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode
          {...({
            id: 's1',
            data: { label: 'Plex', scheme: 'nonsense' },
            selected: false,
          } as unknown as NodeProps<ServiceNodeType>)}
        />
      </ReactFlowProvider>,
    )
    expect(
      (container.querySelector('.node') as HTMLElement).style.getPropertyValue('--scheme-bg'),
    ).toBe('#ffffff')
  })

  it('keeps the label visible', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ServiceNode
          {...({
            id: 's1',
            data: { label: 'Plex', scheme: 'blue' },
            selected: false,
          } as unknown as NodeProps<ServiceNodeType>)}
        />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.node__label')?.textContent).toBe('Plex')
  })
})
