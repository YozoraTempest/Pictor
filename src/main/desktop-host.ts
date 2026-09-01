import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  app,
  BrowserWindow,
  dialog,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  type Event,
  type WebFrameMain,
} from 'electron'

import {
  ApplicationHost,
  ModelConnectionTester,
  ProfileFileLock,
  type ApplicationHostServices,
  type EventPublisher,
  type FrontendLock,
  type FrontendLockLease,
  type HostPluginDefinitionsFactory,
  type UserData,
} from '../application/index.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { appInfoSchema } from '../shared/app-info.js'
import type { Disposable } from '../kernel/module.js'
import { defaultPluginProfile, developerPluginProfile } from './plugins/default-profile.js'
import { registerCommandIpc } from './command-ipc.js'
import { registerIpc } from './ipc.js'
import { broadcastModuleEvent, registerModuleIpc } from './module-ipc.js'
import { createHostPluginDefinitions } from './plugins/plugin-loader.js'
import { SecretStore } from './persistence/secret-store.js'
import { RuntimeSupervisor } from './runtime/supervisor.js'
import { detectDesktopDistribution } from './linux-distribution.js'
import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'
import { shouldShowMainWindow, shouldShowMainWindowWithoutFocus } from './window-visibility.js'
import type { PluginStore } from './plugins/plugin-store.js'

import packageMetadata from '../../package.json' with { type: 'json' }

declare const __PICTOR_BUILD_CHANNEL__: string
declare const __PICTOR_SOURCE_COMMIT__: string | null

const APP_SCHEME = 'app'
const APP_HOST = 'bundle'

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
}

function registerAppProtocol(pluginStore: PluginStore): void {
  const guiRoot = resolve(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url)
    startupDiagnostic(`App protocol request ${request.url}`)
    const requestedPath =
      decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html'
    if (requestUrl.host !== APP_HOST) return new Response('Not found', { status: 404 })

    const pluginSegments = requestedPath.split('/')
    if (pluginSegments[0] === 'plugins' && pluginSegments.length >= 4) {
      const [, pluginId, version, ...packageSegments] = pluginSegments
      const plugin = (await pluginStore.getSnapshot()).plugins.find(
        ({ manifest }) => manifest.id === pluginId && manifest.version === version,
      )
      if (!plugin) return new Response('Not found', { status: 404 })
      const pluginFile = resolve(plugin.rootPath, packageSegments.join('/'))
      if (!isPathWithin(plugin.rootPath, pluginFile)) {
        return new Response('Not found', { status: 404 })
      }
      return localFileResponse(pluginFile, request.url)
    }

    const filePath = resolve(guiRoot, requestedPath)
    if (!isPathWithin(guiRoot, filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return localFileResponse(filePath, request.url)
  })
}

async function localFileResponse(filePath: string, requestUrl: string): Promise<Response> {
  try {
    const response = await net.fetch(pathToFileURL(filePath).toString())
    startupDiagnostic(`App protocol response ${requestUrl} ${filePath} ${response.status}`)
    return response
  } catch {
    startupDiagnostic(`App protocol missing ${requestUrl} ${filePath}`)
    return new Response('Not found', { status: 404 })
  }
}

function bundledPluginsDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bundled-plugins')
    : resolve(__dirname, '../../.pictor/bundled-plugins')
}

function guiPluginUrl(rootPath: string, id: string, version: string, entry: string): string {
  const filePath = resolve(rootPath, entry)
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    return new URL(`/@fs${filePath.replaceAll('\\', '/')}`, developmentUrl).toString()
  }
  const packagePath = entry.replace(/^\.\//, '')
  return `${APP_SCHEME}://${APP_HOST}/plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}/${packagePath}`
}

function validateSender(frame: WebFrameMain | null): void {
  const senderUrl = frame?.url ?? ''
  if (!isTrustedRendererUrl(senderUrl, process.env.ELECTRON_RENDERER_URL)) {
    throw new Error('Rejected IPC request from an untrusted renderer')
  }
}

