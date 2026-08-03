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
// into a newline. Every other backslash sequence (`\t`, Windows paths) is left
// exactly as written, since notes routinely contain code and file paths.
export function normalizeNoteText(text: string): string {
  return text.replace(/\\(\\|n)/g, (_m, c: string) => (c === 'n' ? '\n' : '\\'))
}
