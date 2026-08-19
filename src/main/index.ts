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
  type WebFrameMain,
} from 'electron'

import packageMetadata from '../../package.json' with { type: 'json' }
import { ModuleRouter, moduleHandlerContributions } from '../kernel/contract.js'
import { PluginHost } from '../plugin/host.js'
import { appInfoSchema } from '../shared/app-info.js'
import { pluginBootstrapSchema, type PluginBootstrap } from '../shared/plugins.js'
import { discoverCommandInterpreter } from './command-interpreter.js'
import { developmentUserDataPath } from './development-profile.js'
import { detectDesktopDistribution } from './linux-distribution.js'
import { registerIpc } from './ipc.js'
import { registerModuleIpc } from './module-ipc.js'
import { ModelConnectionTester } from './model-connection.js'
import { AppRepository } from './persistence/app-repository.js'
import { SecretStore } from './persistence/secret-store.js'
import {
  createMainPluginDefinitions,
  createRuntimePluginBootstrap,
} from './plugins/plugin-loader.js'
import { PluginManager } from './plugins/plugin-manager.js'
import { PluginStore } from './plugins/plugin-store.js'
import { defaultPluginProfile } from './plugins/default-profile.js'
import { RuntimeCoordinator } from './runtime/coordinator.js'
import { RuntimeSupervisor } from './runtime/supervisor.js'
import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'
import { shouldShowMainWindow } from './window-visibility.js'

const APP_SCHEME = 'app'
const APP_HOST = 'bundle'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

app.enableSandbox()

const developmentData = developmentUserDataPath(
  app.getPath('appData'),
  app.isPackaged,
  process.argv,
)
if (developmentData) app.setPath('userData', developmentData)

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
}

function registerAppProtocol(pluginStore: PluginStore): void {
  const rendererRoot = resolve(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url)
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
      return net.fetch(pathToFileURL(pluginFile).toString())
    }

    const filePath = resolve(rendererRoot, requestedPath)

    if (!isPathWithin(rendererRoot, filePath)) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function bundledPluginsDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bundled-plugins')
    : resolve(__dirname, '../../.pictor/bundled-plugins')
}

function rendererPluginUrl(rootPath: string, id: string, version: string, entry: string): string {
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

function createMainWindow(runtimeCoordinator: RuntimeCoordinator): BrowserWindow {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const shouldShowWindow = shouldShowMainWindow()
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
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, developmentUrl)) {
      event.preventDefault()
    }
  })
  if (shouldShowWindow) window.once('ready-to-show', () => window.show())
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

  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`)
  }

  return window
}

void app.whenReady().then(() => {
  const currentVersion = app.isPackaged ? app.getVersion() : packageMetadata.version
  const userDataDirectory = app.getPath('userData')
  const dataDirectory = join(userDataDirectory, 'data-v1')
  const secretStore = new SecretStore(dataDirectory, safeStorage)
  const repository = new AppRepository(dataDirectory, secretStore)
  const pluginStore = new PluginStore({
    userDataDirectory,
    bundledPluginsDirectory: bundledPluginsDirectory(),
    profile: defaultPluginProfile,
  })

  registerAppProtocol(pluginStore)
  return Promise.all([
    repository.initialize(),
    pluginStore.initialize(),
    discoverCommandInterpreter(),
    detectDesktopDistribution(),
  ]).then(async ([, , commandInterpreter, distribution]) => {
    const safeMode = process.argv.includes('--safe-mode')
    const pluginStoreSnapshot = await pluginStore.getSnapshot()
    const coordinatorReference: { current?: RuntimeCoordinator } = {}
    const runtimeSupervisor = new RuntimeSupervisor(
      (event) => coordinatorReference.current?.handleEvent(event),
      createRuntimePluginBootstrap(pluginStoreSnapshot, currentVersion, safeMode),
    )
    const runtimeCoordinator = new RuntimeCoordinator(
      repository,
      runtimeSupervisor,
      (event) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('runtime:event', event)
        }
      },
      commandInterpreter.executablePath,
    )
    coordinatorReference.current = runtimeCoordinator
    const appInfo = appInfoSchema.parse({
      name: app.getName(),
      version: currentVersion,
      platform: process.platform,
      arch: process.arch,
      distribution,
      commandInterpreter: commandInterpreter.status,
    })
    const mainPluginHost = new PluginHost({ pictorVersion: currentVersion, safeMode })
    await mainPluginHost.start(createMainPluginDefinitions(pluginStoreSnapshot, appInfo))
    const pluginManager = new PluginManager(pluginStore, mainPluginHost.getStatuses(), safeMode)
    const moduleIpc = registerModuleIpc(
      new ModuleRouter(mainPluginHost.getContributions(moduleHandlerContributions)),
      validateSender,
    )
    const getPluginBootstrap = async (): Promise<PluginBootstrap> => {
      const snapshot = await pluginStore.getSnapshot()
      return pluginBootstrapSchema.parse({
        safeMode,
        plugins: snapshot.plugins.map(({ entry, manifest, rootPath }) => ({
          manifest,
          desiredState: entry.desiredState,
          rendererEntryUrl: manifest.modules.renderer
            ? rendererPluginUrl(rootPath, manifest.id, manifest.version, manifest.modules.renderer)
            : null,
        })),
      })
    }
    registerIpc({
      repository,
      connectionTester: new ModelConnectionTester(),
      validateSender,
      runtimeCoordinator,
      appInfo,
      getPluginBootstrap,
      pluginManager,
    })
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    createMainWindow(runtimeCoordinator)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(runtimeCoordinator)
      }
    })
    app.once('before-quit', () => {
      void (async () => {
        await runtimeSupervisor.dispose()
        await moduleIpc.dispose()
        await mainPluginHost.stop()
      })()
    })
  })
})

app.on('window-all-closed', () => app.quit())
