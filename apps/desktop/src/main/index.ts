import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
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
import {
  parsePanelContributions,
  parseSkillContributions,
  parseToolGuardContributions,
  parseToolViewContributions,
  type PanelContribution,
  type ToolViewContribution,
} from '@pictor/plugin-sdk'
import {
  MODEL_EFFORTS,
  type ApprovalRequest,
  type ChatAnswer,
  type ChatImage,
  type ChatQuestion,
  type ChatQuestionRequest,
  type JsonValue,
  type ModelEffort,
  type ModelProtocol,
  type PluginRecord,
  type Section,
  type SkillEntry,
  composeSkills,
} from '@pictor/shared'

import type { AppInfo, HostSnapshot, PluginReport } from '../shared/bridge.js'
import { HarnessChatBridge } from './harness-chat.js'
import { shouldAdoptTitle } from './harness-title.js'
import {
  DEFAULT_PERMISSION_MODE,
  HarnessService,
  isPermissionMode,
  type HarnessStatus,
  type PermissionMode,
} from './harness-service.js'
import { ToolGuardServer } from './tool-guard-server.js'
import { ModelService } from './model-service.js'
import { SkillLibrary } from './skill-library.js'

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
  /** Panels contributed by plugins; built-in panels live in the renderer registry. */
  panels: PanelContribution[]
  /** Presentation for agent tools; the renderer applies them to its presenters. */
  toolViews: ToolViewContribution[]
  /** Skills Pictor owns, and the switches that apply to skills it does not. */
  skills: SkillLibrary
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

  // Skills live in one root the runtime already scans; a plugin contributes data
  // and Pictor writes the file, so the plugin never touches the runtime's home.
  const skills = new SkillLibrary({
    root: join(userData, 'harness', 'skills'),
    stash: join(userData, 'skill-library', 'disabled'),
    stateFile: join(userData, 'skill-library.json'),
    logger: (message) => console.warn(`[skill] ${message}`),
  })

  const pluginSkills = new Map<string, unknown[]>()
  for (const { pluginId, value } of pluginHost.contributionsWithSource('skills')) {
    const values = pluginSkills.get(pluginId) ?? []
    values.push(value)
    pluginSkills.set(pluginId, values)
  }

  for (const [pluginId, values] of pluginSkills) {
    const parsed = parseSkillContributions(values)
    for (const failure of parsed.failures) {
      console.warn(`[plugin] skill ignored: ${failure.reason}`)
    }
    skills.syncPlugin(pluginId, parsed.skills)
  }

  // A plugin that is installed but not activated owns no files: whatever an
  // earlier run wrote for it has to go, or its skills would outlive the switch.
  for (const plugin of discovery.plugins) {
    if (pluginHost.report().activated.includes(plugin.id)) continue
    skills.clearPlugin(plugin.id)
  }

  console.info(`pictor host core ${info.version} (schema ${info.schemaVersion})`)

  let disposed = false
  const model = new ModelService({ store: running.client, userData })
  const readPermissionMode = async (): Promise<PermissionMode> => {
    const settings = await running.client.listSettings()
    const value = settings['harness.permissionMode']
    return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE
  }
  // Guards are closures in this process, so the runtime asks them over a loopback
  // socket instead of receiving them as configuration.
  const guardBridge = toolGuards.length === 0 ? null : new ToolGuardServer(toolGuards, randomUUID())
  void guardBridge?.start().catch((error: unknown) => {
    console.warn('[tool-guard] bridge 启动失败', error instanceof Error ? error.message : error)
  })
  const harness = new HarnessService({
    model,
    userData,
    readPermissionMode,
    guardEndpoint: () => guardBridge?.endpoint ?? null,
  })
  // The runtime reports durable session events; the renderer renders runs and
  // deltas. One translation keeps the transcript unchanged by the swap.
  const chatBridge = new HarnessChatBridge()
  harness.onNotification((notification) => {
    // The runtime explains its own failures on stderr; without this the status is
    // the only place a user could read them.
    if (notification.method === 'session.title') {
      const params = (notification.params ?? {}) as { sessionId?: unknown; title?: unknown }
      if (typeof params.sessionId === 'string' && typeof params.title === 'string') {
        void adoptSessionTitle(running.client, params.sessionId, params.title)
      }
    }
    if (notification.method === 'approval.request') {
      const params = (notification.params ?? {}) as {
        eventId?: unknown
        tool?: unknown
        reason?: unknown
      }
      if (typeof params.eventId === 'string') {
        const request: ApprovalRequest = {
          eventId: params.eventId,
          tool: typeof params.tool === 'string' ? params.tool : null,
          reason: typeof params.reason === 'string' ? params.reason : null,
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:harness.approval', request)
        }
      }
    }
    if (notification.method === 'question.request') {
      const params = (notification.params ?? {}) as { eventId?: unknown; questions?: unknown }
      if (typeof params.eventId === 'string' && Array.isArray(params.questions)) {
        const request: ChatQuestionRequest = {
          eventId: params.eventId,
          questions: params.questions as ChatQuestion[],
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:harness.question', request)
        }
      }
    }
    if (notification.method === 'runtime.install') {
      const line = (notification.params as { line?: unknown } | null)?.line
      if (typeof line === 'string') {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:harness.install', line)
        }
      }
    }
    if (notification.method === 'runtime.stderr') {
      const text = (notification.params as { text?: unknown } | null)?.text
      if (typeof text === 'string' && text.trim().length > 0) {
        console.warn('[harness]', text.trim().slice(0, 400))
      }
    }
    for (const event of chatBridge.map(notification)) {
      // Broadcast: the window that opened the conversation is not necessarily the
      // one a single `mainWindow` handle points at, and several may be listening.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('pictor:chat.event', event)
      }
    }
  })

  return {
    appHost,
    pluginHost,
    model,
    harness,
    readPermissionMode,
    isDisposed: () => disposed,
    client: running.client,
    hostCore,
    database,
    panels,
    toolViews,
    skills,
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

/**
 * Tells every window that the runtime changed state.
 *
 * A conversation opened before the runtime was up holds an empty transcript, so
 * the window that shows one has to know when re-reading it would finally work.
 */
function broadcastHarnessStatus(status: HarnessStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('pictor:harness.status', status)
  }
}

