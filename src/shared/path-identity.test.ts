// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { pathsReferToSameLocation } from './path-identity.js'

describe('path identity', () => {
  it('preserves case-sensitive Linux path identity', () => {
    expect(pathsReferToSameLocation('/work/Repo', '/work/repo', 'linux')).toBe(false)
  })

  it('preserves case-insensitive Windows path identity', () => {
    expect(pathsReferToSameLocation('C:\\work\\Repo', 'c:\\WORK\\repo', 'win32')).toBe(true)
  })
})