function createMainWindow(runtimeCoordinator: ApplicationHostServices['runtime']): BrowserWindow {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const shouldShowWindow = shouldShowMainWindow()
  const shouldAvoidFocus = shouldShowMainWindowWithoutFocus()
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('did-start-loading', () => startupDiagnostic('Renderer started loading'))
  window.webContents.on('did-stop-loading', () => startupDiagnostic('Renderer stopped loading'))
  window.webContents.on('dom-ready', () => startupDiagnostic('Renderer DOM ready'))
  window.webContents.on('did-finish-load', () => startupDiagnostic('Renderer finished loading'))
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    startupDiagnostic(`Renderer failed to load (${errorCode} ${errorDescription}) ${validatedURL}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    startupDiagnostic(`Renderer process gone (${details.reason}) ${details.exitCode}`)
  })
  window.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    startupDiagnostic(`Renderer console ${sourceId}:${line} ${message}`)
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, developmentUrl)) event.preventDefault()
  })
  if (shouldShowWindow) {
    window.once('ready-to-show', () => {
      if (shouldAvoidFocus) window.showInactive()
      else window.show()
    })
  }
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

  const loadUrl = developmentUrl ? developmentUrl : `${APP_SCHEME}://${APP_HOST}/index.html`
  startupDiagnostic(`Renderer loading ${loadUrl}`)
  void window.loadURL(loadUrl).catch((error: unknown) => {
    startupDiagnostic(`Renderer loadURL rejected for ${loadUrl}: ${String(error)}`)
  })

  return window
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
  private applicationHost: ApplicationHost | null = null
  private services: ApplicationHostServices | null = null
  private ipc: Disposable | null = null
  private commandIpc: Disposable | null = null
  private moduleIpc: Disposable | null = null
  private quitting = false
  private activationRegistered = false
  private beforeQuitRegistered = false

  async start(): Promise<void> {
    if (this.applicationHost) throw new Error('Desktop Host has already started')

    const currentVersion = app.isPackaged ? app.getVersion() : packageMetadata.version
    const userDataDirectory = app.getPath('userData')
    const dataDirectory = join(userDataDirectory, 'data-v1')
    const sharedProfileLock = new ProfileFileLock(userDataDirectory, { frontend: 'gui' })
    const frontendLock = new ElectronFrontendLock(sharedProfileLock)
    const safeMode = process.argv.includes('--safe-mode')
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
    const userData: UserData = { userDataDirectory, dataDirectory }
    const coordinatorReference: { current?: ApplicationHostServices['runtime'] } = {}
    const runtimeSupervisor = new RuntimeSupervisor(
      (event) => coordinatorReference.current?.handleEvent(event),
      undefined,
      (request) =>
        coordinatorReference.current?.handleSessionReplacementRequest(request) ??
        Promise.resolve({ accepted: false, message: 'Runtime Coordinator is unavailable' }),
    )
    const applicationHost = new ApplicationHost({
      userData,
      appInfo,
      bundledPluginsDirectory: bundledPluginsDirectory(),
      runtimeHost: runtimeSupervisor,
      eventPublisher: this.createEventPublisher(),
      frontendLock,
      profile:
        process.env.PICTOR_PLUGIN_PROFILE === 'developer'
          ? developerPluginProfile
          : defaultPluginProfile,
      safeMode,
      secretStore: new SecretStore(dataDirectory, safeStorage),
      createHostPluginDefinitions: createDesktopHostPluginDefinitions,
    })
    this.applicationHost = applicationHost

    try {
      const services = await applicationHost.start()
      coordinatorReference.current = services.runtime
      this.services = services
      startupDiagnostic('Desktop Host registering protocol')
      registerAppProtocol(services.pluginStore)
      startupDiagnostic('Desktop Host registering command IPC')
      this.commandIpc = registerCommandIpc(services.commandClient, validateSender)
      startupDiagnostic('Desktop Host registering module IPC')
      this.moduleIpc = registerModuleIpc(services.moduleRouter, validateSender)
      startupDiagnostic('Desktop Host registering app IPC')
      this.ipc = registerIpc({
        validateSender,
        onGuiReady: services.restoreSelectedContext,
        appInfo: services.appInfo,
        getPluginBootstrap: () => services.getPluginBootstrap(guiPluginUrl),
      })
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false)
      })

      startupDiagnostic('Desktop Host creating main window')
      createMainWindow(services.runtime)
      startupDiagnostic('Desktop Host main window created')
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

    let firstError: Error | null = null
    const dispose = async (resource: Disposable | null): Promise<void> => {
      if (!resource) return
      try {
        await resource.dispose()
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error(String(error))
      }
    }
    await dispose(this.ipc)
    await dispose(this.commandIpc)
    await dispose(this.moduleIpc)
    this.ipc = null
    this.commandIpc = null
    this.moduleIpc = null

    if (this.applicationHost) {
      try {
        await this.applicationHost.stop()
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error(String(error))
      }
    }
    this.applicationHost = null
    this.services = null
    return firstError
  }

  private readonly handleActivate = (): void => {
    const runtime = this.services?.runtime
    if (!runtime || BrowserWindow.getAllWindows().length > 0) return
    createMainWindow(runtime)
  }

  private readonly handleBeforeQuit = (event: Event): void => {
    if (this.quitting) return
    event.preventDefault()
    this.quitting = true
    void this.stop().finally(() => app.quit())
  }

  private createEventPublisher(): EventPublisher {
    return {
      publish: (event) =>
        broadcastModuleEvent({
          moduleId: agentWorkspaceContract.id,
          event: 'runtimeEvent',
          payload: event,
        }),
    }
  }
}

const createDesktopHostPluginDefinitions: HostPluginDefinitionsFactory = (
  snapshot,
  appInfo,
  context,
) => {
  const agentWorkspaceHost = {
    repository: context.repository,
    runtime: context.runtime,
    connectionTester: new ModelConnectionTester(),
  }
  const updaterHost: UpdaterHostAdapter = {
    fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    openExternal: (url) => shell.openExternal(url),
  }
  return createHostPluginDefinitions(snapshot, appInfo, (pluginId) =>
    pluginId === agentWorkspaceContract.id
      ? agentWorkspaceHost
      : pluginId === 'pictor.updater'
        ? updaterHost
        : undefined,
  )
}

function startupDiagnostic(message: string): void {
  if (process.env.PICTOR_STARTUP_DIAGNOSTICS === '1') console.error(`[pictor startup] ${message}`)
}
