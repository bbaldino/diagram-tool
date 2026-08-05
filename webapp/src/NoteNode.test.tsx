// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import type { NoteNode as NoteNodeType } from './canvasData'
import { useState } from 'react'
import { NoteNode } from './nodes'
import { SCHEMES, secondaryText, accentFill } from './schemes'

afterEach(cleanup)

// NoteNode only reads id/data/selected; the rest of NodeProps is irrelevant here.
const noteProps = (text: string): NodeProps<NoteNodeType> =>
  ({ id: 'n1', data: { text }, selected: false }) as unknown as NodeProps<NoteNodeType>

// NoteNode's textarea is controlled by `data.text`, which is owned by React
// Flow's store and updated asynchronously — the canvas commits at least one
// render still carrying the pre-keystroke text. These harnesses reproduce that
// lag deterministically so the caret behaviour can be asserted without a canvas.

/** Parent that NEVER updates the text — the worst case of the store lagging. */
function LaggingParent({ text }: { text: string }) {
  return (
    <ReactFlowProvider>
      <NoteNode {...notePropsSelected(text)} />
    </ReactFlowProvider>
  )
}

/** Parent whose text can be changed from the outside (undo, MCP edit). */
function ExternallyUpdatedParent({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <ReactFlowProvider>
      <button onClick={() => setText('replaced from elsewhere')}>external</button>
      <NoteNode {...notePropsSelected(text)} />
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

const notePropsSelected = (text: string): NodeProps<NoteNodeType> =>
  ({ id: 'n1', data: { text }, selected: true }) as unknown as NodeProps<NoteNodeType>

describe('NoteNode selected vs rendered', () => {
  it('focuses the textarea as soon as the note becomes selected', () => {
    // Deselected note -> click -> the wrapper's onClick selects the node and
    // the textarea mounts. One click should be enough to get a caret; the
    // user should not have to click a second time.
    render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('hello')} />
      </ReactFlowProvider>,
    )
    const el = screen.getByPlaceholderText('note…') as HTMLTextAreaElement
    expect(document.activeElement).toBe(el)
  })

  it('shows the raw markdown in a textarea while selected', () => {
    render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('**bold**')} />
      </ReactFlowProvider>,
    )
    const el = screen.getByPlaceholderText('note…') as HTMLTextAreaElement
    expect(el.value).toBe('**bold**')
  })

  it('renders markdown and hides the textarea while deselected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...noteProps('**bold**')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('shows the placeholder hint for an empty note while deselected', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...noteProps('   ')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.note__placeholder')?.textContent).toBe('note…')
  })

  it('still shows text typed just before deselecting, even if the store lagged', async () => {
    // The textarea unmounts on deselect. NoteNode itself does not, so its local
    // `draft` survives and the rendered view must use it — otherwise a keystroke
    // taken in the last moments before deselect disappears from view. Note
    // `data.text` is deliberately UNCHANGED across the rerender: that is the
    // React Flow store lagging, which is the condition the caret fix exists for.
    const user = userEvent.setup()
    const { rerender, container } = render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('start')} />
      </ReactFlowProvider>,
    )
    const el = screen.getByPlaceholderText('note…') as HTMLTextAreaElement
    el.focus()
    el.setSelectionRange(5, 5)
    await user.keyboard(' more')
    expect(el.value).toBe('start more')

    rerender(
      <ReactFlowProvider>
        <NoteNode {...noteProps('start')} />
      </ReactFlowProvider>,
    )

    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('start more')
  })

  it('picks up an inbound data.text change after its textarea was focused then unmounted by deselect', () => {
    const { rerender, container } = render(
      <ReactFlowProvider>
        <NoteNode {...notePropsSelected('original')} />
      </ReactFlowProvider>,
    )
    const el = ta()
    el.focus()
    expect(document.activeElement).toBe(el)

    // Deselect: the textarea unmounts. React does not fire onBlur for a
    // focused element removed from the DOM, so `editing.current` must not be
    // left stuck at true.
    rerender(
      <ReactFlowProvider>
        <NoteNode {...noteProps('original')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('textarea')).toBeNull()

    // An inbound change (MCP edit / undo) while deselected must still show up.
    rerender(
      <ReactFlowProvider>
        <NoteNode {...noteProps('replaced from elsewhere')} />
      </ReactFlowProvider>,
    )

    expect(container.textContent).toContain('replaced from elsewhere')
  })
})

describe('NoteNode colour', () => {
  const coloured = (text: string, scheme?: string): NodeProps<NoteNodeType> =>
    ({ id: 'n1', data: { text, scheme }, selected: false }) as unknown as NodeProps<NoteNodeType>

  it('renders the starting scheme when the entity has that scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi', 'sticky')} />
      </ReactFlowProvider>,
    )
    const note = container.querySelector('.note') as HTMLElement
    expect(note.style.getPropertyValue('--scheme-bg')).toBe('#fef9c3')
    expect(note.style.getPropertyValue('--scheme-text-2')).toBe(secondaryText(SCHEMES.sticky))
    expect(note.style.getPropertyValue('--scheme-accent')).toBe(accentFill(SCHEMES.sticky))
  })

  it('renders a named scheme', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi', 'blue')} />
      </ReactFlowProvider>,
    )
    expect(
      (container.querySelector('.note') as HTMLElement).style.getPropertyValue('--scheme-bg'),
    ).toBe('#e2ecfe')
  })

  it('has no tinted/accented modifier class — every note renders one way', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi', 'blue')} />
      </ReactFlowProvider>,
    )
    const note = container.querySelector('.note') as HTMLElement
    expect(note.classList.contains('note--tinted')).toBe(false)
    expect(note.classList.contains('note--accented')).toBe(false)
  })

  it('falls back to the starting scheme for an unknown value rather than rendering unstyled', () => {
    const { container } = render(
      <ReactFlowProvider>
        <NoteNode {...coloured('hi', 'nonsense')} />
      </ReactFlowProvider>,
    )
    expect(
      (container.querySelector('.note') as HTMLElement).style.getPropertyValue('--scheme-bg'),
    ).toBe('#fef9c3')
  })
})
