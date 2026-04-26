import { describe, it, expect } from 'vitest'
import { paramsToStoreArgs } from './TimerPlayButton'

describe('paramsToStoreArgs', () => {
  it('flowtime mode produces isFlowtime=true regardless of duration', () => {
    expect(paramsToStoreArgs({ mode: 'flowtime', duration: 'limited', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: true,
      isPerpetual: false,
      reps: 0,
      minutes: 25
    })
    // Regression: Gabriel's bug. When the user defaults to flowtime AND has the
    // legacy "perpetual" preference set, the duration sub-toggle must not leak
    // into the flowtime path — pressing play should start in flowtime.
    expect(paramsToStoreArgs({ mode: 'flowtime', duration: 'infinite', minutes: 25, reps: 1 })).toEqual({
      isFlowtime: true,
      isPerpetual: false,
      reps: 0,
      minutes: 25
    })
  })

  it('timer + infinite produces a perpetual countdown', () => {
    expect(paramsToStoreArgs({ mode: 'timer', duration: 'infinite', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: false,
      isPerpetual: true,
      reps: 1,
      minutes: 25
    })
  })

  it('timer + limited produces a finite countdown with the chosen reps', () => {
    expect(paramsToStoreArgs({ mode: 'timer', duration: 'limited', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: false,
      isPerpetual: false,
      reps: 4,
      minutes: 25
    })
  })
})
