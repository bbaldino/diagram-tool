// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteMarkdown } from './NoteMarkdown'

afterEach(cleanup)

describe('NoteMarkdown', () => {
  it('renders emphasis as real elements', () => {
    const { container } = render(<NoteMarkdown text="**bold** and *italic*" />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
  })

  it('renders a list', () => {
    const { container } = render(<NoteMarkdown text={'- one\n- two'} />)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('treats a single newline as a line break', () => {
    // remark-breaks. Without it CommonMark folds this into one paragraph and
    // the existing agent-written notes collapse into a run-on line.
    const { container } = render(<NoteMarkdown text={'first line\nsecond line'} />)
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  it('supports gfm strikethrough', () => {
    const { container } = render(<NoteMarkdown text="~~gone~~" />)
    expect(container.querySelector('del')?.textContent).toBe('gone')
  })

  it('does NOT execute raw HTML', () => {
    const { container } = render(<NoteMarkdown text={'<img src=x onerror="alert(1)">'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img')
  })

  it('does not render markdown images', () => {
    const { container } = render(<NoteMarkdown text="![alt text](http://example.com/a.png)" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('opens links in a new tab with a safe rel', () => {
    render(<NoteMarkdown text="[site](http://example.com)" />)
    const a = screen.getByRole('link', { name: 'site' })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noreferrer')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.className).toContain('nodrag')
  })

  it('wraps its output in .note__md', () => {
    const { container } = render(<NoteMarkdown text="hi" />)
    expect(container.querySelector('.note__md')).not.toBeNull()
  })

  it('does not let a link click bubble to the parent node (which would select it)', async () => {
    // React Flow selects a node from a plain React onClick on the node
    // wrapper (see NodeWrapper in @xyflow/react), not from mousedown or
    // pointerdown. Cover all three so a regression that only fixes one is
    // caught.
    const user = userEvent.setup()
    const onParent = vi.fn()
    render(
      <div onClick={onParent} onPointerDown={onParent} onMouseDown={onParent}>
        <NoteMarkdown text="[site](http://example.com)" />
      </div>,
    )
    await user.click(screen.getByRole('link', { name: 'site' }))
    expect(onParent).not.toHaveBeenCalled()
  })
})
