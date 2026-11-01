import DOMPurify from 'dompurify'

/** Remote/shared descriptions are untrusted even inside our privileged origin. */
export function sanitizeDescription(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style','form','iframe','object','embed','meta','link','base'],
    FORBID_ATTR: ['style','id','name'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i
  })
}
