import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ApplicationHost, acquireProfileLock, ProfileLockedError } from '@pictor/application'
import { ChatService, loadHistoryPage } from '@pictor/chat'
import { resolveHostCoreBinary, startHostCore } from '@pictor/host-client'
import {
  PluginHost,
  discoverPlugins,
  expandPluginRoots,
  resolveActivationOrder,
} from '@pictor/plugin-host'
import {
  evaluateToolGuards,
  parsePanelContributions,
  parseToolGuardContributions,
  parseToolViewContributions,
  type PanelContribution,
  type ToolViewContribution,
} from '@pictor/plugin-sdk'
import { readModelSettings, writeModelsJson } from '@pictor/model-config'
import {
  BLOCKED_REASON_PREFIX,
  type JsonValue,
  type PluginRecord,
  type Section,
} from '@pictor/shared'

import type { AppInfo, HostSnapshot, PluginReport } from '../shared/bridge.js'
import { HarnessChatBridge } from './harness-chat.js'
import {
  DEFAULT_PERMISSION_MODE,
  HarnessService,
  isPermissionMode,
  type HarnessStatus,
  type PermissionMode,
} from './harness-service.js'
import { ModelService } from './model-service.js'

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
  // The renderer owns the whole title bar, including its menus.
  Menu.setApplicationMenu(null)

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
  model: ModelService
  /** The agent runtime process, owned by the main process and shared by sessions. */
  harness: HarnessService
  /** Sandbox mode persisted in settings; read fresh so a change needs no restart. */
  readPermissionMode: () => Promise<PermissionMode>
  /** One runtime per open conversation, so several can run at the same time. */
  chatFor: (sessionId: string) => ChatService
  closeChat: (sessionId: string) => Promise<void>
  /** Panels contributed by plugins; built-in panels live in the renderer registry. */
  panels: PanelContribution[]
  /** Presentation for agent tools; the renderer applies them to its presenters. */
  toolViews: ToolViewContribution[]
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

  // A bundled plugin that was deleted from the install must not linger as a
  // ghost row in the plugin list.
  const discovered = new Set(discovery.plugins.map((plugin) => plugin.id))
  for (const record of await running.client.listPlugins()) {
    if (record.source !== 'bundled') continue
    if (discovered.has(record.id)) continue
    await running.client.removePlugin(record.id)
    console.info(`[plugin] removed stale bundled record: ${record.id}`)
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

  // Panels are data: a panel names a command to run when it opens. A broken
  // contribution is reported and dropped instead of failing the host.
  const parsedPanels = parsePanelContributions(pluginHost.contributions('panels'))
  for (const failure of parsedPanels.failures) {
    console.warn(`[plugin] panel ignored: ${failure.reason}`)
  }
  const panels: PanelContribution[] = parsedPanels.panels

  // Tool views are presentation data: a plugin names the label and icon for its
  // tool. The renderer owns the components, so nothing here is executable.
  const parsedViews = parseToolViewContributions(pluginHost.contributions('toolViews'))
  for (const failure of parsedViews.failures) {
    console.warn(`[plugin] tool view ignored: ${failure.reason}`)
  }
  const toolViews: ToolViewContribution[] = parsedViews.views

  // Guards run in contribution order and fail closed. With no guard installed
  // the interceptor stays null, so the default policy costs nothing.
  const parsedGuards = parseToolGuardContributions(pluginHost.contributions('toolGuards'))
  for (const failure of parsedGuards.failures) {
    console.warn(`[plugin] tool guard ignored: ${failure.reason}`)
  }
  const toolGuards = parsedGuards.guards

  console.info(`pictor host core ${info.version} (schema ${info.schemaVersion})`)

  let disposed = false
  const model = new ModelService({ store: running.client, userData })
  const readPermissionMode = async (): Promise<PermissionMode> => {
    const settings = await running.client.listSettings()
    const value = settings['harness.permissionMode']
    return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE
  }
  const harness = new HarnessService({ model, userData, readPermissionMode })
  // The runtime reports durable session events; the renderer renders runs and
  // deltas. One translation keeps the transcript unchanged by the swap.
  const chatBridge = new HarnessChatBridge()
  harness.onNotification((notification) => {
    // The runtime explains its own failures on stderr; without this the status is
    // the only place a user could read them.
    if (notification.method === 'runtime.stderr') {
      const text = (notification.params as { text?: unknown } | null)?.text
      if (typeof text === 'string' && text.trim().length > 0) {
        console.warn('[harness]', text.trim().slice(0, 400))
      }
    }
    for (const event of chatBridge.map(notification)) {
      mainWindow?.webContents.send('pictor:chat.event', event)
    }
  })

  /** Shared by every runtime: the policy is the same whoever is running. */
  const guardInterceptor = async ({
    tool,
    args,
  }: {
    tool: string
    args: unknown
  }): Promise<{ block: true; reason: string } | undefined> => {
    const verdict = await evaluateToolGuards(toolGuards, { tool, args })
    if (!verdict.blocked) return undefined
    console.warn(`[tool-guard] blocked ${tool}: ${verdict.reason ?? 'no reason given'}`)
    // The marker travels into Pi's JSONL, which is the only way a reloaded
    // session can still tell "a guard refused this" from "the command failed".
    return {
      block: true,
      reason: `${BLOCKED_REASON_PREFIX}${verdict.reason ?? 'blocked by a tool guard'}`,
    }
  }

  /** Open conversations, keyed by Pictor session id. */
  const chats = new Map<string, ChatService>()
  const createChat = (): ChatService =>
    new ChatService({
      onEvent: (event) => {
        mainWindow?.webContents.send('pictor:chat.event', event)
      },
    })

  const chatFor = (sessionId: string): ChatService => {
    const existing = chats.get(sessionId)
    if (existing !== undefined) return existing

    const chat = createChat()
    if (toolGuards.length > 0) chat.setToolInterceptor(guardInterceptor)
    chats.set(sessionId, chat)
    return chat
  }

  const closeChat = async (sessionId: string): Promise<void> => {
    const chat = chats.get(sessionId)
    if (chat === undefined) return
    chats.delete(sessionId)
    await chat.close()
  }

  return {
    appHost,
    pluginHost,
    model,
    harness,
    readPermissionMode,
    chatFor,
    closeChat,
    isDisposed: () => disposed,
    client: running.client,
    hostCore,
    database,
    panels,
    toolViews,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await Promise.all([...chats.values()].map((chat) => chat.close()))
      chats.clear()
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
    // The renderer draws its own title bar and window buttons.
    frame: false,
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

const WINDOW_COMMANDS = [
  'minimize',
  'toggleMaximize',
  'close',
  'reload',
  'toggleDevTools',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
] as const

type WindowCommand = (typeof WINDOW_COMMANDS)[number]

function isWindowCommand(value: unknown): value is WindowCommand {
  return typeof value === 'string' && (WINDOW_COMMANDS as readonly string[]).includes(value)
}

function registerIpc(workspace: Workspace): void {
  ipcMain.handle('pictor:window.command', (event, command: unknown) => {
    if (!isWindowCommand(command)) throw new Error('unknown window command')

    const window = BrowserWindow.fromWebContents(event.sender)
    const contents = event.sender

    switch (command) {
      case 'minimize':
        window?.minimize()
        break
      case 'toggleMaximize':
        if (window?.isMaximized() === true) window.unmaximize()
        else window?.maximize()
        break
      case 'close':
        window?.close()
        break
      case 'reload':
        contents.reload()
        break
      case 'toggleDevTools':
        contents.toggleDevTools()
        break
      case 'zoomIn':
        contents.setZoomLevel(contents.getZoomLevel() + 0.5)
        break
      case 'zoomOut':
        contents.setZoomLevel(contents.getZoomLevel() - 0.5)
        break
      case 'zoomReset':
        contents.setZoomLevel(0)
        break
      case 'undo':
        contents.undo()
        break
      case 'redo':
        contents.redo()
        break
      case 'cut':
        contents.cut()
        break
      case 'copy':
        contents.copy()
        break
      case 'paste':
        contents.paste()
        break
      case 'selectAll':
        contents.selectAll()
        break
    }
  })

  ipcMain.handle('pictor:window.state', (event) => ({
    maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  }))

  ipcMain.handle('pictor:snapshot', async (): Promise<HostSnapshot> => {
    // The renderer can refresh while the app is quitting; answer with an empty
    // snapshot instead of surfacing a disposed-client error.
    if (workspace.isDisposed()) return { projects: [], sessions: [], sections: [], settings: {} }
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
    if (typeof title !== 'string') throw new Error('title must be a string')
    if (projectId !== null && typeof projectId !== 'string') {
      throw new Error('projectId must be a string or null')
    }
    return workspace.appHost.commands.execute('session.create', { projectId, title })
  })

  ipcMain.handle('pictor:session.delete', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return workspace.appHost.commands.execute('session.delete', { id })
  })

  ipcMain.handle('pictor:session.setPinned', async (_event, id: unknown, pinned: unknown) => {
    if (typeof id !== 'string' || typeof pinned !== 'boolean') {
      throw new Error('id must be a string and pinned a boolean')
    }
    return workspace.appHost.commands.execute('session.setPinned', { id, pinned })
  })

  ipcMain.handle('pictor:session.setArchived', async (_event, id: unknown, archived: unknown) => {
    if (typeof id !== 'string' || typeof archived !== 'boolean') {
      throw new Error('id must be a string and archived a boolean')
    }
    return workspace.appHost.commands.execute('session.setArchived', { id, archived })
  })

  ipcMain.handle('pictor:session.reorder', async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    return workspace.appHost.commands.execute('session.reorder', { ids })
  })

  ipcMain.handle('pictor:session.archiveMany', async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    return workspace.appHost.commands.execute('session.archiveMany', { ids })
  })

  ipcMain.handle('pictor:session.setProject', async (_event, id: unknown, projectId: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    if (projectId !== null && typeof projectId !== 'string') {
      throw new Error('projectId must be a string or null')
    }
    return workspace.appHost.commands.execute('session.setProject', { id, projectId })
  })

  ipcMain.handle('pictor:session.setSections', async (_event, id: unknown, sectionIds: unknown) => {
    if (typeof id !== 'string' || !Array.isArray(sectionIds)) {
      throw new Error('id must be a string and sectionIds an array')
    }
    return workspace.appHost.commands.execute('session.setSections', { id, sectionIds })
  })

  ipcMain.handle('pictor:project.addFolder', async (_event, id: unknown, path: unknown) => {
    if (typeof id !== 'string' || typeof path !== 'string') {
      throw new Error('id and path must be strings')
    }
    return workspace.appHost.commands.execute('project.addFolder', { id, path })
  })

  ipcMain.handle('pictor:project.removeFolder', async (_event, id: unknown, path: unknown) => {
    if (typeof id !== 'string' || typeof path !== 'string') {
      throw new Error('id and path must be strings')
    }
    return workspace.appHost.commands.execute('project.removeFolder', { id, path })
  })

  ipcMain.handle('pictor:sections.list', async (): Promise<Section[]> => {
    if (workspace.isDisposed()) return []
    return workspace.client.listSections()
  })

  ipcMain.handle('pictor:sections.create', async (_event, name: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('name must be a non-empty string')
    }
    return workspace.appHost.commands.execute('section.create', { name })
  })

  ipcMain.handle('pictor:sections.rename', async (_event, id: unknown, name: unknown) => {
    if (typeof id !== 'string' || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('id and a non-empty name are required')
    }
    return workspace.appHost.commands.execute('section.rename', { id, name })
  })

  ipcMain.handle('pictor:sections.reorder', async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    return workspace.appHost.commands.execute('section.reorder', { ids })
  })

  ipcMain.handle('pictor:project.setSection', async (_event, id: unknown, sectionId: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    if (sectionId !== null && typeof sectionId !== 'string') {
      throw new Error('sectionId must be a string or null')
    }
    return workspace.appHost.commands.execute('project.setSection', { id, sectionId })
  })

  ipcMain.handle('pictor:sections.remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return workspace.appHost.commands.execute('section.remove', { id })
  })

  ipcMain.handle('pictor:settings.put', async (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('key must be a non-empty string')
    }
    await workspace.client.putSetting(key, value as JsonValue)
  })

  ipcMain.handle('pictor:pickDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('pictor:panels.list', async (): Promise<PanelContribution[]> => {
    return workspace.panels
  })

  ipcMain.handle('pictor:toolViews.list', async (): Promise<ToolViewContribution[]> => {
    return workspace.toolViews
  })

  ipcMain.handle('pictor:panels.invoke', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    const panel = workspace.panels.find((entry) => entry.id === id)
    if (panel === undefined) throw new Error(`unknown panel: ${id}`)
    return workspace.appHost.commands.execute(panel.command, {})
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

  ipcMain.handle('pictor:model.get', async () => {
    return workspace.model.settings()
  })

  ipcMain.handle('pictor:model.save', async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null) throw new Error('invalid model settings')
    return workspace.model.save(input as Parameters<ModelService['save']>[0])
  })

  ipcMain.handle('pictor:model.select', async (_event, modelId: unknown) => {
    if (typeof modelId !== 'string' || modelId.trim().length === 0) {
      throw new Error('modelId must be a non-empty string')
    }
    return workspace.model.selectModel(modelId)
  })

  ipcMain.handle('pictor:model.fetch', async (_event, input: unknown) => {
    const override =
      typeof input === 'object' && input !== null
        ? (input as {
            baseUrl?: string
            protocol?: 'chat-completions' | 'responses'
            apiKey?: string
          })
        : undefined
    return workspace.model.fetchModels(override)
  })

  ipcMain.handle('pictor:model.test', async () => {
    return workspace.model.test()
  })

  ipcMain.handle('pictor:provider.list', async () => {
    return workspace.model.providers()
  })

  ipcMain.handle('pictor:provider.save', async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null) throw new Error('invalid provider')
    return workspace.model.saveProvider(input as Parameters<ModelService['saveProvider']>[0])
  })

  ipcMain.handle('pictor:provider.remove', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    return workspace.model.removeProvider(id)
  })

  ipcMain.handle('pictor:provider.activate', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    return workspace.model.activateProvider(id)
  })

  ipcMain.handle('pictor:model.ccswitch.scan', async () => {
    return workspace.model.scanCcSwitch()
  })

  ipcMain.handle(
    'pictor:model.ccswitch.import',
    async (_event, id: unknown, includeApiKey: unknown) => {
      if (typeof id !== 'string' || id.trim().length === 0)
        throw new Error('provider id is required')
      return workspace.model.importCcSwitchProvider(id, includeApiKey === true)
    },
  )

  ipcMain.handle(
    'pictor:model.agentTest',
    async (_event, prompt: unknown, workingDirectory: unknown) => {
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new Error('prompt is required')
      }

      const directory =
        typeof workingDirectory === 'string' && workingDirectory.trim().length > 0
          ? workingDirectory
          : app.getPath('userData')

      return workspace.model.runTest(prompt, directory)
    },
  )

  ipcMain.handle('pictor:chat.open', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')

    const sessions = await workspace.client.listSessions()
    const session = sessions.find((entry) => entry.id === sessionId)
    if (session === undefined) throw new Error('session not found')

    const projects = await workspace.client.listProjects()
    const project = projects.find((entry) => entry.id === session.projectId) ?? null

    // With the kernel running, the transcript is rebuilt from its own durable
    // log; the Pi session file only exists for conversations that ran on Pi.
    if (workspace.harness.status().state === 'ready') {
      const history = await workspace.harness.openHistory(sessionId)
      // A session that ran on Pi has no kernel record, so the kernel is not
      // authoritative for it: fall through to the log it actually wrote.
      if (history.messages.length > 0) return { path: `harness:${sessionId}`, history }
    }

    const settings = await readModelSettings(workspace.client, workspace.model.authPath)
    if (settings.baseUrl.length === 0 || settings.modelId.length === 0) {
      throw new Error('model settings are incomplete; open Model settings first')
    }

    writeModelsJson(workspace.model.modelsPath, settings)

    const sessionDir = join(app.getPath('userData'), 'pi', 'sessions', project?.id ?? 'unfiled')
    const opened = await workspace.chatFor(sessionId).open({
      sessionId,
      cwd: project?.path ?? app.getPath('home'),
      sessionDir,
      agentDir: workspace.model.agentDir,
      modelsPath: workspace.model.modelsPath,
      modelId: settings.modelId,
      apiKey: await workspace.model.activeApiKey(),
      sessionPath: session.piSessionId,
    })

    if (session.piSessionId !== opened.path) {
      await workspace.client.bindPiSession(sessionId, opened.path)
    }

    return {
      path: opened.path,
      history: await workspace.chatFor(sessionId).history(opened.path, 50, 0),
    }
  })

  ipcMain.handle('pictor:chat.send', async (_event, sessionId: unknown, prompt: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('prompt must be a non-empty string')
    }
    // Conversations run on the kernel once it is up; the Pi path stays as the
    // fallback so a profile without a runtime still works.
    if (workspace.harness.status().state === 'ready') {
      await workspace.harness.prompt(sessionId, prompt)
      return
    }
    await workspace.chatFor(sessionId).send(prompt)
  })

  ipcMain.handle('pictor:chat.stop', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    // Stopping is the runtime's own cancel when it owns the conversation; the Pi
    // path only knows how to stop a turn it started.
    if (workspace.harness.status().state === 'ready') {
      await workspace.harness.cancel(sessionId)
      return
    }
    await workspace.chatFor(sessionId).stop()
  })

  ipcMain.handle('pictor:chat.close', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    await workspace.closeChat(sessionId)
  })
  ipcMain.handle(
    'pictor:chat.history',
    async (_event, path: unknown, limit: unknown, offset: unknown) => {
      if (typeof path !== 'string') throw new Error('path must be a string')
      const size = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50
      const from = typeof offset === 'number' && offset >= 0 ? offset : 0
      if (path.startsWith('harness:')) {
        const sessionId = path.slice('harness:'.length)
        return workspace.harness.historyPage(sessionId, size, from)
      }
      return loadHistoryPage(path, size, from)
    },
  )

  ipcMain.handle('pictor:harness.status', async (): Promise<HarnessStatus> => {
    workspace.harness.setPermissionMode(await workspace.readPermissionMode())
    return workspace.harness.status()
  })

  ipcMain.handle(
    'pictor:harness.setPermissionMode',
    async (_event, mode: unknown): Promise<HarnessStatus> => {
      if (!isPermissionMode(mode)) throw new Error('unknown permission mode')
      await workspace.client.putSetting('harness.permissionMode', mode)
      workspace.harness.setPermissionMode(mode)
      return workspace.harness.status()
    },
  )

  ipcMain.handle('pictor:harness.start', async (_event, cwd: unknown): Promise<HarnessStatus> => {
    const directory = typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : app.getPath('home')
    return workspace.harness.start(directory)
  })

  ipcMain.handle('pictor:harness.stop', async (): Promise<HarnessStatus> => {
    return workspace.harness.stop()
  })

  ipcMain.handle('pictor:harness.install', async (): Promise<HarnessStatus> => {
    return workspace.harness.install()
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
