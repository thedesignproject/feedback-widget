import { describe, expect, it } from 'vitest'
import { convertModernColorFunctions } from '../lib/screenshotCapture'

describe('screenshot color conversion', () => {
  it('converts oklab colors to rgb for html2canvas', () => {
    expect(convertModernColorFunctions('oklab(1 0 0)')).toBe('rgb(255, 255, 255)')
    expect(convertModernColorFunctions('oklab(0 0 0 / 50%)')).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('converts oklch colors inside larger CSS values', () => {
    expect(
      convertModernColorFunctions('0 8px 24px oklch(0 0 0 / 25%)'),
    ).toBe('0 8px 24px rgba(0, 0, 0, 0.25)')
  })
})
