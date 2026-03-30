import { describe, it, expect } from 'vitest'

// Re-implement the pure functions here for testing since they're not exported
// (they're internal to the component). If they were exported, we'd import directly.

function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes(' ')) return false
  return /^[^\s]+\.[^\s]+/.test(trimmed)
}

function ensureProtocol(url: string): string {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function displayUrl(url: string): string {
  try {
    const full = ensureProtocol(url)
    const parsed = new URL(full)
    const display = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
    return display.length > 50 ? display.slice(0, 47) + '...' : display
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '...' : url
  }
}

describe('looksLikeUrl', () => {
  it('returns true for standard URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true)
    expect(looksLikeUrl('http://example.com/path')).toBe(true)
    expect(looksLikeUrl('www.google.com')).toBe(true)
    expect(looksLikeUrl('github.com/org/repo')).toBe(true)
  })

  it('returns false for non-URL text', () => {
    expect(looksLikeUrl('hello world')).toBe(false)
    expect(looksLikeUrl('just some text')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
    expect(looksLikeUrl('   ')).toBe(false)
  })

  it('returns false for text without dots', () => {
    expect(looksLikeUrl('localhost')).toBe(false)
    expect(looksLikeUrl('notaurl')).toBe(false)
  })
})

describe('ensureProtocol', () => {
  it('adds https:// when missing', () => {
    expect(ensureProtocol('www.google.com')).toBe('https://www.google.com')
    expect(ensureProtocol('example.com/path')).toBe('https://example.com/path')
  })

  it('preserves existing http://', () => {
    expect(ensureProtocol('http://example.com')).toBe('http://example.com')
  })

  it('preserves existing https://', () => {
    expect(ensureProtocol('https://example.com')).toBe('https://example.com')
  })

  it('is case-insensitive for protocol detection', () => {
    expect(ensureProtocol('HTTPS://example.com')).toBe('HTTPS://example.com')
    expect(ensureProtocol('HTTP://example.com')).toBe('HTTP://example.com')
  })

  it('trims whitespace', () => {
    expect(ensureProtocol('  example.com  ')).toBe('https://example.com')
  })
})

describe('displayUrl', () => {
  it('shows domain for simple URLs', () => {
    expect(displayUrl('https://example.com')).toBe('example.com')
    expect(displayUrl('https://example.com/')).toBe('example.com')
  })

  it('shows domain + path', () => {
    expect(displayUrl('https://github.com/org/repo')).toBe('github.com/org/repo')
  })

  it('handles URLs without protocol', () => {
    expect(displayUrl('www.google.com')).toBe('www.google.com')
  })

  it('truncates long URLs with ellipsis', () => {
    const longPath = 'a'.repeat(60)
    const result = displayUrl(`https://example.com/${longPath}`)
    expect(result.length).toBe(50)
    expect(result.endsWith('...')).toBe(true)
  })
})
