// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowPlayback } from './useFlowPlayback'
import type { Diagram, Model } from '../shared/model'

const flow = (id: string, name: string, elementIds: string[] = []) => ({
  id,
  name,
  steps: [{ id: `${id}-s1`, elementIds }],
})

const makeModel = (flows = [flow('f1', 'Boot', ['n1'])]): Model =>
  ({
    version: 2,
    templates: [],
    diagrams: [
      {
        id: 'd1',
        name: 'D',
        title: 'D',
        type: 'canvas',
        nodes: [],
        groups: [],
        edges: [],
        notes: [],
        flows,
      },
    ],
  }) as unknown as Model

// Drives the hook against a live model the way Flow() does: setModel updates
// state, and `active` is recomputed from it, so a handler's write is visible to
// the next assertion.
function harness(
  initial: Model = makeModel(),
  opts: { flowsTabVisible?: boolean; prompt?: string | null } = {},
) {
  const showPrompt = vi.fn(async () => (opts.prompt === undefined ? 'Named' : opts.prompt))
  let model = initial
  const { result, rerender } = renderHook(
    ({ m }: { m: Model }) =>
      useFlowPlayback({
        model: m,
        setModel: ((fn: (p: Model) => Model) => {
          model = typeof fn === 'function' ? fn(model) : fn
          queueMicrotask(() => rerender({ m: model }))
        }) as never,
        activeId: 'd1',
        active: m.diagrams[0] as Diagram,
        showPrompt,
        flowsTabVisible: opts.flowsTabVisible ?? true,
      }),
    { initialProps: { m: initial } },
  )
  return { result, showPrompt, model: () => model, sync: () => rerender({ m: model }) }
}

describe('selectFlow', () => {
  it('selects a flow and enters edit mode', () => {
    const { result } = harness()
    act(() => result.current.selectFlow('f1'))
    expect(result.current.currentFlowId).toBe('f1')
    expect(result.current.flowMode).toBe('edit')
    expect(result.current.currentFlow?.name).toBe('Boot')
  })

  it('clearing the selection leaves no flow and no mode', () => {
    const { result } = harness()
    act(() => result.current.selectFlow('f1'))
    act(() => result.current.selectFlow(null))
    expect(result.current.currentFlowId).toBeNull()
    expect(result.current.flowMode).toBe('none')
    expect(result.current.currentFlow).toBeNull()
  })

  it('resets both step counters, so a stale index cannot leak across flows', () => {
    const { result } = harness()
    act(() => result.current.selectFlow('f1'))
    act(() => {
      result.current.setCurrentStep(3)
      result.current.setSelStep(4)
    })
    act(() => result.current.selectFlow(null))
    expect(result.current.currentStep).toBe(0)
    expect(result.current.selStep).toBe(0)
  })
})

describe('flowClassOf', () => {
  it('returns undefined when no flow is selected', () => {
    const { result } = harness()
    expect(result.current.flowClassOf('n1')).toBeUndefined()
  })

  // The bug this rule fixed: selecting a flow then switching to the Inspector
  // left the canvas stuck dimmed with no way back to normal.
  it('does not light the canvas while editing if the Flows tab is hidden', () => {
    const { result } = harness(makeModel(), { flowsTabVisible: false })
    act(() => result.current.selectFlow('f1'))
    expect(result.current.flowClassOf('n1')).toBeUndefined()
  })

  it('lights the canvas while editing when the Flows tab is visible', () => {
    const { result } = harness()
    act(() => result.current.selectFlow('f1'))
    expect(result.current.flowClassOf('n1')).toBe('flow-active')
  })

  // Play mode owns the canvas, so the rail state must not gate it.
  it('lights the canvas in play mode even with the Flows tab hidden', () => {
    const { result } = harness(makeModel(), { flowsTabVisible: false })
    act(() => result.current.selectFlow('f1'))
    act(() => result.current.setFlowMode('play'))
    expect(result.current.flowClassOf('n1')).toBe('flow-active')
  })

  it('marks an element outside the step as ghosted', () => {
    const { result } = harness()
    act(() => result.current.selectFlow('f1'))
    expect(result.current.flowClassOf('not-in-any-step')).toBe('flow-ghost')
  })
})

