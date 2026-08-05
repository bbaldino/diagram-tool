// Flows: the per-diagram walkthroughs, their edit/play mode, and the mapping
// from an element id to its highlight class for the current step.
//
// Extracted from Flow() in App.tsx. This is a feature that happened to live
// inside the canvas component rather than part of the canvas machinery — it
// reads and writes the model and barely touches canvas state, which is what
// made it the next safe piece to lift out.
//
// Deliberately NOT included: the effect that paints flowClassOf's result onto
// the live nodes and edges. That one calls setNodes/setEdges and belongs with
// the canvas; it consumes flowClassOf from here.
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import * as M from '../shared/model'
import type { Diagram, Flow, Model } from '../shared/model'
import { newId } from '../shared/ids'
import { flowStates } from './flowState'

export type FlowMode = 'none' | 'edit' | 'play'

interface Options {
  model: Model
  setModel: Dispatch<SetStateAction<Model>>
  activeId: string | null
  active: Diagram | undefined
  showPrompt: (opts: {
    title: string
    label: string
    defaultValue?: string
  }) => Promise<string | null>
  // `railVisible && railTab === 'flows'` collapsed to the one thing this cares
  // about. Editing a flow only lights the canvas WHILE the Flows tab is
  // showing — otherwise selecting a flow left the diagram stuck dimmed with no
  // way back to normal — and canvas clicks only toggle step membership under
  // the same condition.
  flowsTabVisible: boolean
}

export interface FlowPlayback {
  flowMode: FlowMode
  setFlowMode: Dispatch<SetStateAction<FlowMode>>
  currentFlowId: string | null
  currentFlow: Flow | null
  currentStep: number
  setCurrentStep: Dispatch<SetStateAction<number>>
  selStep: number
  setSelStep: Dispatch<SetStateAction<number>>
  /** Highlight class for an element in the current flow/step, or undefined for
   *  normal rendering. Consumed by both the re-seed and the re-tag effect. */
  flowClassOf: (id: string) => string | undefined
  selectFlow: (id: string | null) => void
  createFlow: () => Promise<void>
  renameFlowById: (id: string) => Promise<void>
  deleteFlowById: (id: string) => void
  duplicateFlow: (id: string) => void
  toggleInStep: (elementId: string) => void
}

export function useFlowPlayback({
  model,
  setModel,
  activeId,
  active,
  showPrompt,
  flowsTabVisible,
}: Options): FlowPlayback {
  // Client-only, never persisted in the model.
  const [flowMode, setFlowMode] = useState<FlowMode>('none')
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [selStep, setSelStep] = useState(0)

  const currentFlow = useMemo(
    () => active?.flows?.find((f) => f.id === currentFlowId) ?? null,
    [active, currentFlowId],
  )

  const flowClassOf = useCallback(
    (id: string): string | undefined => {
      // The walkthrough (play) owns the canvas, so it always lights up.
      // Editing only lights up while the Flows tab is visible — see
      // flowsTabVisible above.
      const lit = flowMode === 'play' || (flowMode === 'edit' && flowsTabVisible)
      if (!lit || !currentFlow) return undefined
      const activeStep = flowMode === 'edit' ? selStep : currentStep
      const s = flowStates(currentFlow, activeStep)[id]
      return s === 'active' ? 'flow-active' : s === 'lit' ? 'flow-lit' : 'flow-ghost'
    },
    [flowMode, currentFlow, currentStep, selStep, flowsTabVisible],
  )

  const selectFlow = useCallback((id: string | null) => {
    setCurrentFlowId(id)
    setFlowMode(id ? 'edit' : 'none')
    setCurrentStep(0)
    setSelStep(0)
  }, [])

  const createFlow = useCallback(async () => {
    if (!model || !activeId) return
    const name = await showPrompt({ title: 'New flow', label: 'Name', defaultValue: 'Flow' })
    if (!name) return
    const id = newId()
    setModel((m) => M.addFlow(m, activeId, { id, name, steps: [] }))
    setCurrentFlowId(id)
    setFlowMode('edit')
    setSelStep(0)
    setCurrentStep(0)
  }, [model, activeId, setModel, showPrompt])

  const renameFlowById = useCallback(
    async (id: string) => {
      const f = active?.flows?.find((x) => x.id === id)
      if (!f || !activeId) return
      const name = await showPrompt({ title: 'Rename flow', label: 'Name', defaultValue: f.name })
      if (name) setModel((m) => M.updateFlow(m, activeId, id, { name }))
    },
    [active, activeId, setModel, showPrompt],
  )

  const deleteFlowById = useCallback(
    (id: string) => {
      if (!activeId) return
      setModel((m) => M.removeFlow(m, activeId, id))
      if (currentFlowId === id) {
        setCurrentFlowId(null)
        setFlowMode('none')
      }
    },
    [activeId, currentFlowId, setModel],
  )

  const duplicateFlow = useCallback(
    (id: string) => {
      if (!activeId) return
      const f = active?.flows?.find((x) => x.id === id)
      if (!f) return
      const copyId = newId()
      const steps = f.steps.map((s) => ({ ...s, id: newId() }))
      setModel((m) => M.addFlow(m, activeId, { id: copyId, name: `${f.name} copy`, steps }))
      selectFlow(copyId)
    },
    [activeId, active, setModel, selectFlow],
  )

  const toggleInStep = useCallback(
    (elementId: string) => {
      // Canvas clicks only toggle step membership while actively editing a flow
      // in the visible Flows tab; otherwise a node/edge click selects normally.
      if (flowMode !== 'edit' || !currentFlow || !activeId || !flowsTabVisible) return
      if (!currentFlow.steps[selStep]) return
      const steps = currentFlow.steps.map((s, i) =>
        i !== selStep
          ? s
          : {
              ...s,
              elementIds: s.elementIds.includes(elementId)
                ? s.elementIds.filter((x) => x !== elementId)
                : [...s.elementIds, elementId],
            },
      )
      setModel((m) => M.updateFlow(m, activeId, currentFlow.id, { steps }))
    },
    [flowMode, currentFlow, activeId, selStep, setModel, flowsTabVisible],
  )

  return {
    flowMode,
    setFlowMode,
    currentFlowId,
    currentFlow,
    currentStep,
    setCurrentStep,
    selStep,
    setSelStep,
    flowClassOf,
    selectFlow,
    createFlow,
    renameFlowById,
    deleteFlowById,
    duplicateFlow,
    toggleInStep,
  }
}
