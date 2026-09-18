// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const runtimeSupervisorConstructor = vi.fn()
  class FakeRuntimeSupervisor {
    constructor(...arguments_: unknown[]) {
      runtimeSupervisorConstructor(...arguments_)
    }
  }

  const applicationHostConstructor = vi.fn()
  const services = { runtime: { handleEvent: vi.fn(), handleSessionReplacementRequest: vi.fn() } }
  class FakeApplicationHost {
    constructor(options: unknown) {
      applicationHostConstructor(options)
    }

    start = vi.fn(async () => services)
  }

  return {
    RuntimeSupervisor: FakeRuntimeSupervisor,
    runtimeSupervisorConstructor,
    ApplicationHost: FakeApplicationHost,
    applicationHostConstructor,
    createHostPluginDefinitions: vi.fn(() => []),
    services,
  }
})

vi.mock('../runtime/supervisor.js', () => ({ RuntimeSupervisor: mocks.RuntimeSupervisor }))
vi.mock('./host.js', () => ({ ApplicationHost: mocks.ApplicationHost }))
vi.mock('../plugin/loader.js', () => ({
  createHostPluginDefinitions: mocks.createHostPluginDefinitions,
}))

import { createNodeApplication } from './node-application.js'

beforeEach(() => {
  mocks.runtimeSupervisorConstructor.mockClear()
  mocks.applicationHostConstructor.mockClear()
  mocks.createHostPluginDefinitions.mockClear()
})

describe('createNodeApplication', () => {
  it('owns the shared RuntimeSupervisor and ApplicationHost composition', async () => {
    const frontendLock = { acquire: vi.fn() }
    const eventPublisher = { publish: vi.fn() }
    const secretStore = {}
    const updaterHost = { fetch: globalThis.fetch, openExternal: vi.fn() }
    const appInfo = {
      name: 'Pictor',
      version: '0.4.0',
      buildChannel: 'development' as const,
      sourceCommit: null,
      platform: 'linux' as const,
      arch: 'x64' as const,
      distribution: 'unsupported-linux' as const,
    }
    const profile = { id: 'pictor.test', plugins: {} }

    const application = await createNodeApplication({
      userDataDirectory: '/tmp/pictor-node-application',
      runtimeHostPath: '/workspace/out/runtime/host.js',
      runtimeEnvironment: { PICTOR_TEST: '1' },
      appInfo,
      bundledPluginsDirectory: '/workspace/bundled-plugins',
      frontendLock,
      profile,
      eventPublisher,
      secretStore: secretStore as never,
      updaterHost,
      safeMode: true,
      creationMode: true,
    })

    expect(mocks.runtimeSupervisorConstructor).toHaveBeenCalledWith(
      expect.any(Function),
      undefined,
      expect.any(Function),
      {
        runtimeHostPath: '/workspace/out/runtime/host.js',
        environment: { PICTOR_TEST: '1' },
      },
    )
    expect(mocks.applicationHostConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        userData: {
          userDataDirectory: '/tmp/pictor-node-application',
          dataDirectory: '/tmp/pictor-node-application/data-v1',
        },
        appInfo,
        bundledPluginsDirectory: '/workspace/bundled-plugins',
        frontendLock,
        profile,
        eventPublisher,
        secretStore,
        safeMode: true,
        creationMode: true,
        createHostPluginDefinitions: expect.any(Function),
      }),
    )
    expect(application).toMatchObject({ services: mocks.services })
  })
})
