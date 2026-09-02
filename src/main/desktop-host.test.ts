// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeEventEmitter {
    private readonly listeners = new Map<string, Set<Listener>>()

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: Listener): this {
      const onceListener: Listener = (...args) => {
        this.removeListener(event, onceListener)
        listener(...args)
      }
      return this.on(event, onceListener)
    }

    removeListener(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event)
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(event)
      return this
    }

    removeAllListeners(): this {
      this.listeners.clear()
      return this
    }

    emit(event: string, ...args: unknown[]): boolean {
      const listeners = this.listeners.get(event)
      if (!listeners) return false
      for (const listener of [...listeners]) listener(...args)
      return true
    }
  }

  class FakeWebContents extends FakeEventEmitter {
    setWindowOpenHandler = vi.fn()
  }

  class FakeBrowserWindow extends FakeEventEmitter {
    static instances: FakeBrowserWindow[] = []
    static getAllWindows = vi.fn(() => [...FakeBrowserWindow.instances])

    readonly options: unknown
    readonly webContents = new FakeWebContents()
    readonly loadURL = vi.fn(async (_url: string): Promise<void> => undefined)
    readonly show = vi.fn()
    readonly showInactive = vi.fn()
    readonly close = vi.fn(() => {
      const index = FakeBrowserWindow.instances.indexOf(this)
      if (index >= 0) FakeBrowserWindow.instances.splice(index, 1)
      this.emit('closed')
    })

    constructor(options: unknown) {
      super()
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }
  }

  const app = Object.assign(new FakeEventEmitter(), {
    isPackaged: false,
    getVersion: vi.fn(() => '0.4.0'),
    getPath: vi.fn(() => '/tmp/pictor-desktop-host-test'),
    getName: vi.fn(() => 'Pictor'),
    requestSingleInstanceLock: vi.fn(() => true),
    releaseSingleInstanceLock: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn(),
    enableSandbox: vi.fn(),
  })

  const runtime = { isActive: vi.fn(() => false) }
  const services = {
    appInfo: {
      name: 'Pictor',
      version: '0.4.0',
      buildChannel: 'development',
      sourceCommit: null,
      platform: 'linux',
      arch: 'x64',
      distribution: 'unsupported-linux',
    },
    commandClient: {},
    repository: {},
    pluginStore: {},
    pluginHost: {},
    pluginManager: {},
    runtime,
    moduleRouter: {},
    getPluginBootstrap: vi.fn(async () => ({})),
    restoreSelectedContext: vi.fn(async () => undefined),
  }
  const applicationHost = {
    start: vi.fn(async () => services),
    stop: vi.fn(async () => undefined),
  }
  const disposable = () => ({ dispose: vi.fn(async () => undefined) })
  class FakeModelConnectionTester {}
  class FakeProfileFileLock {}
  class FakeRuntimeSupervisor {}
  class FakeSecretStore {}

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: { showMessageBoxSync: vi.fn(() => 0) },
    net: { fetch: vi.fn(async () => new Response()) },
    protocol: { handle: vi.fn() },
    safeStorage: {},
    session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
    shell: { openExternal: vi.fn() },
    ApplicationHost: vi.fn(function FakeApplicationHost() {
      return applicationHost
    }),
    ModelConnectionTester: FakeModelConnectionTester,
    ProfileFileLock: FakeProfileFileLock,
    RuntimeSupervisor: FakeRuntimeSupervisor,
    SecretStore: FakeSecretStore,
    detectDesktopDistribution: vi.fn(async () => 'unsupported-linux'),
    registerCommandIpc: vi.fn(disposable),
    registerIpc: vi.fn(disposable),
    registerModuleIpc: vi.fn(disposable),
    broadcastModuleEvent: vi.fn(),
    createHostPluginDefinitions: vi.fn(() => []),
    getSecureWebPreferences: vi.fn(() => ({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })),
    isTrustedRendererUrl: vi.fn(() => true),
    shouldShowMainWindow: vi.fn(() => false),
    shouldShowMainWindowWithoutFocus: vi.fn(() => false),
    applicationHost,
    services,
    reset() {
      app.removeAllListeners()
      FakeBrowserWindow.instances = []
      FakeBrowserWindow.getAllWindows.mockClear()
      applicationHost.start.mockClear()
      applicationHost.stop.mockClear()
      runtime.isActive.mockClear()
    },
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  dialog: mocks.dialog,
  net: mocks.net,
  protocol: mocks.protocol,
  safeStorage: mocks.safeStorage,
  session: mocks.session,
  shell: mocks.shell,
}))

