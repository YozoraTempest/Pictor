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
  type WebFrameMain,
} from 'electron'

import packageMetadata from '../../package.json' with { type: 'json' }
import { appInfoSchema } from '../shared/desktop-bridge.js'
import { registerIpc } from './ipc.js'
import { ModelConnectionTester } from './model-connection.js'
import { AppRepository } from './persistence/app-repository.js'
import { SecretStore } from './persistence/secret-store.js'
import { RuntimeCoordinator } from './runtime/coordinator.js'
import { RuntimeSupervisor } from './runtime/supervisor.js'
import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'
import { shouldShowMainWindow } from './window-visibility.js'
import { UpdateService } from './update-service.js'

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

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
}

function registerAppProtocol(): void {
  const rendererRoot = resolve(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, (request) => {
    const requestUrl = new URL(request.url)
    const requestedPath =
      decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = resolve(rendererRoot, requestedPath)

    if (requestUrl.host !== APP_HOST || !isPathWithin(rendererRoot, filePath)) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
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
  const dataDirectory = join(app.getPath('userData'), 'data-v1')
  const secretStore = new SecretStore(dataDirectory, safeStorage)
  const repository = new AppRepository(dataDirectory, secretStore)

  registerAppProtocol()
  return repository.initialize().then(() => {
    const coordinatorReference: { current?: RuntimeCoordinator } = {}
    const runtimeSupervisor = new RuntimeSupervisor((event) =>
      coordinatorReference.current?.handleEvent(event),
    )
    const runtimeCoordinator = new RuntimeCoordinator(repository, runtimeSupervisor, (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('runtime:event', event)
      }
    })
    coordinatorReference.current = runtimeCoordinator
    registerIpc({
      repository,
      connectionTester: new ModelConnectionTester(),
      updateService: new UpdateService({
        currentVersion,
        fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
        openExternal: (url) => shell.openExternal(url),
      }),
      validateSender,
      runtimeCoordinator,
      getAppInfo: () =>
        appInfoSchema.parse({
          name: app.getName(),
          version: currentVersion,
          platform: process.platform,
        }),
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
    app.once('before-quit', () => void runtimeSupervisor.dispose())
  })
})

app.on('window-all-closed', () => app.quit())
