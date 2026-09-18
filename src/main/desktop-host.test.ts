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
    getAppPath: vi.fn(() => '/workspace/Pictor'),
    getVersion: vi.fn(() => '0.4.0'),
    getPath: vi.fn(() => '/tmp/pictor-desktop-host-test'),
    getName: vi.fn(() => 'Pictor'),
    requestSingleInstanceLock: vi.fn(() => true),
    releaseSingleInstanceLock: vi.fn(),
    quit: vi.fn(),
  })
  const runtime = { isActive: vi.fn(() => false) }
  const services = { runtime }
  const applicationHost = { stop: vi.fn(async () => undefined) }
  const application = { applicationHost, services }
  const address = {
    origin: 'http://127.0.0.1:43123',
    launchUrl: 'http://127.0.0.1:43123/?token=launch-token',
  }
  const serverStop = vi.fn(async () => undefined)
  const webHostServerConstructor = vi.fn()
  class FakeWebHostServer {
    constructor(options: unknown) {
      webHostServerConstructor(options)
    }

    start = vi.fn(async () => address)
    stop = serverStop
  }
  class FakeProfileFileLock {}
  class FakeSecretStore {}
  class FakeEventHub {
    publish = vi.fn()
  }
  class FakeWebFileTransferStore {}
  const platformIpc = { dispose: vi.fn(async () => undefined) }

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: { showMessageBoxSync: vi.fn(() => 0) },
    net: { fetch: vi.fn(async () => new Response()) },
    safeStorage: {},
    session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
    shell: { openExternal: vi.fn(async () => undefined) },
    createNodeApplication: vi.fn(async () => application),
    ProfileFileLock: FakeProfileFileLock,
    SecretStore: FakeSecretStore,
    EventHub: FakeEventHub,
    WebFileTransferStore: FakeWebFileTransferStore,
    WebHostServer: FakeWebHostServer,
    webHostServerConstructor,
    registerIpc: vi.fn(() => platformIpc),
    platformIpc,
    detectDesktopDistribution: vi.fn(async () => 'unsupported-linux'),
    getSecureWebPreferences: vi.fn(() => ({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })),
    isTrustedRendererUrl: vi.fn(() => true),
    applicationHost,
    serverStop,
    runtime,
    address,
    reset() {
      app.removeAllListeners()
      FakeBrowserWindow.instances = []
      FakeBrowserWindow.getAllWindows.mockClear()
      applicationHost.stop.mockClear()
      serverStop.mockClear()
      runtime.isActive.mockClear()
      webHostServerConstructor.mockClear()
      platformIpc.dispose.mockClear()
      this.createNodeApplication.mockClear()
      this.registerIpc.mockClear()
    },
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  dialog: mocks.dialog,
  net: mocks.net,
  safeStorage: mocks.safeStorage,
  session: mocks.session,
  shell: mocks.shell,
}))
vi.mock('../application/index.js', () => ({
  createNodeApplication: mocks.createNodeApplication,
  ProfileFileLock: mocks.ProfileFileLock,
}))
vi.mock('../node/linux-distribution.js', () => ({
  detectDesktopDistribution: mocks.detectDesktopDistribution,
}))
vi.mock('../node/persistence/secret-store.js', () => ({ SecretStore: mocks.SecretStore }))
vi.mock('../plugin/default-profile.js', () => ({
  defaultPluginProfile: { id: 'pictor.default', plugins: {} },
  developerPluginProfile: { id: 'pictor.developer', plugins: {} },
}))
vi.mock('../web-host/event-hub.js', () => ({ EventHub: mocks.EventHub }))
vi.mock('../web-host/file-transfers.js', () => ({
  WebFileTransferStore: mocks.WebFileTransferStore,
}))
vi.mock('../web-host/server.js', () => ({ WebHostServer: mocks.WebHostServer }))
vi.mock('./ipc.js', () => ({ registerIpc: mocks.registerIpc }))
vi.mock('./security.js', () => ({
  getSecureWebPreferences: mocks.getSecureWebPreferences,
  isTrustedRendererUrl: mocks.isTrustedRendererUrl,
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

describe('DesktopHost Web Host shell', () => {
  it('starts the shared Node application and loads the loopback Web Host URL', async () => {
    const host = new DesktopHost()

    await host.start()

    expect(mocks.createNodeApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        userDataDirectory: '/tmp/pictor-desktop-host-test',
        runtimeHostPath: expect.stringMatching(/runtime[\\/]host\.js$/),
        runtimeEnvironment: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        profile: expect.objectContaining({ id: 'pictor.default' }),
        updaterHost: expect.any(Object),
      }),
    )
    expect(mocks.webHostServerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        services: expect.any(Object),
        staticDirectory: '/workspace/Pictor/out/web/client',
        development: { rendererRoot: '/workspace/Pictor/src/renderer' },
      }),
    )
    const firstWindow = mocks.BrowserWindow.instances[0]!
    expect(firstWindow.loadURL).toHaveBeenCalledWith(mocks.address.launchUrl)
    expect(mocks.registerIpc).toHaveBeenCalledWith({ validateSender: expect.any(Function) })
  })

  it('retains activated windows and stops Web Host before Application Host cleanup completes', async () => {
    const host = new DesktopHost()

    await host.start()
    const firstWindow = mocks.BrowserWindow.instances[0]!
    expect(mainWindowOf(host)).toBe(firstWindow)
    firstWindow.emit('ready-to-show')
    expect(firstWindow.show).toHaveBeenCalledOnce()

    mocks.BrowserWindow.instances.splice(0, 1)
    mocks.app.emit('activate')
    const activatedWindow = mocks.BrowserWindow.instances[0]!
    expect(mainWindowOf(host)).toBe(activatedWindow)

    firstWindow.emit('closed')
    expect(mainWindowOf(host)).toBe(activatedWindow)

    await host.stop()
    expect(mocks.platformIpc.dispose).toHaveBeenCalledOnce()
    expect(mocks.serverStop).toHaveBeenCalledOnce()
    expect(mocks.applicationHost.stop).toHaveBeenCalledOnce()
    expect(mainWindowOf(host)).toBeNull()
  })
})
