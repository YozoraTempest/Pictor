// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { UpdateService, compareVersions } from './update-service.js'

const releaseUrl = 'https://github.com/YozoraTempest/Pictor/releases/tag/v0.2.0'
const installerUrl =
  'https://github.com/YozoraTempest/Pictor/releases/download/v0.2.0/Pictor-0.2.0-windows-x64-setup.exe'

function releaseResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tag_name: 'v0.2.0',
    html_url: releaseUrl,
    published_at: '2026-08-12T00:00:00.000Z',
    assets: [{ name: 'Pictor-0.2.0-windows-x64-setup.exe', browser_download_url: installerUrl }],
    ...overrides,
  })
}

describe('UpdateService', () => {
  it('finds a newer stable version and opens its trusted installer', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = new UpdateService({
      currentVersion: '0.1.0',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(releaseResponse()),
      openExternal,
    })

    await expect(service.check()).resolves.toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      installerAvailable: true,
      publishedAt: '2026-08-12T00:00:00.000Z',
    })
    await expect(service.openUpdate()).resolves.toBeNull()
    expect(openExternal).toHaveBeenCalledWith(installerUrl)
  })

  it('does not expose an update target when the current version is latest', async () => {
    const service = new UpdateService({
      currentVersion: '0.2.0',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(releaseResponse()),
      openExternal: vi.fn(async () => undefined),
    })

    await expect(service.check()).resolves.toMatchObject({ updateAvailable: false })
    await expect(service.openUpdate()).rejects.toThrow('请先检查更新')
  })

  it('falls back to the trusted release page when no installer is attached', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = new UpdateService({
      currentVersion: '0.1.0',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(releaseResponse({ assets: [] })),
      openExternal,
    })

    await expect(service.check()).resolves.toMatchObject({ installerAvailable: false })
    await service.openUpdate()
    expect(openExternal).toHaveBeenCalledWith(releaseUrl)
  })

  it('rejects release URLs outside the official repository', async () => {
    const service = new UpdateService({
      currentVersion: '0.1.0',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(releaseResponse({ html_url: 'https://example.test/release' })),
      openExternal: vi.fn(async () => undefined),
    })

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
