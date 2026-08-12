import DOMPurify from 'dompurify'
import { marked } from 'marked'

const allowedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]

const allowedAttributes = ['class', 'colspan', 'href', 'rel', 'rowspan', 'start', 'target', 'title']

export function toSafeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function escapeHtmlAttribute(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

export function createCitationHtml(label: string, url: string, title: string) {
  const safeUrl = toSafeHttpUrl(url)
  if (!safeUrl) return label

  return `<sup class="citation-ref"><a href="${escapeHtmlAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtmlAttribute(title)}">${escapeHtmlAttribute(label)}</a></sup>`
}

export function renderSafeMarkdown(markdown: string) {
  if (!import.meta.client) return ''

  const rendered = marked(markdown, {
    silent: true,
    gfm: true,
    breaks: true,
    async: false,
  })
  const sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  })

  const template = document.createElement('template')
  template.innerHTML = sanitized
  template.content.querySelectorAll('a').forEach((anchor) => {
    const safeUrl = toSafeHttpUrl(anchor.getAttribute('href') ?? '')
    if (!safeUrl) {
      anchor.replaceWith(...anchor.childNodes)
      return
    }

    anchor.href = safeUrl
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
  })

  return template.innerHTML
}
