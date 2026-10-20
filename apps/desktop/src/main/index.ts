import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ApplicationHost, acquireProfileLock, ProfileLockedError } from '@pictor/application'
import { resolveHostCoreBinary, startHostCore } from '@pictor/host-client'
import {
  PluginHost,
  discoverPlugins,
  expandPluginRoots,
  resolveActivationOrder,
} from '@pictor/plugin-host'
import type { JsonValue, PluginRecord } from '@pictor/shared'

import type { AppInfo, CommandDescriptor, HostSnapshot, PluginReport } from '../shared/bridge.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '../..')
const repositoryRoot = resolve(appRoot, '../..')

app.setName('pictor')

// Tests and portable runs can redirect the whole profile.
const userDataOverride = process.env.PICTOR_USER_DATA
if (userDataOverride !== undefined && userDataOverride.trim().length > 0) {
  app.setPath('userData', userDataOverride)
}

let mainWindow: BrowserWindow | null = null
let disposeWorkspace: (() => Promise<void>) | null = null

void app.whenReady().then(async () => {
  app.setAppUserModelId('dev.pictor.desktop')

  const workspace = await startWorkspace()
  if (workspace === null) {
    app.quit()
    return
  }

  disposeWorkspace = workspace.dispose
  registerIpc(workspace)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void disposeWorkspace?.()
})

interface Workspace {
  appHost: ApplicationHost
  pluginHost: PluginHost
  client: ReturnType<typeof startHostCore>['client']
  hostCore: string
  database: string
  isDisposed: () => boolean
  dispose: () => Promise<void>
}

async function startWorkspace(): Promise<Workspace | null> {
  const userData = app.getPath('userData')
  const lockPath = join(userData, 'profile.lock')

  let lock
  try {
    lock = await acquireProfileLock({
      path: lockPath,
      owner: `${process.pid}:desktop`,
      nowait: true,
    })
  } catch (error) {
    if (error instanceof ProfileLockedError) {
      dialog.showErrorBox(
        'Pictor is already running',
        `Another Pictor frontend owns this profile (${error.owner}).`,
      )
      process.exitCode = 4
      return null
    }
    throw error
  }

  let hostCore: string
  try {
    hostCore = resolveHostCoreBinary({
      appRoot: repositoryRoot,
      resourcesPath: process.resourcesPath,
      env: process.env,
    })
  } catch (error) {
    dialog.showErrorBox('Host core missing', (error as Error).message)
    process.exitCode = 1
    return null
  }

  const database = join(userData, 'metadata.sqlite3')
  const running = startHostCore({
    command: hostCore,
    database,
    onStderr: (line) => console.warn(`[host-core] ${line}`),
  })

  const info = await running.client.info()
  await running.client.putSetting('runtime.id', 'echo')

  const appHost = new ApplicationHost(running.client)

  const bundledRoots = app.isPackaged
    ? expandPluginRoots([join(process.resourcesPath, 'plugins')])
    : expandPluginRoots([join(repositoryRoot, 'plugins')])

  const discovery = discoverPlugins(bundledRoots)
  for (const plugin of discovery.plugins) {
    const existing = (await running.client.listPlugins()).find((record) => record.id === plugin.id)
    if (existing === undefined) {
      await running.client.upsertPlugin({
        id: plugin.id,
        version: plugin.manifest.version,
        source: 'bundled',
      })
    }
  }

  const records = await running.client.listPlugins()
  const enabled = new Map(records.map((record) => [record.id, record.enabled]))
  const resolution = resolveActivationOrder(
    discovery.plugins,
    app.getVersion() === '0.0.0' ? '0.0.0' : app.getVersion(),
  )

  const pluginHost = new PluginHost({
    plugins: discovery.plugins,
    pictorVersion: '0.0.0',
    dataRoot: join(userData, 'plugins-data'),
    isEnabled: (id) => enabled.get(id) ?? true,
    logger: {
      info: (message) => console.info(`[plugin] ${message}`),
      warn: (message) => console.warn(`[plugin] ${message}`),
      error: (message, error) => console.error(`[plugin] ${message}`, error),
    },
  })

  await pluginHost.start(resolution.ordered)

  for (const contribution of pluginHost.contributions('commands')) {
    const command = contribution as { id?: unknown; description?: unknown; result?: unknown }
    if (typeof command.id !== 'string') continue

    try {
      appHost.commands.register({
        id: command.id,
        description:
          typeof command.description === 'string' ? command.description : 'Plugin command',
        handler: () => command.result ?? null,
      })
    } catch {
      console.warn(`[plugin] duplicate command ignored: ${command.id}`)
    }
  }

  console.info(`pictor host core ${info.version} (schema ${info.schemaVersion})`)

  let disposed = false

  return {
    appHost,
    pluginHost,
    client: running.client,
    hostCore,
    database,
    isDisposed: () => disposed,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await pluginHost.stop()
      running.dispose()
      lock.release()
    },
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Pictor',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    if (process.env.PICTOR_SMOKE === '1') {
      console.info('[smoke] window ready')
      // Let the renderer's first refresh settle before quitting.
      setTimeout(() => app.quit(), 400)
      return
    }
    mainWindow?.show()
  })
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

function registerIpc(workspace: Workspace): void {
  ipcMain.handle('pictor:snapshot', async (): Promise<HostSnapshot> => {
    // The renderer can refresh while the app is quitting; answer with an empty
    // snapshot instead of surfacing a disposed-client error.
    if (workspace.isDisposed()) return { projects: [], sessions: [], settings: {} }
    return workspace.appHost.snapshot()
  })

  ipcMain.handle('pictor:project.add', async (_event, path: unknown, name: unknown) => {
    if (typeof path !== 'string') throw new Error('path must be a string')
    return workspace.appHost.commands.execute('project.add', {
      path,
      ...(typeof name === 'string' ? { name } : {}),
    })
  })

  ipcMain.handle('pictor:project.remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return workspace.appHost.commands.execute('project.remove', { id })
  })

  ipcMain.handle('pictor:session.create', async (_event, projectId: unknown, title: unknown) => {
    if (typeof projectId !== 'string' || typeof title !== 'string') {
      throw new Error('projectId and title must be strings')
    }
    return workspace.appHost.commands.execute('session.create', { projectId, title })
  })

  ipcMain.handle('pictor:session.delete', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return workspace.appHost.commands.execute('session.delete', { id })
  })

  ipcMain.handle('pictor:pickDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('pictor:commands.list', async (): Promise<CommandDescriptor[]> => {
    return workspace.appHost.commands.list().map((command) => ({
      ...command,
      source:
        command.id.includes('.') &&
        !command.id.startsWith('project.') &&
        !command.id.startsWith('session.')
          ? 'plugin'
          : 'core',
    }))
  })

  ipcMain.handle('pictor:commands.execute', async (_event, id: unknown, input: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return workspace.appHost.commands.execute(id, input as JsonValue)
  })

  ipcMain.handle('pictor:plugins.list', async (): Promise<PluginRecord[]> => {
    return workspace.client.listPlugins()
  })

  ipcMain.handle('pictor:plugins.setEnabled', async (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') {
      throw new Error('id must be a string and enabled a boolean')
    }
    return workspace.client.setPluginEnabled(id, enabled)
  })

  ipcMain.handle('pictor:plugins.report', async (): Promise<PluginReport> => {
    return workspace.pluginHost.report()
  })

  ipcMain.handle('pictor:appInfo', async (): Promise<AppInfo> => {
    const info = await workspace.client.info()
    return {
      name: 'Pictor',
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      hostCore: info.version,
      database: info.database,
    }
  })
}
