import { app, BrowserWindow, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'

import { createHarnessHost } from './host.js'

/** The window the app opens into; null before the first one exists. */
let mainWindow: BrowserWindow | null = null
let disposeHarness: (() => Promise<void>) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Pictor',
    backgroundColor: '#0f1115',
    show: false,
    // The renderer draws its own title bar and window buttons.
    frame: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // The smoke start exists for packaging checks: it proves the bundled sidecar
  // spawns and the bundled renderer loads, then leaves. It waits for the document
  // rather than `ready-to-show`, which a headless machine never paints.
  if (process.env.PICTOR_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      console.info('[smoke] window loaded')
      // Let the renderer's first refresh settle before quitting.
      setTimeout(() => app.quit(), 400)
    })
  } else {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })
  }
  const sendWindowState = (): void => {
    mainWindow?.webContents.send('pictor:window.state', {
      maximized: mainWindow.isMaximized(),
    })
  }
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl !== undefined) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }
}

/**
 * Boot the harness inside this Electron app.
 *
 * The whole of the shell: one window, one menu decision, and a harness that owns every
 * channel behind it. Nothing here knows what a conversation or a model is.
 */
export function runStandalone(): void {
  const ownsInstance = app.requestSingleInstanceLock()
  if (!ownsInstance) {
    app.exit(4)
    return
  }

  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    app.setAppUserModelId('dev.pictor.desktop')
    Menu.setApplicationMenu(null)

    const workspace = await createHarnessHost()
    if (workspace === null) {
      app.quit()
      return
    }

    disposeHarness = workspace.dispose
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    void disposeHarness?.()
  })
}
