// Characters that are invalid in CSS class selectors (unescaped)
const INVALID_CLASS_CHARS = /[^a-zA-Z0-9_-]/

function isValidClass(name: string): boolean {
  return name.length > 0 && !INVALID_CLASS_CHARS.test(name)
}

export function getSelector(el: Element): string {
  if (el.id && !INVALID_CLASS_CHARS.test(el.id)) return `#${el.id}`

  const parts: string[] = []
  let current: Element | null = el

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase()

    if (current.className && typeof current.className === 'string') {
      const safeClasses = current.className
        .trim()
        .split(/\s+/)
        .filter(isValidClass)
        .slice(0, 2)

      if (safeClasses.length) {
        selector += '.' + safeClasses.join('.')
      }
    }

    const parent: Element | null = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === current!.tagName
      )
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1
        selector += `:nth-of-type(${index})`
      }
    }

    parts.unshift(selector)
    current = parent
  }

  return parts.join(' > ')
}
