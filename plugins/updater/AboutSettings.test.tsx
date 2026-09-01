// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import type { AppInfo, UpdaterClient } from '../../src/modules/updater/shared.js'
import type { IpcResult } from '../../src/shared/errors.js'
import { AboutSettings } from './AboutSettings.js'

const now = '2026-08-11T00:00:00.000Z'

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

function createUpdater(overrides: Partial<UpdaterClient> = {}): UpdaterClient {
  const appInfo: AppInfo = {
    name: 'Pictor',
    version: '0.1.0',
    buildChannel: 'stable',
    sourceCommit: 'a'.repeat(40),
    platform: 'win32',
    arch: 'x64',
    distribution: 'windows',
  }
  return {
    getSnapshot: async () => ({ appInfo, channel: 'stable' }),
    setChannel: async (channel) => ({ appInfo, channel }),
    checkForUpdates: async () =>
      ok({
        channel: 'stable',
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        latestCommit: null,
        updateAvailable: true,
        packageAvailable: true,
        packageKind: 'windows-nsis',
        publishedAt: now,
      }),
    openUpdate: async () => ok(null),
    ...overrides,
  }
}

it('shows app information and downloads an available update', async () => {
  const checkForUpdates = vi.fn(async () =>
    ok({
      channel: 'stable' as const,
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      latestCommit: null,
      updateAvailable: true,
      packageAvailable: true,
      packageKind: 'windows-nsis' as const,
      publishedAt: now,
    }),
  )
  const openUpdate = vi.fn(async () => ok(null))

  render(<AboutSettings client={createUpdater({ checkForUpdates, openUpdate })} />)

  await waitFor(() => expect(screen.getByText('v0.1.0')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('发现新版本 v0.2.0')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下载发行包' }))
  await waitFor(() => expect(openUpdate).toHaveBeenCalledOnce())
})

it('selects and checks the persisted rolling Nightly channel', async () => {
  const appInfo: AppInfo = {
    name: 'Pictor',
    version: '0.3.0',
    buildChannel: 'stable',
    sourceCommit: 'a'.repeat(40),
    platform: 'win32',
    arch: 'x64',
    distribution: 'windows',
  }
  const setChannel = vi.fn(async (channel: 'stable' | 'nightly') => ({ appInfo, channel }))
  const checkForUpdates = vi.fn(async () =>
    ok({
      channel: 'nightly' as const,
      currentVersion: '0.3.0',
      latestVersion: '0.3.0',
      latestCommit: 'b'.repeat(40),
      updateAvailable: true,
      packageAvailable: true,
      packageKind: 'windows-nsis' as const,
      publishedAt: now,
    }),
  )

  render(
    <AboutSettings
      client={createUpdater({
        getSnapshot: async () => ({ appInfo, channel: 'stable' }),
        setChannel,
        checkForUpdates,
      })}
    />,
  )

  await waitFor(() => expect(screen.getByLabelText('更新通道')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('更新通道'), { target: { value: 'nightly' } })
  await waitFor(() => expect(setChannel).toHaveBeenCalledWith('nightly'))
  expect(await screen.findByRole('note')).toHaveTextContent('最新通过 CI 的 develop 快照')

  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('可以切换到 Nightly bbbbbbb')).toBeInTheDocument()
  expect(checkForUpdates).toHaveBeenCalledOnce()
})

it('shows the Linux platform in app information', async () => {
  render(
    <AboutSettings
      client={createUpdater({
        getSnapshot: async () => ({
          channel: 'stable',
          appInfo: {
            name: 'Pictor',
            version: '0.1.0',
            buildChannel: 'stable',
            sourceCommit: 'a'.repeat(40),
            platform: 'linux',
            arch: 'x64',
            distribution: 'arch',
          },
        }),
      })}
    />,
  )

  expect(await screen.findByText('Linux x64')).toBeInTheDocument()
})
