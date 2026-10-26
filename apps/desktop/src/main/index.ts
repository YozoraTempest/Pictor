import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ApplicationHost, acquireProfileLock, ProfileLockedError } from '@pictor/application'
import { resolveHostCoreBinary, startHostCore } from '@pictor/host-client'
import {
  PluginHost,
  PluginInstaller,
  discoverPlugins,
  type DiscoveredPlugin,
  expandPluginRoots,
  resolveActivationOrder,
} from '@pictor/plugin-host'
import {
  parsePanelContributions,
  parseSkillContributions,
  parseToolGuardContributions,
  parseToolViewContributions,
  type PanelContribution,
  type ToolGuardContribution,
  type ToolViewContribution,
} from '@pictor/plugin-sdk'
import {
  MODEL_EFFORTS,
  type ApprovalMode,
  type ChatAnswer,
  type ChatImage,
  type ChatQuestion,
  type ForkPoint,
  type ChatQuestionRequest,
  type ApprovalRequest,
  type JsonValue,
  type ModelEffort,
  type ModelProtocol,
  type PluginRecord,
  type Section,
  type SkillEntry,
  type ToolRule,
  composeSkills,
  parseToolRules,
} from '@pictor/shared'

import type {
  AppInfo,
  BuiltinKernelInfo,
  PluginOverview,
  HarnessStatus,
  HostSnapshot,
  KernelChangeResult,
  KernelPluginInfo,
  PermissionMode,
  PluginReport,
} from '../shared/bridge.js'
import { HarnessChatBridge } from './harness-chat.js'
import { shouldAdoptTitle } from './harness-title.js'
import { DEFAULT_PERMISSION_MODE, isPermissionMode } from './kernel/dsh-driver.js'
import { dshKernel } from './kernel/dsh-kernel.js'
import type { KernelDriver } from './kernel/driver.js'
import { startKernelHost, type KernelHost } from './kernel/host.js'
import { isProviderSource } from './kernel/model-source.js'
import { resolveNodeBinary, resolveNpmCli } from './kernel/node-runtime.js'
import { openSettings } from './kernel/settings-store.js'

import { createPiKernel } from './kernel/pi-kernel.js'
import { KernelRouter, type KernelInfo } from './kernel/router.js'
import { ToolGuardServer, type GuardAsk } from './tool-guard-server.js'
import { ModelService } from './model-service.js'
import { RuleBook, describeAsk, describeRule } from './rule-book.js'
import { SkillLibrary } from './skill-library.js'

/**
 * The services the mounted kernels want registered into them.
 *
 * Asked of whoever claims to need them rather than of a named kernel, and passed to the
 * bridge as opaque JSON: the shape is the asking kernel's (Pi's extension), so neither
 * this file nor the bridge spells it out. This used to read `piKernel.providers()`,
 * which is exactly the coupling that made "swap the kernel" a promise with an asterisk.
 */
async function providersFrom(
  drivers: ReadonlyMap<string, KernelDriver>,
): Promise<readonly unknown[]> {
  for (const driver of drivers.values()) {
    if (isProviderSource(driver)) return driver.providers()
  }
  return []
}

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '../..')
const repositoryRoot = resolve(appRoot, '../..')

app.setName('pictor')

// Tests and portable runs can redirect the whole profile.
const userDataOverride = process.env.PICTOR_USER_DATA
if (userDataOverride !== undefined && userDataOverride.trim().length > 0) {
  app.setPath('userData', userDataOverride)
}

/**
 * Whether this process owns the profile.
 *
 * A second launch belongs to the window that is already open, not to a second copy of
 * the app: the copy would take the debug port, fail the profile lock below, and leave
 * nothing behind that a person could see. Electron raises the existing window through
 * `second-instance` instead, which is what clicking the icon a second time means.
 */
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  // Exits immediately: the copy has nothing to attach to, and the profile lock in
  // `startWorkspace` would refuse it after binding Electron's debug port.
  app.exit(4)
}