/**
 * Take the runtime's name for a conversation, if it is still unnamed.
 *
 * The runtime titles a session from its first prompt. Anything typed by hand must
 * win, so the rename only happens while the row still carries Pictor's generated
 * placeholder; a manual rename produces a different string and is left alone.
 */
/**
 * Titles the runtime has already produced for each conversation.
 *
 * The runtime writes two: a truncation of the first prompt, then the generated
 * name. Remembering the first lets the second replace it — and still keeps a
 * hand-typed name safe, because that name was never produced by the runtime.
 */
const runtimeTitles = new Map<string, Set<string>>()

async function adoptSessionTitle(
  client: Workspace['client'],
  sessionId: string,
  title: string,
): Promise<void> {
  try {
    const known = runtimeTitles.get(sessionId) ?? new Set<string>()
    runtimeTitles.set(sessionId, known)

    const sessions = await client.listSessions()
    const session = sessions.find((entry) => entry.id === sessionId)
    if (session === undefined) return
    if (!shouldAdoptTitle(session.title, title, known)) {
      if (session.title === title) known.add(title)
      return
    }

    await client.renameSession(sessionId, title)
    known.add(title)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('pictor:workspace.changed')
    }
  } catch (error) {
    // A title is cosmetic: failing to store it must never surface as a chat error.
    console.warn('[session] 标题未能更新', error instanceof Error ? error.message : error)
  }
}

/** Upper bounds so one paste cannot exhaust memory or the runtime's request. */
const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Validates the renderer's attachments before they reach the runtime. */
function parseImages(value: unknown): ChatImage[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('images must be an array')
  if (value.length > MAX_IMAGES) throw new Error(`最多附加 ${String(MAX_IMAGES)} 张图片`)

  return value.map((entry): ChatImage => {
    if (typeof entry !== 'object' || entry === null) throw new Error('invalid image')
    const record = entry as Record<string, unknown>
    const mediaType = record['mediaType']
    const data = record['data']
    if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) {
      throw new Error('image mediaType must be an image type')
    }
    if (typeof data !== 'string' || data.length === 0) throw new Error('image data is required')
    // Base64 grows by 4/3; this keeps the decoded payload under the cap.
    if (data.length > (MAX_IMAGE_BYTES * 4) / 3) throw new Error('图片过大')
    const name = typeof record['name'] === 'string' ? record['name'] : undefined
    return { mediaType, data, ...(name === undefined ? {} : { name }) }
  })
}

/** The reasoning level the composer asked for, or `null` when it asked for none. */
function parseEffort(value: unknown): ModelEffort | null {
  if (value === undefined || value === null) return null
  const level = MODEL_EFFORTS.find((entry) => entry === value)
  if (level === undefined) throw new Error(`不认识的推理强度：${String(value)}`)
  return level
}

/**
 * The answers the question card sent.
 *
 * Shapes are checked here rather than trusted, because the renderer is the only
 * caller but the value still crosses a process boundary: an answer with no `id`
 * or a non-string selection would reach the runtime as a malformed batch and be
 * refused, leaving the tool call to fail for the wrong reason.
 */
