import { describe, it, expect } from 'vitest'
import { normalizeNoteText } from './noteText'

describe('normalizeNoteText', () => {
  it('turns a literal backslash-n into a real newline', () => {
    expect(normalizeNoteText('line one\\nline two')).toBe('line one\nline two')
  })

  it('leaves a real newline alone', () => {
    expect(normalizeNoteText('line one\nline two')).toBe('line one\nline two')
  })

  it('repairs a string that mixes both, as a half-fixed note does', () => {
    // Exactly the shape found on the live instance: one newline repaired by
    // hand, the next still escaped.
    const input = 'repo: { owner }\ngithub: GitHubTransport\\nfiles: ProbeFileSystem'
    expect(normalizeNoteText(input)).toBe(
      'repo: { owner }\ngithub: GitHubTransport\nfiles: ProbeFileSystem',
    )
  })

  it('converts every occurrence, not just the first', () => {
    expect(normalizeNoteText('a\\nb\\nc')).toBe('a\nb\nc')
  })

  it('preserves an intentionally escaped backslash-n as a literal', () => {
    // A caller that genuinely wants the two characters on screen sends \\n;
    // that collapses to a single backslash-n and is NOT then made a newline.
    expect(normalizeNoteText('use \\\\n for a newline')).toBe('use \\n for a newline')
  })

  it('leaves other backslash sequences untouched', () => {
    expect(normalizeNoteText('C:\\temp\\report and \\t stays')).toBe(
      'C:\\temp\\report and \\t stays',
    )
  })

  it('passes through text with no backslashes unchanged', () => {
    expect(normalizeNoteText('plain note')).toBe('plain note')
  })

  it('handles an empty string', () => {
    expect(normalizeNoteText('')).toBe('')
  })
})
