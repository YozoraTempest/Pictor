import { join, resolve } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  net,
  safeStorage,
  session,
  shell,
  type Event,
  type WebFrameMain,
} from 'electron'

import {
  createNodeApplication,
  ProfileFileLock,
  type ApplicationHostServices,
  type FrontendLock,
  type FrontendLockLease,
  type NodeApplicationServices,
} from '../application/index.js'
import type { Disposable } from '../kernel/module.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { detectDesktopDistribution } from '../node/linux-distribution.js'
import { SecretStore } from '../node/persistence/secret-store.js'
import { defaultPluginProfile, developerPluginProfile } from '../plugin/default-profile.js'
import { appInfoSchema } from '../shared/app-info.js'
import type { ModuleEventEnvelope } from '../kernel/contract.js'
import { EventHub } from '../web-host/event-hub.js'
import { WebFileTransferStore } from '../web-host/file-transfers.js'
import { WebHostServer, type WebHostAddress } from '../web-host/server.js'
import { registerIpc } from './ipc.js'
import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'

import packageMetadata from '../../package.json' with { type: 'json' }

declare const __PICTOR_BUILD_CHANNEL__: string
declare const __PICTOR_SOURCE_COMMIT__: string | null

function bundledPluginsDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bundled-plugins')
    : resolve(app.getAppPath(), '.pictor/bundled-plugins')
}

function createMainWindow(
  address: WebHostAddress,
  runtimeCoordinator: ApplicationHostServices['runtime'],
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#111315',
    show: false,
    title: 'Pictor',
    webPreferences: {
      ...getSecureWebPreferences(),
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url, address.origin)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url, address.origin)) return
    event.preventDefault()
    if (isExternalWebUrl(url, address.origin)) void shell.openExternal(url)
  })
  window.once('ready-to-show', () => window.show())
  let closeConfirmed = false
  window.on('close', (event) => {
    if (closeConfirmed || !runtimeCoordinator.isActive()) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Agent 仍在运行',
      message: '当前 Agent 运行尚未完成',
      detail:
        '退出 Pictor 会终止当前运行。重新打开应用后，该运行会标记为已中断，且不会自动重放工具操作。',
      buttons: ['继续运行', '停止并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (choice === 1) {
      closeConfirmed = true
      window.close()
    }
  })

  void window.loadURL(address.launchUrl)
  return window
}

function isExternalWebUrl(url: string, trustedOrigin: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return ['http:', 'https:'].includes(parsedUrl.protocol) && parsedUrl.origin !== trustedOrigin
  } catch {
    return false
  }
}

export class ElectronFrontendLock implements FrontendLock {
  private leaseHeld = false

  constructor(private readonly profileLock: FrontendLock) {}

  async acquire(): Promise<FrontendLockLease | null> {
    if (this.leaseHeld) throw new Error('Electron Frontend lock has already been acquired')
    if (!app.requestSingleInstanceLock()) return null

    let profileLease: FrontendLockLease | null = null
    try {
      profileLease = await this.profileLock.acquire()
      if (!profileLease) {
        app.releaseSingleInstanceLock()
        return null
      }
    } catch (error) {
      app.releaseSingleInstanceLock()
      throw error
    }

    this.leaseHeld = true
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        try {
          await profileLease?.release()
        } finally {
          this.leaseHeld = false
          app.releaseSingleInstanceLock()
        }
      },
    }
  }
}

export class DesktopHost {
  private application: NodeApplicationServices | null = null
  private server: WebHostServer | null = null
  private address: WebHostAddress | null = null
  private mainWindow: BrowserWindow | null = null
  private platformIpc: Disposable | null = null
  private quitting = false
  private activationRegistered = false
  private beforeQuitRegistered = false