function parseAnswers(value: unknown): ChatAnswer[] {
  if (!Array.isArray(value)) throw new Error('answers must be an array')
  return value.map((entry): ChatAnswer => {
    if (typeof entry !== 'object' || entry === null) throw new Error('invalid answer')
    const record = entry as Record<string, unknown>
    const id = record['id']
    const selected = record['selected']
    const custom = record['custom']
    if (typeof id !== 'string' || id.length === 0) throw new Error('answer id is required')
    if (!Array.isArray(selected) || selected.some((label) => typeof label !== 'string')) {
      throw new Error('answer selected must be a string array')
    }
    if (custom !== undefined && typeof custom !== 'string') {
      throw new Error('answer custom must be a string')
    }
    return {
      id,
      selected: selected as string[],
      ...(typeof custom === 'string' ? { custom } : {}),
    }
  })
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

  /**
   * Apply a settings change to the runtime that is already running.
   *
   * The patch and the key environment are read once at boot, so a change only
   * lands on the next start. Waiting here is what makes "使用中" mean what the
   * window says it means.
   */
  const applyToRuntime = async <T>(result: T): Promise<T> => {
    await workspace.harness.applySettings()
    return result
  }

  ipcMain.handle('pictor:model.save', async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null) throw new Error('invalid model settings')
    return applyToRuntime(await workspace.model.save(input as Parameters<ModelService['save']>[0]))
  })

  ipcMain.handle('pictor:model.select', async (_event, modelId: unknown) => {
    if (typeof modelId !== 'string' || modelId.trim().length === 0) {
      throw new Error('modelId must be a non-empty string')
    }
    return applyToRuntime(await workspace.model.selectModel(modelId))
  })

  ipcMain.handle('pictor:model.use', async (_event, providerId: unknown, modelId: unknown) => {
    if (typeof providerId !== 'string' || providerId.length === 0) {
      throw new Error('providerId is required')
    }
    if (typeof modelId !== 'string' || modelId.trim().length === 0) {
      throw new Error('modelId is required')
    }
    return applyToRuntime(await workspace.model.useModel(providerId, modelId))
  })

  ipcMain.handle('pictor:model.fetch', async (_event, input: unknown) => {
    const override =
      typeof input === 'object' && input !== null
        ? (input as {
            baseUrl?: string
            protocol?: ModelProtocol
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
    return applyToRuntime(
      await workspace.model.saveProvider(input as Parameters<ModelService['saveProvider']>[0]),
    )
  })

  ipcMain.handle('pictor:provider.remove', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    return applyToRuntime(await workspace.model.removeProvider(id))
  })

  ipcMain.handle('pictor:provider.activate', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    return applyToRuntime(await workspace.model.activateProvider(id))
  })

  ipcMain.handle('pictor:model.ccswitch.scan', async () => {
    return workspace.model.scanCcSwitch()
  })

  ipcMain.handle(
    'pictor:model.ccswitch.import',
    async (_event, id: unknown, includeApiKey: unknown) => {
      if (typeof id !== 'string' || id.trim().length === 0)
        throw new Error('provider id is required')
      return applyToRuntime(
        await workspace.model.importCcSwitchProvider(id, includeApiKey === true),
      )
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

      if (workspace.harness.status().state !== 'ready') {
        return { ok: false, text: '', events: [], message: 'agent 运行时没有运行；先启动它再试' }
      }
      return workspace.harness.probe(prompt, directory)
    },
  )

  ipcMain.handle('pictor:chat.open', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')

    const sessions = await workspace.client.listSessions()
    const session = sessions.find((entry) => entry.id === sessionId)
    if (session === undefined) throw new Error('session not found')

    // The runtime owns every transcript: there is no second store, so an
    // unready runtime is an empty page the window explains rather than a
    // conversation that appears to have lost its history.
    return {
      path: `harness:${sessionId}`,
      history:
        workspace.harness.status().state === 'ready'
          ? await workspace.harness.openHistory(sessionId)
          : { messages: [], nextOffset: 0, hasMore: false },
    }
  })

  /**
   * Branch a conversation into a new Pictor session.
   *
   * The runtime owns the copy, so the new conversation is created here and then
   * pointed at the runtime's child id; opening it reads the inherited history.
   */
  ipcMain.handle('pictor:session.fork', async (_event, sessionId: unknown, atSeq: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    if (atSeq !== undefined && typeof atSeq !== 'number') throw new Error('atSeq must be a number')
    if (workspace.harness.status().state !== 'ready') throw new Error('先启动 agent 运行时')

    const sessions = await workspace.client.listSessions()
    const source = sessions.find((entry) => entry.id === sessionId)
    if (source === undefined) throw new Error('session not found')

    const child = await workspace.harness.fork(sessionId, atSeq)
    // The parent is recorded here, not in the runtime: only Pictor knows which
    // conversations belong to the same family.
    const created = await workspace.client.createSession(
      source.projectId,
      `${source.title} · 分支`,
      source.id,
    )
    workspace.harness.adopt(created.id, child)
    return created.id
  })

  ipcMain.handle(
    'pictor:chat.send',
    async (_event, sessionId: unknown, prompt: unknown, images: unknown, effort: unknown) => {
      if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
      if (typeof prompt !== 'string') throw new Error('prompt must be a string')
      const attachments = parseImages(images)
      const level = parseEffort(effort)
      if (prompt.trim().length === 0 && attachments.length === 0) {
        throw new Error('a message needs text or an image')
      }
      if (workspace.harness.status().state !== 'ready') {
        throw new Error('agent 运行时没有运行；先启动它再发消息')
      }
      await workspace.harness.prompt(sessionId, prompt, attachments, level)
    },
  )

  ipcMain.handle('pictor:chat.stop', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    // Nothing to stop when the runtime is down: the turn died with it.
    if (workspace.harness.status().state !== 'ready') return
    await workspace.harness.cancel(sessionId)
  })

  ipcMain.handle(
    'pictor:chat.history',
    async (_event, path: unknown, limit: unknown, offset: unknown) => {
      if (typeof path !== 'string') throw new Error('path must be a string')
      const size = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50
      const from = typeof offset === 'number' && offset >= 0 ? offset : 0
      if (!path.startsWith('harness:')) throw new Error('unknown transcript path')
      return workspace.harness.historyPage(path.slice('harness:'.length), size, from)
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
      // A live namespace setting, not a boot flag: asking the runtime to apply it
      // keeps the process (and every stream on it) alive.
      await workspace.harness.applyPermission(mode)
      return workspace.harness.status()
    },
  )

  ipcMain.handle('pictor:harness.start', async (_event, cwd: unknown): Promise<HarnessStatus> => {
    const directory = typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : app.getPath('home')
    const status = await workspace.harness.start(directory)
    broadcastHarnessStatus(status)
    return status
  })

  ipcMain.handle('pictor:harness.stop', async (): Promise<HarnessStatus> => {
    const status = await workspace.harness.stop()
    broadcastHarnessStatus(status)
    return status
  })

  // The runtime reports what it can load; Pictor adds what it owns and what it
  // switched off, because a disabled skill is missing from the catalog.
  const readSkills = async (sessionId: string): Promise<SkillEntry[]> =>
    composeSkills(
      await workspace.harness.listSkills(sessionId),
      workspace.skills.view(),
      workspace.harness.projectRoot,
    )

  ipcMain.handle('pictor:harness.skills', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
      throw new Error('sessionId is required')
    return readSkills(sessionId)
  })

  ipcMain.handle(
    'pictor:harness.skillEnabled',
    async (_event, sessionId: unknown, name: unknown, enabled: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0)
        throw new Error('sessionId is required')
      if (typeof name !== 'string' || name.length === 0) throw new Error('skill name is required')
      if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')

      const current = await readSkills(sessionId)
      const entry = current.find((skill) => skill.name === name)
      if (entry === undefined) throw new Error(`没有这个技能：${name}`)

      workspace.skills.setEnabled(name, enabled, {
        name: entry.name,
        description: entry.description,
        whenToUse: entry.whenToUse,
        path: entry.path,
        origin: entry.origin,
      })
      return readSkills(sessionId)
    },
  )

  // A skill's instructions live in a file the runtime discovered; showing it in
  // the file manager is the shortest path from "what is this skill" to the text.
  ipcMain.handle('pictor:shell.showItem', async (_event, path: unknown) => {
    if (typeof path !== 'string' || path.length === 0) throw new Error('path is required')
    shell.showItemInFolder(path)
  })

  ipcMain.handle(
    'pictor:harness.approvalAnswer',
    async (_event, eventId: unknown, allow: unknown) => {
      if (typeof eventId !== 'string' || eventId.length === 0)
        throw new Error('eventId is required')
      if (typeof allow !== 'boolean') throw new Error('allow must be a boolean')
      await workspace.harness.answerApproval(eventId, allow)
    },
  )

  ipcMain.handle(
    'pictor:harness.questionAnswer',
    async (_event, eventId: unknown, answers: unknown) => {
      if (typeof eventId !== 'string' || eventId.length === 0)
        throw new Error('eventId is required')
      // `null` is the dismissed card; anything else has to be a list of answers.
      const list = answers === null ? null : parseAnswers(answers)
      await workspace.harness.answerQuestions(eventId, list)
    },
  )

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
