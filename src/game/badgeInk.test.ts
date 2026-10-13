import { describe, expect, it } from 'vitest'
import { badgeInk } from './badgeInk'

describe('badgeInk', () => {
  it('picks near-black ink on bright fills', () => {
    expect(badgeInk('#fb4f14')).toBe('#131313')
    expect(badgeInk('#f56600')).toBe('#131313') // Clemson primary
    expect(badgeInk('#ffffff')).toBe('#131313')
  })

  it('picks white ink on dark fills', () => {
    expect(badgeInk('#4f2683')).toBe('#ffffff') // Vikings primary
    expect(badgeInk('#000000')).toBe('#ffffff')
  })
})