let mainWindow: BrowserWindow | null = null
let disposeWorkspace: (() => Promise<void>) | null = null

app.on('second-instance', () => {
  if (mainWindow === null) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

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
  /** Routes each conversation to the kernel that owns it. */
  harness: KernelRouter
  /** The kernel container: what is mounted, what was refused, and why. */
  kernels: KernelHost
  /** Installs and removes plugins under the profile. */
  installer: PluginInstaller
  /** Every plugin directory found at launch, bundled first. */
  pluginDirectories: () => readonly string[]
  /** Writes one setting a kernel declared, and remembers it. */
  setKernelSetting: (key: string, value: boolean) => Promise<boolean>
  /** Writes one setting Pictor owns; kernels read the same snapshot afterwards. */
  writeSetting: (key: string, value: JsonValue) => Promise<void>
  /** Sandbox mode persisted in settings; read fresh so a change needs no restart. */
  readPermissionMode: () => Promise<PermissionMode>
  /** Panels contributed by plugins; built-in panels live in the renderer registry. */
  panels: PanelContribution[]
  /** Presentation for agent tools; the renderer applies them to its presenters. */
  toolViews: ToolViewContribution[]
  /** Skills Pictor owns, and the switches that apply to skills it does not. */
  skills: SkillLibrary
  /** The person's tool rules; the guard and approval prompts read it live. */
  rules: RuleBook
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
      // No dialog: a modal box waits for a person, so a launch from a terminal or a
      // test harness would sit forever on a profile nobody can unlock. The lock owner
      // is enough to diagnose it, and the exit code says the profile was refused.
      process.stderr.write(
        `pictor: profile is locked by ${error.owner} (${lockPath}); another instance owns it\n`,
      )
      app.exit(4)
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

  // What ships with the app, plus what a person installed: one discovery pass, so a
  // downloaded plugin behaves exactly like a bundled one.
  const pluginRoot = app.isPackaged
    ? join(process.resourcesPath, 'plugins')
    : join(repositoryRoot, 'plugins')
  const candidateRoots = expandPluginRoots([pluginRoot, join(userData, 'plugins')])

  const discovery = discoverPlugins(candidateRoots)
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
    // The running app's version, so `engines.pictor` checks against something real.
    pictorVersion: app.getVersion(),
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
  // A person's own tool rules live beside the plugin guards: one guard closes over
  // the book and reads it per call, so saving a rule needs no restart.
  const rules = new RuleBook(running.client)
  await rules.load()

  // The profile's settings once, plus the one function every write goes through: a
  // kernel reads the snapshot, and a page that saves anything keeps it current. That
  // is what lets a kernel ask "what did the person choose?" without this file knowing
  // which key it means, and without a stale answer after the page saves.
  const settings = await openSettings(running.client)
  const stored = settings.values()

  // Which kernels this machine runs. Both are a person's choice, kept in settings so
  // "the built-in kernel is the default" stops being a fact of the build.
  const disabledBuiltins = readStringList(stored[BuiltinKernelsKey])
  const preferredKernel =
    typeof stored[DefaultKernelKey] === 'string' ? stored[DefaultKernelKey] : null

  // One installer for both halves: a plugin may contribute panels, a kernel, or both,
  // and installing it should not be two decisions.
  const installer = new PluginInstaller({
    directory: join(userData, 'plugins'),
    npm: () => {
      const node = resolveNodeBinary()
      if (node === null)
        throw new Error('没有找到可用的 Node；安装 Node 22+ 或设置 PICTOR_NODE_BIN')
      const cli = resolveNpmCli(node)
      if (cli === null) throw new Error('没有找到 npm，无法安装插件包')
      return { node, cli }
    },
    validate: (root) => {
      const discovery = discoverPlugins([root])
      if (discovery.plugins.length > 0) return
      throw new Error(
        discovery.failures[0]?.reason ?? '这不是一个插件：package.json 里没有 pictor 字段',
      )
    },
  })
  const ruleGuard: ToolGuardContribution = {
    id: 'pictor-rules',
    title: '工具规则',
    decide: (context) => {
      const rule = rules.denyFor(context)
      return rule === null
        ? { decision: 'allow' }
        : { decision: 'deny', reason: `被工具规则拦截：${describeRule(rule)}` }
    },
  }
  // Holding a call for a person is a second question, asked only by a caller that can
  // wait for the answer. The rules answer it, and so does the conversation's own mode —
  // which belongs to the kernel that runs that conversation, not to a named one here.
  let router: KernelRouter | null = null
  const askFor = async (context: GuardAsk): Promise<{ tool: string; reason: string } | null> => {
    const session = context.session
    // A call with no conversation to name cannot have a mode; the rules still apply, so
    // it is asked as if its kernel never opted in. Otherwise the conversation's own
    // kernel answers, whatever kernel that is.
    let mode: ApprovalMode = 'never'
    let granted = false
    if (session !== null && router !== null) {
      mode = await router.guardApprovalMode(session)
      granted = await router.guardIsGranted(session, context.tool)
    }
    const verdict = rules.askFor({
      tool: context.tool,
      args: context.args,
      mutating: context.mutating,
      mode,
      // A tool the person already allowed in this conversation stops asking — unless
      // a rule of theirs names this call, which the policy decides.
      granted,
    })
    return verdict === null
      ? null
      : { tool: context.tool, reason: describeAsk(verdict, context.tool, context.args) }
  }

  // Guards are closures in this process, so the runtime asks them over a loopback
  // socket instead of receiving them as configuration. The bridge is always up:
  // the rule guard is always present, and rules can be added while it runs.
  // What Pi needs to run the same services: one shared configuration instead of two
  // copies. The kernel plugin derives it from `pictor.models`; the bridge only holds
  // the callback, because the extension asks for it over the loopback socket and keys
  // never reach the file on disk.
  // Resolved per request rather than captured: the bridge outlives any one kernel
  // being mounted or unmounted, and it is only asked when an extension wants services.
  let kernelHost: KernelHost | null = null
  const guardBridge = new ToolGuardServer([ruleGuard, ...toolGuards], randomUUID(), askFor, () =>
    providersFrom(kernelHost?.drivers ?? new Map()),
  )
  void guardBridge.start().catch((error: unknown) => {
    console.warn('[tool-guard] bridge 启动失败', error instanceof Error ? error.message : error)
  })
  // A conversation's directory comes from the project it was filed under. The
  // lookup happens per session because the runtime decides the sandbox root when
  // it creates one; nothing here changes a conversation that already exists.
  const resolveCwd = async (sessionId: string): Promise<string | null> => {
    const sessions = await running.client.listSessions()
    const session = sessions.find((entry) => entry.id === sessionId)
    if (session === undefined || session.projectId === null) return null
    const projects = await running.client.listProjects()
    const path = projects.find((project) => project.id === session.projectId)?.path ?? null
    return path !== null && existsSync(path) ? path : null
  }

  // Every kernel is mounted the same way — one cordis plugin that provides one
  // `kernel.<id>` service — so adding a third is a directory, not a build. What is
  // compiled in goes first, and whatever the profile has installed follows.
  const kernels: KernelHost = await startKernelHost({
    services: {
      models: model,
      rules,
      guard: () => guardBridge.endpoint,
      permission: readPermissionMode,
      workspace: resolveCwd,
      userData,
      settings: settings.service,
    },
    builtins: [
      { id: 'dsh', label: 'DeepSeek Harness', entry: { load: async () => dshKernel } },
      { id: 'pi', label: 'Pi', entry: { load: async () => createPiKernel() } },
    ],
    disabled: disabledBuiltins,
    directories: [join(userData, 'plugins')],
  })
  kernelHost = kernels
  const harness: KernelRouter = new KernelRouter({
    drivers: kernels.drivers,
    defaultKernel: preferredKernel,
    lookup: {
      kernelOf: async (sessionId) => {
        const session = (await running.client.listSessions()).find(
          (entry) => entry.id === sessionId,
        )
        return session?.kernelId ?? null
      },
    },
  })
  router = harness
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
        sessionId?: unknown
      }
      if (typeof params.eventId === 'string') {
        const request: ApprovalRequest = {
          eventId: params.eventId,
          tool: typeof params.tool === 'string' ? params.tool : null,
          reason: typeof params.reason === 'string' ? params.reason : null,
          // A kernel that names the conversation lets the card stay in it, and lets
          // the answer be scoped to it. dsh's prompts carry no session, so it stays out.
          ...(typeof params.sessionId === 'string' && params.sessionId.length > 0
            ? { sessionId: params.sessionId }
            : {}),
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:harness.approval', request)
        }
      }
    }
    if (notification.method === 'question.request') {
      const params = (notification.params ?? {}) as {
        eventId?: unknown
        questions?: unknown
        sessionId?: unknown
      }
      if (typeof params.eventId === 'string' && Array.isArray(params.questions)) {
        const request: ChatQuestionRequest = {
          eventId: params.eventId,
          // Same as an approval: a kernel that names the conversation lets the card
          // stay in it.
          ...(typeof params.sessionId === 'string' && params.sessionId.length > 0
            ? { sessionId: params.sessionId }
            : {}),
          questions: params.questions as ChatQuestion[],
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:harness.question', request)
        }
      }
    }
    if (notification.method === 'kernel.notice') {
      const params = (notification.params ?? {}) as { message?: unknown; level?: unknown }
      const message = typeof params.message === 'string' ? params.message : ''
      if (message.length > 0) {
        const notice = {
          message: message.slice(0, 400),
          level: params.level === 'error' ? 'error' : 'info',
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('pictor:kernel.notice', notice)
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
    kernels,
    installer,
    pluginDirectories: () => candidateRoots,
    // The kernel that declared the key is the one that writes it, persistence
    // included; this only asks every catalogue to look again afterwards.
    setKernelSetting: async (key, value) => {
      const applied = await harness.setKernelSetting(key, value)
      harness.invalidateCatalogues()
      return applied
    },
    writeSetting: settings.write,
    readPermissionMode,
    isDisposed: () => disposed,
    client: running.client,
    hostCore,
    database,
    panels,
    toolViews,
    skills,
    rules,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await kernels.dispose()
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
/** A fork point from the renderer, or nothing when it named no message. */
function parseForkPoint(value: unknown): ForkPoint | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new Error('分叉点必须是一个对象')
  const point = value as { seq?: unknown; id?: unknown }
  if (point.seq !== undefined && typeof point.seq !== 'number') {
    throw new Error('分叉点 seq 必须是数字')
  }
  if (point.id !== undefined && (typeof point.id !== 'string' || point.id.length === 0)) {
    throw new Error('分叉点 id 必须是非空字符串')
  }
  if (point.seq === undefined && point.id === undefined) return undefined
  return {
    ...(point.seq === undefined ? {} : { seq: point.seq }),
    ...(point.id === undefined ? {} : { id: point.id }),
  }
}

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

/** Built-in kernel ids a person turned off. */
const BuiltinKernelsKey = 'kernel.disabled'

/** Which kernel new conversations start on; absent means the first that loaded. */
const DefaultKernelKey = 'kernel.default'

/** A settings value that should be a list of names; anything else is nothing. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
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

  ipcMain.handle(
    'pictor:session.create',
    async (_event, projectId: unknown, title: unknown, kernelId: unknown, parentId: unknown) => {
      if (typeof title !== 'string') throw new Error('title must be a string')
      if (projectId !== null && typeof projectId !== 'string') {
        throw new Error('projectId must be a string or null')
      }
      // `null` and an absent argument both mean "not specified": callers reach
      // this from several layers, and a picker that clears a value sends null.
      const kernel = kernelId === null || kernelId === undefined ? null : kernelId
      const parent = parentId === null || parentId === undefined ? null : parentId
      if (kernel !== null && (typeof kernel !== 'string' || kernel.length === 0)) {
        throw new Error('kernelId must be a non-empty string')
      }
      if (parent !== null && (typeof parent !== 'string' || parent.length === 0)) {
        throw new Error('parentId must be a non-empty string')
      }
      // No kernel named means "the default one", and which that is belongs to the
      // settings, not to a constant baked into the metadata store.
      if (kernel === null && workspace.harness.id === '') {
        throw new Error('这台机器上没有可用的内核；先到「设置 › 通用 › 插件」装一个')
      }

      // The kernel is fixed at creation: a conversation's history belongs to the
      // one that produced it, so switching later is a branch, not an edit.
      return workspace.appHost.commands.execute('session.create', {
        projectId,
        title,
        kernelId: kernel ?? workspace.harness.id,
        ...(parent === null ? {} : { parentId: parent }),
      })
    },
  )

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
    await workspace.writeSetting(key, value as JsonValue)
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
    const saved = await workspace.model.saveProvider(
      input as Parameters<ModelService['saveProvider']>[0],
    )
    workspace.harness.invalidateCatalogues()
    return applyToRuntime(saved)
  })

  ipcMain.handle('pictor:provider.remove', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    const left = await workspace.model.removeProvider(id)
    workspace.harness.invalidateCatalogues()
    return applyToRuntime(left)
  })

  ipcMain.handle('pictor:provider.activate', async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new Error('provider id is required')
    const active = await workspace.model.activateProvider(id)
    workspace.harness.invalidateCatalogues()
    return applyToRuntime(active)
  })

  ipcMain.handle('pictor:model.ccswitch.scan', async () => {
    return workspace.model.scanCcSwitch()
  })

  ipcMain.handle(
    'pictor:model.ccswitch.import',
    async (_event, id: unknown, includeApiKey: unknown) => {
      if (typeof id !== 'string' || id.trim().length === 0)
        throw new Error('provider id is required')
      const imported = await workspace.model.importCcSwitchProvider(id, includeApiKey === true)
      workspace.harness.invalidateCatalogues()
      return applyToRuntime(imported)
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
    const ready = (await workspace.harness.statusOf(sessionId)).state === 'ready'
    return {
      path: `harness:${sessionId}`,
      history: ready
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
  ipcMain.handle('pictor:session.fork', async (_event, sessionId: unknown, at: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    // The point is whatever the caller's rows carry: an event sequence for dsh, an
    // entry id for a kernel that branches by message. Both are optional.
    const point = parseForkPoint(at)
    if ((await workspace.harness.statusOf(sessionId)).state !== 'ready') {
      throw new Error('先启动 agent 运行时')
    }

    const sessions = await workspace.client.listSessions()
    const source = sessions.find((entry) => entry.id === sessionId)
    if (source === undefined) throw new Error('session not found')

    const child = await workspace.harness.fork(sessionId, point)
    // The parent is recorded here, not in the runtime: only Pictor knows which
    // conversations belong to the same family.
    const created = await workspace.client.createSession(
      source.projectId,
      `${source.title} · 分支`,
      source.id,
      // A branch keeps the kernel that produced the history it inherits.
      source.kernelId,
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
      if ((await workspace.harness.statusOf(sessionId)).state !== 'ready') {
        throw new Error('agent 运行时没有运行；先启动它再发消息')
      }
      await workspace.harness.prompt(sessionId, prompt, attachments, level)
    },
  )

  ipcMain.handle('pictor:chat.stop', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
    // Nothing to stop when the kernel is down: the turn died with it.
    if ((await workspace.harness.statusOf(sessionId)).state !== 'ready') return
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
      await workspace.writeSetting('harness.permissionMode', mode)
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
      await workspace.harness.projectRootFor(sessionId),
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

  ipcMain.handle('pictor:kernels.list', async (): Promise<KernelInfo[]> => {
    return workspace.harness.list()
  })

  /**
   * Install a kernel, then mount it.
   *
   * The two steps stay apart on purpose: a copy that succeeds and a mount that fails
   * is a kernel on disk with a reason attached, which the settings page shows, rather
   * than a rollback that hides what went wrong.
   */
  /**
   * Install a plugin, then start both halves of it.
   *
   * A plugin may contribute panels, a kernel, or both, and installing is one act: the
   * kernel half is mounted and the UI half activated, without a restart. Whichever
   * half it does not have is simply not there.
   */
  const mountAfterInstall = async (
    install: () => Promise<{ name: string }> | { name: string },
  ): Promise<KernelChangeResult> => {
    let installed: { name: string }
    try {
      installed = await install()
    } catch (error) {
      return {
        ok: false,
        id: null,
        message: error instanceof Error ? error.message : String(error),
      }
    }

    const root = workspace.installer.rootOf(installed.name)
    const found = root === null ? [] : discoverPlugins([root]).plugins
    const kernelId = await activateHalves(found, installed.name)
    return kernelId
  }

  /**
   * Starts the halves of one plugin and reports what it became.
   *
   * The kernel is mounted first: it is the half that can fail for a reason worth
   * showing (a broken cordis plugin, a capability it cannot honour), and the UI half
   * failing would otherwise be reported as if the whole plugin had.
   */
  const activateHalves = async (
    plugins: readonly DiscoveredPlugin[],
    name: string,
  ): Promise<KernelChangeResult> => {
    for (const plugin of plugins) {
      await workspace.pluginHost.add(plugin)
    }

    // The kernel host is the one that knows whether this directory holds a kernel: an
    // older plugin has no manifest to ask, and a UI-only plugin has no kernel to mount
    // — neither is a failure.
    const mounted = await workspace.kernels.mountInstalled(name)
    if (!mounted.mounted && mounted.failure !== null) {
      return { ok: false, id: name, message: mounted.failure }
    }
    return { ok: true, id: name, message: '' }
  }

  ipcMain.handle('pictor:kernels.chooseFolder', async (): Promise<string | null> => {
    const chosen = await dialog.showOpenDialog({
      title: '选择一个内核目录',
      properties: ['openDirectory'],
    })
    return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
  })

  ipcMain.handle(
    'pictor:kernels.installFolder',
    async (_event, source: unknown): Promise<KernelChangeResult> => {
      if (typeof source !== 'string' || source.length === 0) {
        return { ok: false, id: null, message: '需要一个目录' }
      }
      return mountAfterInstall(() => workspace.installer.installFolder(source))
    },
  )

  ipcMain.handle(
    'pictor:kernels.installPackage',
    async (_event, spec: unknown): Promise<KernelChangeResult> => {
      if (typeof spec !== 'string' || spec.trim().length === 0) {
        return { ok: false, id: null, message: '需要一个包名' }
      }
      return mountAfterInstall(() => workspace.installer.installPackage(spec))
    },
  )

  ipcMain.handle(
    'pictor:kernels.remove',
    async (_event, id: unknown): Promise<KernelChangeResult> => {
      if (typeof id !== 'string') throw new Error('id must be a string')
      const report = workspace.kernels.plugins().find((entry) => entry.id === id)
      if (report === undefined) throw new Error('没有这个内核')
      if (report.source === 'builtin') throw new Error('内置内核不能卸载')
      // Unmount first: the conversations it ran would otherwise talk to a kernel whose
      // files are gone.
      await workspace.kernels.unmount(id)
      workspace.harness.refreshDefault()
      const root = workspace.installer.rootOf(report.source)
      if (root !== null) {
        for (const plugin of discoverPlugins([root]).plugins) {
          await workspace.pluginHost.remove(plugin.id)
        }
      }
      try {
        await workspace.installer.remove(report.source)
      } catch (error) {
        return { ok: false, id, message: error instanceof Error ? error.message : String(error) }
      }
      return { ok: true, id, message: '' }
    },
  )

  /**
   * Every installed plugin, in the shape the settings page draws.
   *
   * Recomputed on every call rather than cached: installing or removing a plugin
   * changes the answer, and a snapshot taken at launch would keep showing the old one.
   */
  /** The kernels compiled into the app, mounted or turned off. */
  ipcMain.handle('pictor:kernels.builtins', async (): Promise<BuiltinKernelInfo[]> => {
    const reports = workspace.kernels.plugins()
    const defaultId = workspace.harness.id
    return workspace.kernels.builtins().map((entry) => {
      const mounted = reports.find((report) => report.id === entry.id)
      return {
        id: entry.id,
        label: entry.label,
        enabled: entry.mounted,
        default: entry.id === defaultId,
        services: mounted === undefined ? [] : [...mounted.services],
      }
    })
  })

  /**
   * Turns a built-in kernel off or on, live.
   *
   * Turning it off unmounts it, so it leaves the picker at once; turning it on mounts
   * it again. The setting is what makes the choice survive a restart.
   */
  ipcMain.handle(
    'pictor:kernels.setBuiltinEnabled',
    async (_event, id: unknown, enabled: unknown): Promise<boolean> => {
      if (typeof id !== 'string' || typeof enabled !== 'boolean') {
        throw new Error('id and enabled are required')
      }
      const current = readStringList((await workspace.client.listSettings())[BuiltinKernelsKey])
      const next = enabled
        ? current.filter((entry) => entry !== id)
        : [...new Set([...current, id])]
      await workspace.writeSetting(BuiltinKernelsKey, next)

      if (enabled) {
        const result = await workspace.kernels.mountBuiltin(id)
        const mounted = workspace.harness.list().some((kernel) => kernel.id === id)
        if (!mounted && result.failure !== null) {
          console.warn(`[kernel] ${id} 没能启动：${result.failure}`)
        }
      } else {
        await workspace.kernels.unmount(id)
      }
      // The default may have just been turned off, or a newly mounted one may be the
      // only kernel left.
      workspace.harness.refreshDefault()
      return enabled
    },
  )

  /** Chooses where new conversations start; conversations keep the kernel they ran on. */
  ipcMain.handle('pictor:kernels.setDefault', async (_event, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    if (!workspace.harness.setDefault(id)) return false
    await workspace.writeSetting(DefaultKernelKey, id)
    return true
  })

  ipcMain.handle('pictor:plugins.overview', async (): Promise<PluginOverview[]> => {
    const records = await workspace.client.listPlugins()
    // The workspace already holds expanded plugin directories, not parents.
    const found = discoverPlugins([...workspace.pluginDirectories()])
    const kernels = workspace.kernels.plugins()

    // `kernel` is not counted here: a kernel is a cordis service, not a contribution
    // the plugin host recorded, and the row lists it separately with its services.
    const points = ['commands', 'panels', 'toolGuards', 'toolViews', 'skills'] as const
    return found.plugins.map((plugin) => {
      const name = basename(plugin.root)
      const record = records.find((entry) => entry.id === plugin.id)
      const contributions = points
        .map((point) => ({
          point,
          count: workspace.pluginHost
            .contributionsWithSource(point)
            .filter((entry) => entry.pluginId === plugin.id).length,
        }))
        .filter((entry) => entry.count > 0)
      const mounted = kernels.filter((kernel) => kernel.source === name && kernel.failure === null)

      return {
        name,
        id: plugin.id,
        label: plugin.manifest.name,
        version: plugin.manifest.version,
        source: name === 'plugins' ? 'builtin' : name,
        enabled: record?.enabled ?? true,
        contributions,
        kernels: mounted.map((kernel) => ({
          id: kernel.id,
          label: kernel.label,
          services: [...kernel.services],
          available: kernel.available,
        })),
        failure:
          kernels.find((kernel) => kernel.source === name && kernel.failure !== null)?.failure ??
          null,
      }
    })
  })

  ipcMain.handle('pictor:kernels.plugins', async (): Promise<KernelPluginInfo[]> => {
    return workspace.kernels.plugins().map((entry) => ({
      id: entry.id,
      label: entry.label,
      source: entry.source,
      services: [...entry.services],
      available: entry.available,
      failure: entry.failure,
    }))
  })

  // A kernel that brings its own models answers for them; Pictor only relays.
  ipcMain.handle('pictor:kernel.models', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    return workspace.harness.kernelModels(sessionId)
  })

  ipcMain.handle('pictor:kernel.selectModel', async (_event, sessionId: unknown, id: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('modelId must be a non-empty string')
    }
    await workspace.harness.selectKernelModel(sessionId, id)
  })

  ipcMain.handle('pictor:kernels.statuses', async () => workspace.harness.statuses())

  /** Settings the mounted kernels declare; the page renders what it gets. */
  ipcMain.handle('pictor:kernels.settings', async () => workspace.harness.settings())

  ipcMain.handle('pictor:kernels.setSetting', async (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || key.length === 0) throw new Error('key must be a string')
    if (typeof value !== 'boolean') throw new Error('value must be a boolean')
    return workspace.setKernelSetting(key, value)
  })

  ipcMain.handle('pictor:kernel.approval', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    return workspace.harness.kernelApproval(sessionId)
  })

  ipcMain.handle('pictor:kernel.grants', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    return workspace.harness.kernelGrants(sessionId)
  })

  ipcMain.handle('pictor:kernel.grantTool', async (_event, sessionId: unknown, tool: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new Error('tool must be a non-empty string')
    }
    return workspace.harness.grantKernelTool(sessionId, tool)
  })

  ipcMain.handle('pictor:kernel.revokeGrants', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId must be a non-empty string')
    }
    return workspace.harness.revokeKernelGrants(sessionId)
  })

  ipcMain.handle(
    'pictor:kernel.selectApproval',
    async (_event, sessionId: unknown, mode: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('sessionId must be a non-empty string')
      }
      if (mode !== 'never' && mode !== 'mutating') {
        throw new Error(`不认识的审批模式：${String(mode)}`)
      }
      await workspace.harness.selectKernelApproval(sessionId, mode)
    },
  )

  ipcMain.handle(
    'pictor:kernel.selectEffort',
    async (_event, sessionId: unknown, effort: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('sessionId must be a non-empty string')
      }
      // `null` clears the level and leaves the kernel's own default in place.
      const level = effort === null || effort === undefined ? null : parseEffort(effort)
      await workspace.harness.selectKernelEffort(sessionId, level)
    },
  )

  ipcMain.handle('pictor:rules.list', async (): Promise<ToolRule[]> => workspace.rules.rules)

  ipcMain.handle('pictor:rules.save', async (_event, value: unknown): Promise<ToolRule[]> => {
    // The renderer sends the whole list; validation is the book's, so a bad row is
    // dropped here rather than reaching a guard that cannot explain itself.
    return workspace.rules.save(parseToolRules(value))
  })

  ipcMain.handle('pictor:harness.sessionPermission', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
      throw new Error('sessionId is required')
    const current = await workspace.harness.sessionPermission(sessionId)
    return isPermissionMode(current) ? current : null
  })

  ipcMain.handle(
    'pictor:harness.setSessionPermission',
    async (_event, sessionId: unknown, mode: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0)
        throw new Error('sessionId is required')
      if (!isPermissionMode(mode)) throw new Error('unknown permission mode')
      await workspace.harness.setSessionPermission(sessionId, mode)
      // The command answers without the new value, so the state is read back:
      // a runtime that ignored the switch must not leave the composer claiming it.
      const current = await workspace.harness.sessionPermission(sessionId)
      return isPermissionMode(current) ? current : null
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
