import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  app,
  BrowserWindow,
  net,
  protocol,
  safeStorage,
  session,
  type WebFrameMain,
} from 'electron'

import { appInfoSchema } from '../../src/shared/contracts.js'
import { registerIpc } from './ipc.js'
import { ModelConnectionTester } from './model-connection.js'
import { AppRepository } from './persistence/app-repository.js'
import { SecretStore } from './persistence/secret-store.js'
import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'

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

function createMainWindow(): BrowserWindow {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
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
  window.once('ready-to-show', () => window.show())

  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`)
  }

  return window
}

void app.whenReady().then(() => {
  const dataDirectory = join(app.getPath('userData'), 'data-v1')
  const secretStore = new SecretStore(dataDirectory, safeStorage)
  const repository = new AppRepository(dataDirectory, secretStore)

  registerAppProtocol()
  return repository.initialize().then(() => {
    registerIpc({
      repository,
      connectionTester: new ModelConnectionTester(),
      validateSender,
      getAppInfo: () =>
        appInfoSchema.parse({
          name: app.getName(),
          version: app.getVersion(),
          platform: process.platform,
        }),
    })
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })
})

app.on('window-all-closed', () => app.quit())
