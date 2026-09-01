// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import type { AppInfo } from '../../shared/app-info.js'
import { UpdateService, compareVersions } from './update-service.js'

const stableTag = 'v0.4.0'
const stableCommit = 'a'.repeat(40)
const nightlyCommit = 'b'.repeat(40)
const olderNightlyCommit = 'c'.repeat(40)
const stableReleaseUrl = `https://github.com/YozoraTempest/Pictor/releases/tag/${stableTag}`
const nightlyReleaseUrl = 'https://github.com/YozoraTempest/Pictor/releases/tag/nightly'

type PlatformContext =
  | { platform: 'win32'; distribution: 'windows' }
  | { platform: 'linux'; distribution: 'arch' | 'unsupported-linux' }

function createAppInfo(context: PlatformContext, overrides: Partial<AppInfo> = {}): AppInfo {
  return {
    name: 'Pictor',
    version: '0.3.0',
    buildChannel: 'development',
    sourceCommit: null,
    platform: context.platform,
    arch: 'x64',
    distribution: context.distribution,
    ...overrides,
  }
}

function releaseAssets(tag: string, version: string) {
  return [
    {
      name: `Pictor-${version}-windows-x64-setup.exe`,
      browser_download_url: `https://github.com/YozoraTempest/Pictor/releases/download/${tag}/Pictor-${version}-windows-x64-setup.exe`,
    },
    {
      name: `Pictor-${version}-arch-x64.pacman`,
      browser_download_url: `https://github.com/YozoraTempest/Pictor/releases/download/${tag}/Pictor-${version}-arch-x64.pacman`,
    },
    {
      name: `Pictor-${version}-linux-x64.AppImage`,
      browser_download_url: `https://github.com/YozoraTempest/Pictor/releases/download/${tag}/Pictor-${version}-linux-x64.AppImage`,
    },
  ]
}

function stableResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tag_name: stableTag,
    target_commitish: stableCommit,
    html_url: stableReleaseUrl,
    prerelease: false,
    published_at: '2026-09-01T00:00:00.000Z',
    assets: releaseAssets(stableTag, '0.4.0'),
    ...overrides,
  })
}

function nightlyResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tag_name: 'nightly',
    target_commitish: nightlyCommit,
    html_url: nightlyReleaseUrl,
    prerelease: true,
    published_at: '2026-09-01T02:17:00.000Z',
    assets: releaseAssets('nightly', '0.3.0'),
    ...overrides,
  })
}

function createService(appInfo: AppInfo, response: Response) {
  const openExternal = vi.fn(async () => undefined)
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
  const service = new UpdateService({ appInfo, fetch, openExternal })
  return { fetch, openExternal, service }
}

