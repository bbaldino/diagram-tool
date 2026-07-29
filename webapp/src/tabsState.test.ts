import { describe, it, expect } from 'vitest'
import { sanitizeOpenTabs, closeTab, addTab } from './tabsState'

describe('tabsState', () => {
  it('addTab appends when absent, no-op when present', () => {
    expect(addTab(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(addTab(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })
  it('sanitizeOpenTabs drops unknown ids, dedupes, keeps order', () => {
    expect(sanitizeOpenTabs(['a', 'x', 'b', 'a'], ['a', 'b', 'c'], 'a')).toEqual(['a', 'b'])
  })
  it('sanitizeOpenTabs ensures a real activeId is present', () => {
    expect(sanitizeOpenTabs(['a', 'b'], ['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c'])
    expect(sanitizeOpenTabs([], ['a', 'b'], 'b')).toEqual(['b'])
    expect(sanitizeOpenTabs(['a'], ['a', 'b'], null)).toEqual(['a']) // null active: leave as-is
  })
  it('closeTab of a non-active tab keeps active', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'a')).toEqual({ openTabs: ['b', 'c'], activeId: 'b' })
  })
  it('closeTab of the active tab picks the left neighbor', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ openTabs: ['a', 'c'], activeId: 'a' })
  })
  it('closeTab of the active first tab picks the new first', () => {
    expect(closeTab(['a', 'b', 'c'], 'a', 'a')).toEqual({ openTabs: ['b', 'c'], activeId: 'b' })
  })
  it('closeTab of the only tab yields empty + null active', () => {
    expect(closeTab(['a'], 'a', 'a')).toEqual({ openTabs: [], activeId: null })
  })
})
