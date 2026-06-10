import { describe, it, expect } from 'vitest'
import { resolveSubmitNlp } from './useSmartInput'
import type { NlpDateResult } from '../../../../shared/nlpDateParser'

describe('resolveSubmitNlp', () => {
  it('applies a detected NLP date and strips the phrase from the title', () => {
    const result = resolveSubmitNlp({
      title: 'buy milk tomorrow',
      selectedDate: null,
      nlpDismissed: false,
      nlpDateResult: null
    })
    expect(result.nlpDate).not.toBeNull()
    expect(result.title).toBe('buy milk')
  })

  it('honours a dismissed chip: no due date and the full title is preserved (#75)', () => {
    const result = resolveSubmitNlp({
      title: 'buy milk tomorrow',
      selectedDate: null,
      nlpDismissed: true,
      nlpDateResult: null
    })
    expect(result.nlpDate).toBeNull()
    expect(result.nlpRecurrenceRule).toBeNull()
    expect(result.title).toBe('buy milk tomorrow')
  })

  it('a dismissed chip suppresses NLP even when stale nlpDateResult state lingers', () => {
    const staleResult: NlpDateResult = {
      date: new Date('2026-06-11T00:00:00Z'),
      text: 'tomorrow',
      index: 9,
      endIndex: 17,
      hasTime: false,
      recurrenceRule: null
    }
    const result = resolveSubmitNlp({
      title: 'buy milk tomorrow',
      selectedDate: null,
      nlpDismissed: true,
      nlpDateResult: staleResult
    })
    expect(result.nlpDate).toBeNull()
    expect(result.title).toBe('buy milk tomorrow')
  })

  it('does not re-parse when an explicit date is already selected', () => {
    const result = resolveSubmitNlp({
      title: 'buy milk tomorrow',
      selectedDate: '2026-06-20',
      nlpDismissed: false,
      nlpDateResult: null
    })
    expect(result.nlpDate).toBeNull()
    expect(result.title).toBe('buy milk tomorrow')
  })

  it('does not parse NLP when a d: operator is present in the title', () => {
    const result = resolveSubmitNlp({
      title: 'buy milk d:tomorrow',
      selectedDate: null,
      nlpDismissed: false,
      nlpDateResult: null
    })
    expect(result.nlpDate).toBeNull()
    expect(result.title).toBe('buy milk d:tomorrow')
  })

  it('falls back to a previously detected nlpDateResult when nothing fresh and not dismissed', () => {
    const prior: NlpDateResult = {
      date: new Date('2026-06-11T00:00:00Z'),
      text: 'tomorrow',
      index: 9,
      endIndex: 17,
      hasTime: false,
      recurrenceRule: null
    }
    const result = resolveSubmitNlp({
      title: 'buy milk tomorrow',
      selectedDate: null,
      nlpDismissed: false,
      nlpDateResult: prior
    })
    expect(result.nlpDate).not.toBeNull()
    expect(result.title).toBe('buy milk')
  })
})
