// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { executeCommandAndWait } from './index.js'
import { appDoctorResultSchema, createCoreCommandDefinitions } from './core.js'
import type { PluginManagerCommandPort } from './core.js'
import { CommandEngine } from './engine.js'
import { appInfoSchema } from '../shared/app-info.js'
import { pluginManagerSnapshotSchema } from '../shared/plugins.js'

const appInfo = appInfoSchema.parse({
  name: 'Pictor',
  version: '0.3.0',
  buildChannel: 'development',
  sourceCommit: null,
  platform: 'linux',
  arch: 'x64',
  distribution: 'unsupported-linux',
})

const snapshot = pluginManagerSnapshotSchema.parse({
  safeMode: false,
  restartRequired: false,
  items: [],
  issues: [],
})

describe('Core Command definitions', () => {
  it('registers app and Plugin Manager commands without duplicating PluginManager behavior', async () => {
    const pluginManager: PluginManagerCommandPort = {
      getSnapshot: vi.fn(async () => snapshot),
      installLocal: vi.fn(async () => snapshot),
      installDevelopment: vi.fn(async () => snapshot),
      installPiExtension: vi.fn(async () => snapshot),
      installPiPackage: vi.fn(async () => snapshot),
      installPiPackageSpec: vi.fn(async () => snapshot),
      setEnabled: vi.fn(async () => snapshot),
      remove: vi.fn(async () => snapshot),
      restoreBundled: vi.fn(async () => snapshot),
    }
    const engine = new CommandEngine(createCoreCommandDefinitions(appInfo, pluginManager))
    const client = engine.getClient()

    await expect(
      executeCommandAndWait(client, 'app.info', null, { frontend: 'gui' }, appInfoSchema),
    ).resolves.toEqual(appInfo)
    await expect(
      executeCommandAndWait(
        client,
        'app.doctor',
        null,
        { frontend: 'shell' },
        appDoctorResultSchema,
      ),
    ).resolves.toMatchObject({ status: 'ok' })
    await executeCommandAndWait(
      client,
      'plugin.list',
      null,
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.install',
      { source: 'local', path: '/tmp/test-plugin' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.install',
      { source: 'development', path: '/tmp/development-plugin' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.install',
      { source: 'pi-extension', path: '/tmp/extension.ts' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.install',
      { source: 'pi-package', path: '/tmp/pi-package' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.install',
      { source: 'pi-package-spec', spec: 'example-package' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.enable',
      { kind: 'pictor-plugin', id: 'pictor.test' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.disable',
      { kind: 'pictor-plugin', id: 'pictor.test' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.remove',
      { kind: 'pictor-plugin', id: 'pictor.test', deleteData: true },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )
    await executeCommandAndWait(
      client,
      'plugin.restore',
      { id: 'pictor.test' },
      { frontend: 'gui' },
      pluginManagerSnapshotSchema,
    )

    expect(pluginManager.getSnapshot).toHaveBeenCalledTimes(2)
    expect(pluginManager.installLocal).toHaveBeenCalledWith('/tmp/test-plugin')
    expect(pluginManager.installDevelopment).toHaveBeenCalledWith('/tmp/development-plugin')
    expect(pluginManager.installPiExtension).toHaveBeenCalledWith('/tmp/extension.ts')
    expect(pluginManager.installPiPackage).toHaveBeenCalledWith('/tmp/pi-package')
    expect(pluginManager.installPiPackageSpec).toHaveBeenCalledWith('example-package')
    expect(pluginManager.setEnabled).toHaveBeenNthCalledWith(
      1,
      'pictor-plugin',
      'pictor.test',
      true,
    )
    expect(pluginManager.setEnabled).toHaveBeenNthCalledWith(
      2,
      'pictor-plugin',
      'pictor.test',
      false,
    )
    expect(pluginManager.remove).toHaveBeenCalledWith('pictor-plugin', 'pictor.test', true)
    expect(pluginManager.restoreBundled).toHaveBeenCalledWith('pictor.test')
    await engine.dispose()
  })

  it('rejects malformed Core command input before the Plugin Manager is called', async () => {
    const pluginManager: PluginManagerCommandPort = {
      getSnapshot: vi.fn(async () => snapshot),
      installLocal: vi.fn(async () => snapshot),
      installDevelopment: vi.fn(async () => snapshot),
      installPiExtension: vi.fn(async () => snapshot),
      installPiPackage: vi.fn(async () => snapshot),
      installPiPackageSpec: vi.fn(async () => snapshot),
      setEnabled: vi.fn(async () => snapshot),
      remove: vi.fn(async () => snapshot),
      restoreBundled: vi.fn(async () => snapshot),
    }
    const engine = new CommandEngine(createCoreCommandDefinitions(appInfo, pluginManager))

    await expect(
      engine
        .getClient()
        .execute('plugin.install', { source: 'local', path: '' }, { frontend: 'gui' }),
    ).rejects.toMatchObject({ code: 'invalid-input', commandId: 'plugin.install' })
    expect(pluginManager.installLocal).not.toHaveBeenCalled()
    await engine.dispose()
  })
})
