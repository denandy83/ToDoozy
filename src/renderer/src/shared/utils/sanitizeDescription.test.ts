// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { sanitizeDescription } from './sanitizeDescription'

it('preserves rich text and approved links while removing executable remote content', () => {
  const element=document.createElement('div')
  element.innerHTML=sanitizeDescription('<p><strong>Work</strong> <a href="https://example.invalid">document</a></p><img src="x" onerror="window.api.auth.getSession()"><a href="javascript:window.api.auth.getSession()" onclick="alert(1)">unsafe</a><iframe src="https://example.invalid"></iframe><script>alert(1)</script><form id="api"><input name="auth"></form>')
  expect(element.querySelector('strong')?.textContent).toBe('Work')
  expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid')
  const unsafe=element.querySelectorAll('a')[1]
  expect(unsafe.hasAttribute('href')).toBe(false)
  expect(unsafe.hasAttribute('onclick')).toBe(false)
  expect(element.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  expect(element.querySelector('iframe,script,form,[id],[name]')).toBeNull()
})
