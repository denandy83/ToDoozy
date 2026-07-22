import { describe, it, expect } from 'vitest'
import { validateExternalUrl, ALLOWED_EXTERNAL_PROTOCOLS } from './shell-url'

describe('validateExternalUrl', () => {
  describe('allowed schemes', () => {
    it('accepts https URLs', () => {
      expect(validateExternalUrl('https://example.com')).toEqual({
        ok: true,
        url: 'https://example.com'
      })
    })

    it('accepts http URLs', () => {
      expect(validateExternalUrl('http://example.com/path?q=1')).toEqual({
        ok: true,
        url: 'http://example.com/path?q=1'
      })
    })

    it('accepts mailto URLs', () => {
      expect(validateExternalUrl('mailto:someone@example.com')).toEqual({
        ok: true,
        url: 'mailto:someone@example.com'
      })
    })

    it('accepts https URLs regardless of case in the scheme', () => {
      // The URL constructor normalises the protocol to lowercase.
      const result = validateExternalUrl('HTTPS://Example.com')
      expect(result.ok).toBe(true)
    })
  })

  describe('blocked schemes', () => {
    it('rejects file:// URLs', () => {
      const result = validateExternalUrl('file:///etc/hosts')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('file:')
    })

    it('rejects smb:// URLs', () => {
      const result = validateExternalUrl('smb://server/share')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('smb:')
    })

    it('rejects javascript: URLs', () => {
      const result = validateExternalUrl('javascript:alert(1)')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('javascript:')
    })

    it('rejects custom app schemes', () => {
      const result = validateExternalUrl('todoozy://open/task/123')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('todoozy:')
    })

    it('rejects ftp URLs', () => {
      const result = validateExternalUrl('ftp://files.example.com/x')
      expect(result.ok).toBe(false)
    })
  })

  describe('malformed input', () => {
    it('rejects a non-URL string', () => {
      const result = validateExternalUrl('not a url')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('malformed')
    })

    it('rejects an empty string', () => {
      const result = validateExternalUrl('')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('malformed')
    })

    it('rejects a bare hostname with no scheme', () => {
      const result = validateExternalUrl('example.com')
      expect(result.ok).toBe(false)
    })
  })

  it('exposes exactly the three allowed protocols', () => {
    expect([...ALLOWED_EXTERNAL_PROTOCOLS].sort()).toEqual(['http:', 'https:', 'mailto:'])
  })
})
