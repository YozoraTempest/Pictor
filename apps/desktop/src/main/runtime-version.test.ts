import { describe, expect, it } from 'vitest'

import { pinnedVersionOf, versionStateOf } from './runtime-version.js'

describe('pinnedVersionOf', () => {
  it('reads the version of a scoped package', () => {
    expect(pinnedVersionOf('@deepseek-ai/dsh@0.2.1-rc.2')).toBe('0.2.1-rc.2')
  })

  it('keeps a prerelease tag intact', () => {
    expect(pinnedVersionOf('@deepseek-ai/dsh@1.0.0-beta.3')).toBe('1.0.0-beta.3')
  })

  it('reports nothing for a spec without a version', () => {
    expect(pinnedVersionOf('@deepseek-ai/dsh')).toBeNull()
    expect(pinnedVersionOf('dsh')).toBeNull()
    expect(pinnedVersionOf('@deepseek-ai/dsh@')).toBeNull()
  })
})

describe('versionStateOf', () => {
  it('matches only an exact version', () => {
    expect(versionStateOf('0.2.1-rc.2', '0.2.1-rc.2')).toBe('match')
    expect(versionStateOf('0.2.1-rc.2', '0.2.0')).toBe('mismatch')
  })

  it('cannot compare what it cannot read', () => {
    expect(versionStateOf('0.2.1-rc.2', null)).toBe('unknown')
    expect(versionStateOf(null, '0.2.1-rc.2')).toBe('unknown')
  })
})
