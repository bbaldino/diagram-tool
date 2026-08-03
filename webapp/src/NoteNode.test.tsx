// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { useState } from 'react'
import { NoteNode } from './nodes'

afterEach(cleanup)

// NoteNode only reads id/data/selected; the rest of NodeProps is irrelevant here.
const noteProps = (text: string): NodeProps =>
  ({ id: 'n1', data: { text }, selected: false }) as unknown as NodeProps

// NoteNode's textarea is controlled by `data.text`, which is owned by React
// Flow's store and updated asynchronously — the canvas commits at least one
// render still carrying the pre-keystroke text. These harnesses reproduce that
// lag deterministically so the caret behaviour can be asserted without a canvas.

/** Parent that NEVER updates the text — the worst case of the store lagging. */
function LaggingParent({ text }: { text: string }) {
  return (
    <ReactFlowProvider>
      <NoteNode {...noteProps(text)} />
    </ReactFlowProvider>
  )
}

/** Parent whose text can be changed from the outside (undo, MCP edit). */
function ExternallyUpdatedParent({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <ReactFlowProvider>
      <button onClick={() => setText('replaced from elsewhere')}>external</button>
      <NoteNode {...noteProps(text)} />
    </ReactFlowProvider>
  )
}

const ta = () => screen.getByPlaceholderText('note…') as HTMLTextAreaElement

describe('NoteNode textarea', () => {
  it('keeps the caret after the typed character when editing mid-text', async () => {
    const user = userEvent.setup()
    render(<LaggingParent text="ABCDEFGHIJ" />)
    const el = ta()
    el.focus()
    el.setSelectionRange(5, 5) // between E and F

    await user.keyboard('X')

    expect(el.value).toBe('ABCDEXFGHIJ')
    expect(el.selectionStart).toBe(6) // NOT 11 (end of text)
  })

  it('keeps the caret when deleting mid-text', async () => {
    const user = userEvent.setup()
    render(<LaggingParent text="ABCDEFGHIJ" />)
    const el = ta()
    el.focus()
    el.setSelectionRange(5, 5)

    await user.keyboard('{Backspace}')

    expect(el.value).toBe('ABCDFGHIJ')
    expect(el.selectionStart).toBe(4)
  })

  it('survives several mid-text keystrokes in a row', async () => {
    const user = userEvent.setup()
    render(<LaggingParent text="ABCDEFGHIJ" />)
    const el = ta()
    el.focus()
    el.setSelectionRange(5, 5)

    await user.keyboard('XYZ')

    expect(el.value).toBe('ABCDEXYZFGHIJ')
    expect(el.selectionStart).toBe(8)
  })

  it('still shows text arriving from outside while unfocused (undo / MCP edit)', async () => {
    const user = userEvent.setup()
    render(<ExternallyUpdatedParent initial="original" />)
    expect(ta().value).toBe('original')

    await user.click(screen.getByRole('button', { name: 'external' }))

    expect(ta().value).toBe('replaced from elsewhere')
  })
})