vi.mock('../application/index.js', () => ({
  ApplicationHost: mocks.ApplicationHost,
  ModelConnectionTester: mocks.ModelConnectionTester,
  ProfileFileLock: mocks.ProfileFileLock,
}))

vi.mock('../modules/agent-workspace/shared.js', () => ({
  agentWorkspaceContract: { id: 'pictor.agent-workspace' },
}))

vi.mock('./command-ipc.js', () => ({ registerCommandIpc: mocks.registerCommandIpc }))
vi.mock('./ipc.js', () => ({ registerIpc: mocks.registerIpc }))
vi.mock('./module-ipc.js', () => ({
  broadcastModuleEvent: mocks.broadcastModuleEvent,
  registerModuleIpc: mocks.registerModuleIpc,
}))
vi.mock('./plugins/plugin-loader.js', () => ({
  createHostPluginDefinitions: mocks.createHostPluginDefinitions,
}))
vi.mock('./plugins/default-profile.js', () => ({
  defaultPluginProfile: undefined,
  developerPluginProfile: undefined,
}))
vi.mock('./persistence/secret-store.js', () => ({ SecretStore: mocks.SecretStore }))
vi.mock('./runtime/supervisor.js', () => ({ RuntimeSupervisor: mocks.RuntimeSupervisor }))
vi.mock('./linux-distribution.js', () => ({
  detectDesktopDistribution: mocks.detectDesktopDistribution,
}))
vi.mock('./security.js', () => ({
  getSecureWebPreferences: mocks.getSecureWebPreferences,
  isTrustedRendererUrl: mocks.isTrustedRendererUrl,
}))
vi.mock('./window-visibility.js', () => ({
  shouldShowMainWindow: mocks.shouldShowMainWindow,
  shouldShowMainWindowWithoutFocus: mocks.shouldShowMainWindowWithoutFocus,
}))

let DesktopHost: typeof import('./desktop-host.js').DesktopHost

beforeAll(async () => {
  vi.stubGlobal('__PICTOR_BUILD_CHANNEL__', 'development')
  vi.stubGlobal('__PICTOR_SOURCE_COMMIT__', null)
  ;({ DesktopHost } = await import('./desktop-host.js'))
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => mocks.reset())

function mainWindowOf(host: InstanceType<typeof DesktopHost>): unknown {
  return (host as unknown as { mainWindow: unknown }).mainWindow
}

describe('DesktopHost main window ownership', () => {
  it('retains the startup and activated windows until their matching close, then stops cleanly', async () => {
    const host = new DesktopHost()

    await host.start()
    const firstWindow = mocks.BrowserWindow.instances[0]!
    expect(mainWindowOf(host)).toBe(firstWindow)

    mocks.BrowserWindow.instances.splice(0, 1)
    mocks.app.emit('activate')
    const activatedWindow = mocks.BrowserWindow.instances[0]!
    expect(mainWindowOf(host)).toBe(activatedWindow)

    firstWindow.emit('closed')
    expect(mainWindowOf(host)).toBe(activatedWindow)

    mocks.BrowserWindow.instances.splice(0, 1)
    activatedWindow.emit('closed')
    expect(mainWindowOf(host)).toBeNull()

    mocks.app.emit('activate')
    const replacementWindow = mocks.BrowserWindow.instances[0]!
    expect(mainWindowOf(host)).toBe(replacementWindow)

    await host.stop()
    expect(mainWindowOf(host)).toBeNull()
  })
})