describe('toggleInStep', () => {
  it('adds an element that is not yet in the step', async () => {
    const h = harness(makeModel([flow('f1', 'Boot', [])]))
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.toggleInStep('n9'))
    expect(h.model().diagrams[0]!.flows![0]!.steps[0]!.elementIds).toEqual(['n9'])
  })

  it('removes an element already in the step', () => {
    const h = harness(makeModel([flow('f1', 'Boot', ['n1'])]))
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.toggleInStep('n1'))
    expect(h.model().diagrams[0]!.flows![0]!.steps[0]!.elementIds).toEqual([])
  })

  it('does nothing when the Flows tab is hidden — a canvas click should select, not toggle', () => {
    const h = harness(makeModel([flow('f1', 'Boot', [])]), { flowsTabVisible: false })
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.toggleInStep('n9'))
    expect(h.model().diagrams[0]!.flows![0]!.steps[0]!.elementIds).toEqual([])
  })

  it('does nothing in play mode', () => {
    const h = harness(makeModel([flow('f1', 'Boot', [])]))
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.setFlowMode('play'))
    act(() => h.result.current.toggleInStep('n9'))
    expect(h.model().diagrams[0]!.flows![0]!.steps[0]!.elementIds).toEqual([])
  })
})

describe('createFlow', () => {
  it('adds the flow, selects it and enters edit mode', async () => {
    const h = harness(makeModel([]))
    await act(async () => await h.result.current.createFlow())
    expect(h.model().diagrams[0]!.flows).toHaveLength(1)
    expect(h.model().diagrams[0]!.flows![0]!.name).toBe('Named')
    expect(h.result.current.flowMode).toBe('edit')
  })

  it('adds nothing when the prompt is cancelled', async () => {
    const h = harness(makeModel([]), { prompt: null })
    await act(async () => await h.result.current.createFlow())
    expect(h.model().diagrams[0]!.flows).toHaveLength(0)
  })
})

describe('renameFlowById', () => {
  it('prompts with the current name and applies the new one', async () => {
    const h = harness()
    await act(async () => await h.result.current.renameFlowById('f1'))
    expect(h.showPrompt).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'Boot' }))
    expect(h.model().diagrams[0]!.flows![0]!.name).toBe('Named')
  })

  it('leaves the name alone when cancelled', async () => {
    const h = harness(makeModel(), { prompt: null })
    await act(async () => await h.result.current.renameFlowById('f1'))
    expect(h.model().diagrams[0]!.flows![0]!.name).toBe('Boot')
  })
})

describe('deleteFlowById', () => {
  it('removes the flow', () => {
    const h = harness()
    act(() => h.result.current.deleteFlowById('f1'))
    expect(h.model().diagrams[0]!.flows).toHaveLength(0)
  })

  it('clears the selection when the deleted flow was the current one', () => {
    const h = harness()
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.deleteFlowById('f1'))
    expect(h.result.current.currentFlowId).toBeNull()
    expect(h.result.current.flowMode).toBe('none')
  })

  it('keeps the selection when a different flow is deleted', () => {
    const h = harness(makeModel([flow('f1', 'Boot'), flow('f2', 'Other')]))
    act(() => h.result.current.selectFlow('f1'))
    act(() => h.result.current.deleteFlowById('f2'))
    expect(h.result.current.currentFlowId).toBe('f1')
    expect(h.result.current.flowMode).toBe('edit')
  })
})

describe('duplicateFlow', () => {
  it('copies the flow under a new name and selects the copy', () => {
    const h = harness()
    act(() => h.result.current.duplicateFlow('f1'))
    const flows = h.model().diagrams[0]!.flows!
    expect(flows).toHaveLength(2)
    expect(flows[1]!.name).toBe('Boot copy')
    expect(h.result.current.currentFlowId).toBe(flows[1]!.id)
  })

  // Sharing step ids between the original and the copy would make an edit to
  // one silently affect the other.
  it('gives the copy fresh step ids', () => {
    const h = harness()
    act(() => h.result.current.duplicateFlow('f1'))
    const [orig, copy] = h.model().diagrams[0]!.flows!
    expect(copy!.id).not.toBe(orig!.id)
    expect(copy!.steps[0]!.id).not.toBe(orig!.steps[0]!.id)
    expect(copy!.steps[0]!.elementIds).toEqual(orig!.steps[0]!.elementIds)
  })
})
