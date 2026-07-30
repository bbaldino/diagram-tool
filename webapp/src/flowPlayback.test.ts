import { describe, expect, it } from 'vitest'
import { stepCounterLabel, isStepPlayed } from './flowPlayback'

describe('flowPlayback helpers', () => {
  it('formats a 1-based "index / total" step counter', () => {
    expect(stepCounterLabel(0, 4)).toBe('1 / 4')
    expect(stepCounterLabel(3, 4)).toBe('4 / 4')
  })

  it('fills scrubber bars up to and including the current step', () => {
    expect(isStepPlayed(0, 1)).toBe(true)
    expect(isStepPlayed(1, 1)).toBe(true)
    expect(isStepPlayed(2, 1)).toBe(false)
  })
})
