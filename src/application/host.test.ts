// @vitest-environment node

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  defineModuleContract,
  moduleHandlerContributions,
  registerModuleHandlers,
} from '../kernel/contract.js'
import { defineModule } from '../kernel/module.js'
import { pluginManifestSchema } from '../plugin/manifest.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import type { RuntimePluginBootstrap } from '../shared/plugins.js'
import { ApplicationHost, type ApplicationHostOptions } from './host.js'
import type { EventPublisher, FrontendLock, RuntimeHost, UserData } from './ports.js'

const roots: string[] = []

const appInfo: AppInfo = appInfoSchema.parse({
  name: 'Pictor',
  version: '0.4.0',
  buildChannel: 'development',
  sourceCommit: null,
  platform: 'linux',
  arch: 'x64',
  distribution: 'unsupported-linux',
})

function runtimeHost(): RuntimeHost & {
  configurePluginBootstrap: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  const configurePluginBootstrap = vi.fn<(bootstrap: RuntimePluginBootstrap) => void>()
  const dispose = vi.fn(async () => undefined)
  return {
    configurePluginBootstrap,
    start: vi.fn(async () => undefined),
    fork: vi.fn(async () => {
      throw new Error('unused')
    }),
    importSession: vi.fn(async () => {
      throw new Error('unused')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('unused')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('unused')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('unused')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('unused')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources: vi.fn(async () => undefined),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
    isActive: vi.fn(() => false),
    dispose,
  }
}

async function createOptions(overrides: Partial<ApplicationHostOptions> = {}): Promise<{
  options: ApplicationHostOptions
  release: ReturnType<typeof vi.fn>
  runtime: ReturnType<typeof runtimeHost>
}> {
  const root = await mkdtemp(join(tmpdir(), 'pictor-application-host-'))
  roots.push(root)
  const userData: UserData = {
    userDataDirectory: join(root, 'user-data'),
    dataDirectory: join(root, 'user-data', 'data-v1'),
  }
  const release = vi.fn()
  const frontendLock: FrontendLock = {
    acquire: vi.fn(async () => ({ release })),
  }
  const eventPublisher: EventPublisher = { publish: vi.fn() }
  const runtime = runtimeHost()
  const bundledPluginsDirectory = join(root, 'bundled-plugins')
  const options: ApplicationHostOptions = {
    userData,
    appInfo,
    bundledPluginsDirectory,
    runtimeHost: runtime,
    eventPublisher,
    frontendLock,
    createHostPluginDefinitions: () => [],
    ...overrides,
  }
  await mkdir(bundledPluginsDirectory, { recursive: true })
  return { options, release, runtime }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ApplicationHost', () => {
  it('assembles pure Plugin Modules through the headless boundary', async () => {
    const events: string[] = []
    const contract = defineModuleContract({
      id: 'pictor.test.application',
      methods: { ping: { input: z.null(), output: z.literal('pong') } },
      events: {},
    })
    const { options } = await createOptions({
      createHostPluginDefinitions: () => [
        {
          manifest: pluginManifestSchema.parse({
            id: 'pictor.test',
            name: 'Test',
            version: '0.4.0',
            engines: { pictor: '^0.4.0' },
            dependencies: {},
            modules: {},
          }),
          desiredState: 'enabled',
          createModules: () => [
            defineModule({
              id: 'pictor.test.host',
              activate(context) {
                context.onDispose({ dispose: () => void events.push('stopped') })
                context.contribute(
                  moduleHandlerContributions,
                  registerModuleHandlers(contract, { ping: () => 'pong' as const }),
                )
              },
            }),
          ],
        },
      ],
    })
    const host = new ApplicationHost(options)
    const services = await host.start()

    await expect(services.moduleRouter.invoke(contract.id, 'ping', null)).resolves.toBe('pong')
    await host.stop()
    expect(events).toEqual(['stopped'])
  })

  it('starts the headless application and releases every owned resource on stop', async () => {
    const { options, release, runtime } = await createOptions()
    const host = new ApplicationHost(options)

    const services = await host.start()

    expect(services.appInfo).toEqual(appInfo)
    expect(runtime.configurePluginBootstrap).toHaveBeenCalledWith(
      expect.objectContaining<Partial<RuntimePluginBootstrap>>({
        safeMode: false,
        pictorVersion: appInfo.version,
      }),
    )
    await expect(services.commandClient.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'app.info' }),
        expect.objectContaining({ id: 'app.doctor' }),
        expect.objectContaining({ id: 'plugin.list' }),
        expect.objectContaining({ id: 'plugin.install' }),
        expect.objectContaining({ id: 'plugin.enable' }),
        expect.objectContaining({ id: 'plugin.disable' }),
        expect.objectContaining({ id: 'plugin.remove' }),
        expect.objectContaining({ id: 'plugin.restore' }),
      ]),
    )

    await host.stop()
    await host.stop()

    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    await expect(services.commandClient.list()).rejects.toMatchObject({ code: 'engine-disposed' })
  })

  it('cleans up the lock and Runtime when Plugin assembly fails', async () => {
    const { options, release, runtime } = await createOptions({
      createHostPluginDefinitions: () => {
        throw new Error('plugin assembly failed')
      },
    })
    const host = new ApplicationHost(options)

    await expect(host.start()).rejects.toThrow('plugin assembly failed')
    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    await expect(host.stop()).resolves.toBeUndefined()
  })

  it('does not initialize a Profile when its Frontend lock is unavailable', async () => {
    const acquire = vi.fn(async () => null)
    const { options, runtime } = await createOptions({ frontendLock: { acquire } })
    const host = new ApplicationHost(options)

    await expect(host.start()).rejects.toThrow('当前 Profile 已被另一个 Frontend 使用')
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(runtime.configurePluginBootstrap).not.toHaveBeenCalled()
  })
})
