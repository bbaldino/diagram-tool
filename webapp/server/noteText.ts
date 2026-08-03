// Repair note text that arrived with escaped newlines.
//
// Agents writing notes over MCP commonly send the two characters backslash + n
// where they mean a line break: they reason "a newline is \n" and then escape
// that backslash on the way out, so `"a\\nb"` reaches us as `a\nb` (0x5c 0x6e)
// rather than `a` + 0x0a + `b`. The transport is faithful in both directions —
// verified by round-tripping a real newline and a literal through an MCP client
// — so nothing downstream can distinguish intent; it has to be repaired here.
//
// Escape processing is left-to-right so a deliberately escaped sequence still
// survives: `\\n` collapses to a literal backslash-n and is NOT then turned
// into a newline.
//
// Only those two sequences (`\n` and `\\`) are touched. A backslash followed
// by anything else (`\t`, `\r`, ...) simply does not match the repair regex
// and is left exactly as written — that is NOT the same as "Windows paths are
// safe": a plain-prose path like `C:\notes\x` contains the literal two
// characters backslash + n as part of "\notes", which is indistinguishable
// here from an intentionally escaped newline and IS still repaired into a
// real newline. That is a known limitation of the scheme, pinned by a test in
// noteText.test.ts, not something this function resolves.
//
// Note text is markdown and routinely carries code and paths, so the repair
// skips markdown code contexts: inline spans delimited by single backticks
// and fenced blocks delimited by triple backticks. Text inside those runs is
// passed through byte-for-byte, escaped newlines included.
export function normalizeNoteText(text: string): string {
  return replaceOutsideCodeContexts(text, repairEscapes)
}

function repairEscapes(segment: string): string {
  return segment.replace(/\\(\\|n)/g, (_m, c: string) => (c === 'n' ? '\n' : '\\'))
}

// Splits `text` into markdown code runs (fenced ```...``` blocks, then inline
// `...` spans) and everything else, applies `fn` only to the non-code runs,
// and reassembles the result. Fenced blocks are matched first in the
// alternation so a backtick inside one isn't mistaken for the start of an
// inline span.
function replaceOutsideCodeContexts(text: string, fn: (segment: string) => string): string {
  const CODE_RUN = /```[\s\S]*?```|`[^`]*`/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CODE_RUN.exec(text))) {
    result += fn(text.slice(lastIndex, match.index))
    result += match[0]
    lastIndex = match.index + match[0].length
  }
  result += fn(text.slice(lastIndex))
  return result
}
