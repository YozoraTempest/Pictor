import { describe, expect, it } from 'vitest'

import { webApplicationName } from './entry.js'

describe('web application data identity', () => {
  it('shares the installed Pictor profile only for packaged Web distributions', () => {
    expect(webApplicationName({})).toBe('pictor-dev')
    expect(webApplicationName({ PICTOR_PACKAGED: '0' })).toBe('pictor-dev')
    expect(webApplicationName({ PICTOR_PACKAGED: '1' })).toBe('pictor')
  })
})
