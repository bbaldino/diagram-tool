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

  it('leaves a backslash followed by anything other than n or backslash untouched (e.g. \\t, \\r)', () => {
    // Only `\n` and `\\` are special-cased; every other backslash-letter pair
    // simply does not match the repair regex and passes through as-is.
    expect(normalizeNoteText('\\t stays, and so does \\r and \\p')).toBe(
      '\\t stays, and so does \\r and \\p',
    )
  })

  it('passes through text with no backslashes unchanged', () => {
    expect(normalizeNoteText('plain note')).toBe('plain note')
  })

  it('handles an empty string', () => {
    expect(normalizeNoteText('')).toBe('')
  })

  it('KNOWN LIMITATION: still repairs a \\n that is part of a plain-prose Windows path', () => {
    // "\notes" reads as a backslash-n escape sequence indistinguishable from
    // an intentional escaped newline outside of a code context. This pins
    // the current (imperfect) behaviour as a documented decision rather than
    // an accident: a bare, unfenced Windows path is not safe from repair.
    const input = 'see C:\\notes\\x for details'
    expect(normalizeNoteText(input)).toBe('see C:' + '\n' + 'otes\\x for details')
  })

  it('leaves a \\n inside an inline code span untouched', () => {
    const input = 'before `a\\nb` after'
    expect(normalizeNoteText(input)).toBe('before `a\\nb` after')
  })

  it('still repairs a \\n in prose surrounding an inline code span', () => {
    const input = 'line one\\n`code` line two\\nline three'
    expect(normalizeNoteText(input)).toBe('line one\n`code` line two\nline three')
  })

  it('leaves a \\n inside a fenced code block untouched', () => {
    const input = '```\ncode\\nmore\n```'
    expect(normalizeNoteText(input)).toBe('```\ncode\\nmore\n```')
  })

  it('still repairs a \\n in prose surrounding a fenced code block', () => {
    const input = 'intro\\n```\nfenced\\ncontent\n```\\nend'
    expect(normalizeNoteText(input)).toBe('intro\n```\nfenced\\ncontent\n```\nend')
  })

  it('handles a note mixing repaired prose, an inline span, and a fenced block', () => {
    const input = 'title\\nsee `path\\to\\code` then:\\n```\nblock\\nline\n```\\ndone'
    expect(normalizeNoteText(input)).toBe(
      'title\nsee `path\\to\\code` then:\n```\nblock\\nline\n```\ndone',
    )
  })

  it('preserves a \\n inside an unterminated fenced block (CommonMark treats it as code to EOF)', () => {
    // An unclosed fence is code to end-of-text per CommonMark spec.
    const input = '```\ncode\\nmore'
    expect(normalizeNoteText(input)).toBe('```\ncode\\nmore')
  })

  it('still repairs a \\n in an unterminated inline span (not code per CommonMark)', () => {
    // A single unterminated backtick is literal prose, not a code span.
    const input = 'before `a\\nb after'
    expect(normalizeNoteText(input)).toBe('before `a\nb after')
  })

  it('preserves a real newline inside an unterminated fenced block', () => {
    // Real 0x0a newlines are never touched; this is how code blocks get actual line breaks.
    const input = '```\nfirst\nsecond'
    expect(normalizeNoteText(input)).toBe('```\nfirst\nsecond')
  })
})
