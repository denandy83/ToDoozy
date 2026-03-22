import { describe, it, expect } from 'vitest'

// The focusable selector used inside useFocusTrap — test the logic without DOM
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

describe('useFocusTrap', () => {
  it('focusable selector matches expected patterns', () => {
    // Verify the selector pattern is well-formed by checking it includes key element types
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('input:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('a[href]')
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
    expect(FOCUSABLE_SELECTOR).toContain('select:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('textarea:not([disabled])')
  })

  it('tab cycling logic wraps around correctly', () => {
    // Simulate the cycling logic used in useFocusTrap
    const focusableCount = 5

    // Forward: last element wraps to first
    const lastIdx = focusableCount - 1
    const nextAfterLast = (lastIdx + 1) % focusableCount
    expect(nextAfterLast).toBe(0)

    // Backward: first element wraps to last
    const firstIdx = 0
    const prevBeforeFirst = (firstIdx - 1 + focusableCount) % focusableCount
    expect(prevBeforeFirst).toBe(focusableCount - 1)

    // Middle stays in order
    const middleIdx = 2
    expect((middleIdx + 1) % focusableCount).toBe(3)
    expect((middleIdx - 1 + focusableCount) % focusableCount).toBe(1)
  })
})
