import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_SPEEDS,
  PLAYBACK_BASE_MS,
  stepIntervalMs,
  transportSublabel,
  advanceStep,
  isStepPlayed,
} from './flowPlayback'

describe('flowPlayback helpers', () => {
  it('exposes the speed list and base interval', () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.5, 1, 2])
    expect(PLAYBACK_BASE_MS).toBe(2200)
  })

  it('scales the interval by speed', () => {
    expect(stepIntervalMs(1)).toBe(2200)
    expect(stepIntervalMs(2)).toBe(1100)
    expect(stepIntervalMs(0.5)).toBe(4400)
  })

  it('builds the sub-label with and without a caption', () => {
    expect(transportSublabel(0, 4)).toBe('Step 1 of 4')
    expect(transportSublabel(1, 4, 'User hits Traefik')).toBe('Step 2 of 4 · User hits Traefik')
    // blank/whitespace caption is treated as absent
    expect(transportSublabel(2, 4, '   ')).toBe('Step 3 of 4')
  })

  it('advances toward the last step and reports atEnd', () => {
    expect(advanceStep(0, 4)).toEqual({ index: 1, atEnd: false })
    expect(advanceStep(2, 4)).toEqual({ index: 3, atEnd: true })
    // already on (or past) the last step: stays put, atEnd
    expect(advanceStep(3, 4)).toEqual({ index: 3, atEnd: true })
    expect(advanceStep(9, 4)).toEqual({ index: 3, atEnd: true })
    // single-step flow is immediately atEnd
    expect(advanceStep(0, 1)).toEqual({ index: 0, atEnd: true })
  })

  it('fills scrubber bars up to and including the current step', () => {
    expect(isStepPlayed(0, 1)).toBe(true)
    expect(isStepPlayed(1, 1)).toBe(true)
    expect(isStepPlayed(2, 1)).toBe(false)
  })
})
