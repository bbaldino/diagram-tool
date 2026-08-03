import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// Rendered (deselected) view of a canvas note.
//
// remark-breaks is load-bearing, not a nicety: CommonMark treats a single
// newline as a soft wrap, so without it the agent-written notes that list one
// field per line collapse into a run-on paragraph.
//
// rehype-raw is deliberately absent — react-markdown does not execute raw HTML
// without it, and note text is writable over MCP.
const PLUGINS = [remarkGfm, remarkBreaks]

// Images would dominate a small sticky and make the canvas fetch remote
// content. Disallowed at render only; the source stays in Note.text.
const DISALLOWED = ['img']

export function NoteMarkdown({ text }: { text: string }) {
  return (
    <div className="note__md">
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        disallowedElements={DISALLOWED}
        components={{
          // Without target/rel a click navigates the whole canvas away.
          //
          // React Flow selects a node from a plain React `onClick` on the
          // node wrapper (see NodeWrapper in @xyflow/react), not from
          // mousedown/pointerdown — the `nodrag` class only gates the
          // pointerdown-driven *drag* path in XYDrag, it does not stop the
          // click-driven select path. So stopping propagation on mousedown
          // alone (the original approach) does not work: mousedown, click,
          // and pointerdown are separate event dispatches, and stopping one
          // does not stop the others from bubbling. Stop all three so the
          // click never reaches the node wrapper and flips the note into
          // edit mode mid-click.
          a: ({ children, node, ...props }) => (
            <a
              {...props}
              className="nodrag"
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
