import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('exercises the host collector using only isolated synthetic series and temporary storage', () => {
  expect(() => execFileSync('python3', ['-B','-m','unittest','discover','-s','scripts','-p','supabase_metrics_test.py'], { stdio:'pipe' })).not.toThrow()
})