describe('stable updates', () => {
  it.each([
    [
      { platform: 'win32', distribution: 'windows' } as const,
      'Pictor-0.4.0-windows-x64-setup.exe',
      'windows-nsis',
    ],
    [
      { platform: 'linux', distribution: 'arch' } as const,
      'Pictor-0.4.0-arch-x64.pacman',
      'arch-pacman',
    ],
    [
      { platform: 'linux', distribution: 'unsupported-linux' } as const,
      'Pictor-0.4.0-linux-x64.AppImage',
      'linux-appimage',
    ],
  ])('opens only the trusted stable package for %j', async (context, assetName, packageKind) => {
    const { fetch, openExternal, service } = createService(createAppInfo(context), stableResponse())

    await expect(service.check('stable')).resolves.toEqual({
      channel: 'stable',
      currentVersion: '0.3.0',
      latestVersion: '0.4.0',
      latestCommit: null,
      updateAvailable: true,
      packageAvailable: true,
      packageKind,
      publishedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/YozoraTempest/Pictor/releases/latest',
      expect.any(Object),
    )
    await expect(service.openUpdate()).resolves.toBeNull()
    expect(openExternal).toHaveBeenCalledWith(
      `https://github.com/YozoraTempest/Pictor/releases/download/${stableTag}/${assetName}`,
    )
  })

  it('does not expose a target when the stable version is current', async () => {
    const { service } = createService(
      createAppInfo(
        { platform: 'linux', distribution: 'arch' },
        { version: '0.4.0', buildChannel: 'stable', sourceCommit: stableCommit },
      ),
      stableResponse(),
    )

    await expect(service.check('stable')).resolves.toMatchObject({ updateAvailable: false })
    await expect(service.openUpdate()).rejects.toThrow('请先检查更新')
  })

  it('falls back to the trusted stable release page when its package is absent', async () => {
    const { openExternal, service } = createService(
      createAppInfo({ platform: 'linux', distribution: 'unsupported-linux' }),
      stableResponse({ assets: releaseAssets(stableTag, '0.4.0').slice(0, 2) }),
    )

    await expect(service.check('stable')).resolves.toMatchObject({
      packageAvailable: false,
      packageKind: null,
    })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(stableReleaseUrl)
  })

  it('ignores stable assets with a wrong architecture, version, tag, filename, or host', async () => {
    const { openExternal, service } = createService(
      createAppInfo({ platform: 'linux', distribution: 'arch' }),
      stableResponse({
        assets: [
          {
            name: 'Pictor-0.4.0-arch-arm64.pacman',
            browser_download_url:
              'https://github.com/YozoraTempest/Pictor/releases/download/v0.4.0/Pictor-0.4.0-arch-arm64.pacman',
          },
          {
            name: 'Pictor-0.3.9-arch-x64.pacman',
            browser_download_url:
              'https://github.com/YozoraTempest/Pictor/releases/download/v0.4.0/Pictor-0.3.9-arch-x64.pacman',
          },
          {
            name: 'Pictor-0.4.0-arch-x64.pacman',
            browser_download_url:
              'https://github.com/YozoraTempest/Pictor/releases/download/v0.4.0/different.pacman',
          },
          {
            name: 'Pictor-0.4.0-arch-x64.pacman',
            browser_download_url:
              'https://github.com/YozoraTempest/Pictor/releases/download/v0.3.9/Pictor-0.4.0-arch-x64.pacman',
          },
          {
            name: 'Pictor-0.4.0-arch-x64.pacman',
            browser_download_url:
              'https://example.test/YozoraTempest/Pictor/releases/download/v0.4.0/Pictor-0.4.0-arch-x64.pacman',
          },
        ],
      }),
    )

    await expect(service.check('stable')).resolves.toMatchObject({ packageAvailable: false })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(stableReleaseUrl)
  })

  it('rejects a prerelease or untrusted release returned by Latest', async () => {
    const appInfo = createAppInfo({ platform: 'linux', distribution: 'arch' })
    const prerelease = createService(appInfo, stableResponse({ prerelease: true })).service
    await expect(prerelease.check('stable')).rejects.toThrow('预发布版本')

    const untrusted = createService(
      appInfo,
      stableResponse({ html_url: 'https://example.test/release' }),
    ).service
    await expect(untrusted.check('stable')).rejects.toThrow('不受信任的发布地址')
  })
})

describe('nightly updates', () => {
  it.each([
    [
      { platform: 'win32', distribution: 'windows' } as const,
      'Pictor-0.3.0-windows-x64-setup.exe',
      'windows-nsis',
    ],
    [
      { platform: 'linux', distribution: 'arch' } as const,
      'Pictor-0.3.0-arch-x64.pacman',
      'arch-pacman',
    ],
    [
      { platform: 'linux', distribution: 'unsupported-linux' } as const,
      'Pictor-0.3.0-linux-x64.AppImage',
      'linux-appimage',
    ],
  ])('offers the trusted rolling package for %j', async (context, assetName, packageKind) => {
    const { fetch, openExternal, service } = createService(
      createAppInfo(context, { buildChannel: 'stable', sourceCommit: stableCommit }),
      nightlyResponse(),
    )

    await expect(service.check('nightly')).resolves.toEqual({
      channel: 'nightly',
      currentVersion: '0.3.0',
      latestVersion: '0.3.0',
      latestCommit: nightlyCommit,
      updateAvailable: true,
      packageAvailable: true,
      packageKind,
      publishedAt: '2026-09-01T02:17:00.000Z',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/YozoraTempest/Pictor/releases/tags/nightly',
      expect.any(Object),
    )
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(
      `https://github.com/YozoraTempest/Pictor/releases/download/nightly/${assetName}`,
    )
  })

  it('compares Nightly builds by exact source commit instead of SemVer', async () => {
    const current = createService(
      createAppInfo(
        { platform: 'linux', distribution: 'arch' },
        { buildChannel: 'nightly', sourceCommit: nightlyCommit },
      ),
      nightlyResponse(),
    ).service
    await expect(current.check('nightly')).resolves.toMatchObject({ updateAvailable: false })
    await expect(current.openUpdate()).rejects.toThrow('请先检查更新')

    const stale = createService(
      createAppInfo(
        { platform: 'linux', distribution: 'arch' },
        { buildChannel: 'nightly', sourceCommit: olderNightlyCommit },
      ),
      nightlyResponse(),
    ).service
    await expect(stale.check('nightly')).resolves.toMatchObject({ updateAvailable: true })
  })

  it('falls back to the trusted Nightly page when its platform package is absent', async () => {
    const { openExternal, service } = createService(
      createAppInfo({ platform: 'linux', distribution: 'unsupported-linux' }),
      nightlyResponse({ assets: releaseAssets('nightly', '0.3.0').slice(0, 2) }),
    )

    await expect(service.check('nightly')).resolves.toMatchObject({
      latestVersion: null,
      packageAvailable: false,
      packageKind: null,
    })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(nightlyReleaseUrl)
  })

  it.each([
    [{ tag_name: 'v0.3.0' }, 'Nightly 发布信息'],
    [{ prerelease: false }, 'Nightly 发布信息'],
    [{ target_commitish: 'develop' }, 'Nightly 发布信息'],
  ])('rejects invalid rolling release identity %j', async (overrides, message) => {
    const { service } = createService(
      createAppInfo({ platform: 'linux', distribution: 'arch' }),
      nightlyResponse(overrides),
    )
    await expect(service.check('nightly')).rejects.toThrow(message)
  })
})

describe('compareVersions', () => {
  it('compares stable and prerelease semantic versions', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
  })
})
