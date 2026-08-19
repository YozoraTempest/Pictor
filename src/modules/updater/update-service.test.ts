// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { UpdateService, compareVersions } from './update-service.js'

const releaseUrl = 'https://github.com/YozoraTempest/Pictor/releases/tag/v0.2.0'
const windowsPackageUrl =
  'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-windows-x64-setup.exe'
const archPackageUrl =
  'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-arch-x64.pacman'
const appImageUrl =
  'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-linux-x64.AppImage'

const releaseAssets = [
  {
    name: 'Pictor-0.2.0-windows-x64-setup.exe',
    browser_download_url: windowsPackageUrl,
  },
  { name: 'Pictor-0.2.0-arch-x64.pacman', browser_download_url: archPackageUrl },
  { name: 'Pictor-0.2.0-linux-x64.AppImage', browser_download_url: appImageUrl },
]

function releaseResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tag_name: 'v0.2.0',
    html_url: releaseUrl,
    published_at: '2026-08-12T00:00:00.000Z',
    assets: releaseAssets,
    ...overrides,
  })
}

function createService(
  context:
    | { platform: 'win32'; distribution: 'windows' }
    | { platform: 'linux'; distribution: 'arch' | 'unsupported-linux' },
  overrides: { currentVersion?: string; response?: Response } = {},
) {
  const openExternal = vi.fn(async () => undefined)
  const service = new UpdateService({
    currentVersion: overrides.currentVersion ?? '0.1.0',
    platform: context.platform,
    distribution: context.distribution,
    arch: 'x64',
    fetch: vi.fn<typeof fetch>().mockResolvedValue(overrides.response ?? releaseResponse()),
    openExternal,
  })
  return { openExternal, service }
}

describe('UpdateService', () => {
  it.each([
    [{ platform: 'win32', distribution: 'windows' } as const, windowsPackageUrl, 'windows-nsis'],
    [{ platform: 'linux', distribution: 'arch' } as const, archPackageUrl, 'arch-pacman'],
    [
      { platform: 'linux', distribution: 'unsupported-linux' } as const,
      appImageUrl,
      'linux-appimage',
    ],
  ])('opens only the trusted package for %j', async (context, packageUrl, packageKind) => {
    const { openExternal, service } = createService(context)

    await expect(service.check()).resolves.toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      packageAvailable: true,
      packageKind,
      publishedAt: '2026-08-12T00:00:00.000Z',
    })
    await expect(service.openUpdate()).resolves.toBeNull()
    expect(openExternal).toHaveBeenCalledWith(packageUrl)
  })

  it('does not expose an update target when the current version is latest', async () => {
    const { service } = createService(
      { platform: 'linux', distribution: 'arch' },
      { currentVersion: '0.2.0' },
    )

    await expect(service.check()).resolves.toMatchObject({ updateAvailable: false })
    await expect(service.openUpdate()).rejects.toThrow('请先检查更新')
  })

  it('falls back to the trusted release page when the expected asset is absent', async () => {
    const { openExternal, service } = createService(
      { platform: 'linux', distribution: 'unsupported-linux' },
      { response: releaseResponse({ assets: releaseAssets.slice(0, 2) }) },
    )

    await expect(service.check()).resolves.toMatchObject({
      packageAvailable: false,
      packageKind: null,
    })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(releaseUrl)
  })

  it('ignores assets with a wrong architecture, version, release tag, URL filename, or host', async () => {
    const response = releaseResponse({
      assets: [
        {
          name: 'Pictor-0.2.0-arch-arm64.pacman',
          browser_download_url:
            'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-arch-arm64.pacman',
        },
        {
          name: 'Pictor-0.1.9-arch-x64.pacman',
          browser_download_url:
            'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.1.9-arch-x64.pacman',
        },
        {
          name: 'Pictor-0.2.0-arch-x64.pacman',
          browser_download_url:
            'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/different.pacman',
        },
        {
          name: 'Pictor-0.2.0-arch-x64.pacman',
          browser_download_url:
            'https://github.com/YozoraTempest/Pictor/releases/download/v0.1.9/Pictor-0.2.0-arch-x64.pacman',
        },
        {
          name: 'Pictor-0.2.0-arch-x64.pacman',
          browser_download_url:
            'https://example.test/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-arch-x64.pacman',
        },
      ],
    })
    const { openExternal, service } = createService(
      { platform: 'linux', distribution: 'arch' },
      { response },
    )

    await expect(service.check()).resolves.toMatchObject({ packageAvailable: false })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(releaseUrl)
  })

  it('rejects release URLs outside the official repository', async () => {
    const { service } = createService(
      { platform: 'linux', distribution: 'unsupported-linux' },
      { response: releaseResponse({ html_url: 'https://example.test/release' }) },
    )

    await expect(service.check()).rejects.toThrow('不受信任的发布地址')
  })

  it('rejects an official release URL whose tag does not match the payload', async () => {
    const { service } = createService(
      { platform: 'linux', distribution: 'unsupported-linux' },
      {
        response: releaseResponse({
          html_url: 'https://github.com/YozoraTempest/Pictor/releases/tag/v0.1.9',
        }),
      },
    )

    await expect(service.check()).rejects.toThrow('不受信任的发布地址')
  })
})

describe('compareVersions', () => {
  it('compares stable and prerelease semantic versions', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
  })
})
