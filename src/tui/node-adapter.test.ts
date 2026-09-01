// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

import {
  createTuiNodeApplication,
  createTuiProfileLock,
  createTuiUpdaterHostAdapter,
} from './node-adapter.js'

const execFileAsync = promisify(execFile)

it('provides a frontend-safe Updater adapter without Electron', async () => {
  const adapter = createTuiUpdaterHostAdapter()

  expect(adapter.fetch).toBe(globalThis.fetch)
  await expect(adapter.openExternal('https://example.test/update')).rejects.toMatchObject({
    code: 'internal',
    message: 'TUI 不支持打开外部更新链接，请在 GUI 中操作',
  })
})

it('activates the default TUI Host Profile without Updater failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pictor-tui-host-'))
  try {
    const bundledPluginsDirectory = join(root, 'bundled-plugins')
    await execFileAsync(process.execPath, [resolve('scripts/build-plugins.mjs')], {
      cwd: resolve('.'),
      env: { ...process.env, PICTOR_BUNDLED_PLUGINS_OUTPUT: bundledPluginsDirectory },
    })

    const userDataDirectory = join(root, 'user-data')
    const application = await createTuiNodeApplication(
      {
        userData: {
          userDataDirectory,
          dataDirectory: join(userDataDirectory, 'data-v1'),
        },
        frontendLock: createTuiProfileLock(userDataDirectory),
        safeMode: false,
      },
      {
        version: '0.4.0',
        projectRoot: resolve('.'),
        bundledPluginsDirectory,
        platform: 'linux',
        homeDirectory: root,
        environment: {},
        emit: () => undefined,
      },
    )

    try {
      const services = await application.applicationHost.start()
      const statuses = services.pluginHost.getStatuses()
      expect(statuses.filter(({ effectiveState }) => effectiveState === 'failed')).toEqual([])
      expect(statuses.filter(({ effectiveState }) => effectiveState === 'blocked')).toEqual([])
      expect(statuses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'pictor.updater', effectiveState: 'active' }),
        ]),
      )
    } finally {
      await application.applicationHost.stop()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