  async start(): Promise<void> {
    if (this.application) throw new Error('Desktop Host has already started')

    const projectRoot = app.getAppPath()
    const userDataDirectory = app.getPath('userData')
    const currentVersion = app.isPackaged ? app.getVersion() : packageMetadata.version
    const distribution = await detectDesktopDistribution()
    const appInfo = appInfoSchema.parse({
      name: app.getName(),
      version: currentVersion,
      buildChannel: __PICTOR_BUILD_CHANNEL__,
      sourceCommit: __PICTOR_SOURCE_COMMIT__,
      platform: process.platform,
      arch: process.arch,
      distribution,
    })
    const moduleEvents = new EventHub<ModuleEventEnvelope>()
    const updaterHost: UpdaterHostAdapter = {
      fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      openExternal: (url) => shell.openExternal(url),
    }

    try {
      this.application = await createNodeApplication({
        userDataDirectory,
        runtimeHostPath: join(__dirname, 'runtime/host.js'),
        runtimeEnvironment: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        appInfo,
        bundledPluginsDirectory: bundledPluginsDirectory(),
        frontendLock: new ElectronFrontendLock(
          new ProfileFileLock(userDataDirectory, { frontend: 'gui' }),
        ),
        profile:
          process.env.PICTOR_PLUGIN_PROFILE === 'developer'
            ? developerPluginProfile
            : defaultPluginProfile,
        eventPublisher: {
          publish: (event) =>
            moduleEvents.publish({
              moduleId: agentWorkspaceContract.id,
              event: 'runtimeEvent',
              payload: event,
            }),
        },
        safeMode: process.argv.includes('--safe-mode'),
        secretStore: new SecretStore(join(userDataDirectory, 'data-v1'), safeStorage),
        updaterHost,
      })
      this.server = new WebHostServer({
        services: this.application.services,
        moduleEvents,
        staticDirectory: resolve(projectRoot, 'out/web/client'),
        fileTransfers: new WebFileTransferStore(join(userDataDirectory, 'web-transfers')),
        ...(!app.isPackaged
          ? { development: { rendererRoot: resolve(projectRoot, 'src/renderer') } }
          : {}),
      })
      this.address = await this.server.start()
      this.platformIpc = registerIpc({
        validateSender: this.createSenderValidator(this.address.origin),
      })
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false)
      })

      this.setMainWindow(createMainWindow(this.address, this.application.services.runtime))
      app.on('activate', this.handleActivate)
      this.activationRegistered = true
      app.on('before-quit', this.handleBeforeQuit)
      this.beforeQuitRegistered = true
    } catch (error) {
      const cleanupError = await this.stop()
      if (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Desktop Host 启动和清理均失败', {
          cause: error,
        })
      }
      throw error
    }
  }

  async stop(): Promise<Error | null> {
    if (this.activationRegistered) {
      app.removeListener('activate', this.handleActivate)
      this.activationRegistered = false
    }
    if (this.beforeQuitRegistered) {
      app.removeListener('before-quit', this.handleBeforeQuit)
      this.beforeQuitRegistered = false
    }
    this.mainWindow = null

    let firstError: Error | null = null
    const dispose = async (step: () => void | Promise<void>): Promise<void> => {
      try {
        await step()
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error(String(error))
      }
    }
    if (this.platformIpc) await dispose(() => this.platformIpc!.dispose())
    if (this.server) await dispose(() => this.server!.stop())
    if (this.application) await dispose(() => this.application!.applicationHost.stop())

    this.platformIpc = null
    this.server = null
    this.address = null
    this.application = null
    return firstError
  }

  private readonly handleActivate = (): void => {
    if (!this.application || !this.address || BrowserWindow.getAllWindows().length > 0) return
    this.setMainWindow(createMainWindow(this.address, this.application.services.runtime))
  }

  private setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    window.once('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })
  }

  private readonly handleBeforeQuit = (event: Event): void => {
    if (this.quitting) return
    event.preventDefault()
    this.quitting = true
    void this.stop().finally(() => app.quit())
  }

  private createSenderValidator(trustedOrigin: string): (frame: WebFrameMain | null) => void {
    return (frame) => {
      if (!isTrustedRendererUrl(frame?.url ?? '', trustedOrigin)) {
        throw new Error('Rejected IPC request from an untrusted renderer')
      }
    }
  }
}
