import { useEffect } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { resolveLabelPlacements, type LabelInput, type Rect } from './labelDeoverlap'
import { setLabelPlacements } from './labelPlacement'

// Canvas-level: after pathfinding edges render, measure every unpinned smart-edge
// label and spread overlapping ones, writing the result to the ephemeral store.
// No-op unless `active` (the active diagram uses the pathfinding router). DOM
// measurement (getBoundingClientRect / getPointAtLength), so it only runs client
// side and is verified manually. Re-runs when node positions (or zoom) change —
// that's what moves the routed paths and thus the label anchors.
export function useLabelDeoverlap(active: boolean): void {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow()
  // Positions signature: concatenate every node's absolute position plus zoom.
  // `useStore` compares the returned value with `===`; since strings compare by
  // value, this only triggers a re-render when the content actually differs —
  // i.e. on every node drag (position changes continuously) and on zoom change.
  const positionsSignature = useStore((s) => {
    let sig = ''
    for (const n of s.nodeLookup.values()) {
      const p = n.internals.positionAbsolute
      sig += n.id + ':' + p.x + ',' + p.y + ';'
    }
    return sig + '|' + s.transform[2]
  })

  useEffect(() => {
    if (!active) {
      setLabelPlacements(new Map())
      return
    }
    const raf = requestAnimationFrame(() => {
      // Queries the whole document and assumes a single mounted React Flow canvas
      // (true for this app's one-canvas-at-a-time architecture); would need
      // scoping to an RF root if two canvases were ever mounted at once.
      const edgeEls = document.querySelectorAll<SVGGElement>('.react-flow__edge-smart')
      const labels: LabelInput[] = []
      const zoom = (() => {
        // derive zoom from a 1-unit flow delta projected to screen
        const a = flowToScreenPosition({ x: 0, y: 0 })
        const b = flowToScreenPosition({ x: 1, y: 0 })
        return Math.hypot(b.x - a.x, b.y - a.y) || 1
      })()
      for (const g of edgeEls) {
        const id = g.getAttribute('data-id')
        if (!id) continue
        const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path')
        const labelEl = document.querySelector<HTMLElement>(`.wp-label[data-edge-id="${id}"]`)
        if (!path || !labelEl) continue
        const len = path.getTotalLength()
        if (!len) continue
        const pinned = labelEl.dataset.pinned === 'true'
        const seedPos = Number(labelEl.dataset.labelPos ?? '0.5')
        const seedOff = {
          x: Number(labelEl.dataset.offx ?? '0'),
          y: Number(labelEl.dataset.offy ?? '0'),
        }
        const rect = labelEl.getBoundingClientRect()
        // anchor/normal in FLOW units, read directly off the rendered path — RF
        // authors edge path `d` attributes in flow units, so getPointAtLength
        // needs no CTM / screenToFlowPosition remapping.
        const anchorAt = (t: number) => {
          const p = path.getPointAtLength(Math.max(0, Math.min(1, t)) * len)
          return { x: p.x, y: p.y }
        }
        const normalAt = (t: number) => {
          const e = 0.001
          const a = anchorAt(Math.max(0, t - e))
          const b = anchorAt(Math.min(1, t + e))
          const dx = b.x - a.x
          const dy = b.y - a.y
          const m = Math.hypot(dx, dy) || 1
          return { x: -dy / m, y: dx / m } // unit perpendicular
        }
        labels.push({
          id,
          width: rect.width / zoom,
          height: rect.height / zoom,
          pinned,
          placement: { labelPos: seedPos, offset: seedOff },
          anchorAt,
          normalAt,
        })
      }
      const nodeBoxes: Rect[] = []
      for (const n of document.querySelectorAll<HTMLElement>('.react-flow__node-service')) {
        const r = n.getBoundingClientRect()
        const tl = screenToFlowPosition({ x: r.left, y: r.top })
        const br = screenToFlowPosition({ x: r.right, y: r.bottom })
        nodeBoxes.push({ x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y })
      }
      setLabelPlacements(resolveLabelPlacements(labels, nodeBoxes))
    })
    return () => cancelAnimationFrame(raf)
  }, [active, positionsSignature, flowToScreenPosition, screenToFlowPosition])
}
