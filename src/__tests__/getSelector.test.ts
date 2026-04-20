import { describe, it, expect, beforeEach } from 'vitest'
import { getSelector } from '../lib/getSelector'

describe('getSelector', () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild)
    }
  })

  it('prefers a safe id', () => {
    const el = document.createElement('div')
    el.id = 'my-thing'
    document.body.appendChild(el)
    expect(getSelector(el)).toBe('#my-thing')
  })

  it('skips ids that need escaping and walks the tree instead', () => {
    const parent = document.createElement('section')
    const el = document.createElement('div')
    el.id = 'not:safe'
    parent.appendChild(el)
    document.body.appendChild(parent)
    expect(getSelector(el)).toBe('section > div')
  })

  it('filters class names that would need CSS escaping', () => {
    const el = document.createElement('button')
    el.className = 'ok good_class invalid:class also@bad fine-class'
    document.body.appendChild(el)
    // Safe classes: ok, good_class, fine-class. getSelector truncates to 2.
    expect(getSelector(el)).toBe('button.ok.good_class')
  })

  it('disambiguates among same-tag siblings with nth-of-type', () => {
    const parent = document.createElement('ul')
    const a = document.createElement('li')
    const b = document.createElement('li')
    const c = document.createElement('li')
    parent.append(a, b, c)
    document.body.appendChild(parent)
    expect(getSelector(b)).toBe('ul > li:nth-of-type(2)')
  })

  it('does not emit nth-of-type for unique siblings', () => {
    const parent = document.createElement('div')
    const el = document.createElement('span')
    parent.appendChild(el)
    document.body.appendChild(parent)
    expect(getSelector(el)).toBe('div > span')
  })
})
