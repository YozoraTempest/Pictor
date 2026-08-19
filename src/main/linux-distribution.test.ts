// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  classifyLinuxDistribution,
  detectDesktopDistribution,
  parseOsRelease,
} from './linux-distribution.js'

describe('Linux distribution detection', () => {
  it('parses quoted os-release identity fields without executing them', () => {
    expect(
      parseOsRelease('ID="ubuntu"\nVERSION_ID="24.04"\nID_LIKE="debian ubuntu"\nNAME="Example"\n'),
    ).toEqual({ id: 'ubuntu', idLike: ['debian', 'ubuntu'], versionId: '24.04' })
  })

  it('supports only native Arch as a Linux acceptance environment', () => {
    expect(
      classifyLinuxDistribution({ id: 'ubuntu', idLike: ['debian'], versionId: '24.04' }),
    ).toBe('unsupported-linux')
    expect(
      classifyLinuxDistribution({ id: 'ubuntu', idLike: ['debian'], versionId: '22.04' }),
    ).toBe('unsupported-linux')
    expect(classifyLinuxDistribution({ id: 'arch', idLike: [], versionId: null })).toBe('arch')
    expect(classifyLinuxDistribution({ id: 'manjaro', idLike: ['arch'], versionId: null })).toBe(
      'unsupported-linux',
    )
  })

  it('does not read os-release on Windows', async () => {
    await expect(
      detectDesktopDistribution('win32', async () => {
        throw new Error('must not read')
      }),
    ).resolves.toBe('windows')
  })
})
