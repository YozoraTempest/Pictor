import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { parseKernelContribution, parsePackageManifest } from '@pictor/plugin-sdk'

import type { PermissionMode } from '../../shared/bridge.js'
import type { ModelService } from '../model-service.js'
import type { RuleBook } from '../rule-book.js'
import type { KernelDriver } from './driver.js'

/**
 * Where a kernel plugin puts its service.
 *
 * Every kernel is one cordis service named `kernel.<id>`, so installing a kernel
 * and starting one are the same act: the host watches services arrive and the
 * router is built from what is actually there, never from a list kept by hand.
 */
export const KERNEL_PREFIX = 'kernel.'

/** The loopback bridge that answers tool guards, when any guard is installed. */
export interface GuardEndpoint {
  port: number
  token: string
}

/**
 * What a kernel plugin may reach.
 *
 * Each entry is a separate service on purpose: a plugin declares the ones it needs
 * with `inject`, and that declaration is what the settings page shows a person
 * before they trust it. Nothing here hands out a stored secret — a kernel that
 * needs a key asks `pictor.models` for the running service, and the key travels the
 * same way it does for the built-in kernels.
 */
export interface KernelHostServices {
  models: ModelService
  rules: RuleBook
  guard: () => GuardEndpoint | null
  permission: () => Promise<PermissionMode>
  workspace: (sessionId: string) => Promise<string | null>
  userData: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'pictor.models': ModelService
    'pictor.rules': RuleBook
    'pictor.guard': () => GuardEndpoint | null
    'pictor.permission': () => Promise<PermissionMode>
    'pictor.workspace': (sessionId: string) => Promise<string | null>
    'pictor.userdata': string
    [key: `kernel.${string}`]: KernelDriver
  }
}

/** A kernel plugin: a cordis plugin that provides exactly one `kernel.<id>`. */
export type KernelPlugin = Plugin<void>

/** What asking the host to mount one plugin produced. */
export interface KernelMountResult {
  /** True when a `kernel.<id>` service appeared. */
  mounted: boolean
  /**
   * Why it did not mount, when that is a problem.
   *
   * `null` with `mounted: false` means the directory simply holds no kernel — a UI
   * plugin, say — which is not a failure and must not be reported as one.
   */
  failure: string | null
}

/** A kernel that could not be used, and why. */
export interface KernelPluginFailure {
  /** Directory name, or `builtin:<index>` for one compiled into the app. */
  source: string
  message: string
}

export interface KernelHostOptions {
  services: KernelHostServices
  /** Kernels compiled into the app, in mount order; the first one is the default. */
  builtins: readonly KernelPlugin[]
  /**
   * Directories scanned for installed plugins, highest priority first.
   *
   * Plugins and kernels share one root now, so the profile's `plugins/` comes first
   * and the older `kernels/` still works for what an earlier version installed. A
   * missing directory is simply nothing to scan.
   */
  directories: readonly string[]
}

/** One kernel as the settings page reports it: what it is and what it may reach. */
export interface KernelPluginReport {
  /** Kernel id once mounted; the directory name or `builtin:<n>` otherwise. */
  id: string
  label: string
  /** `builtin`, or the directory under the profile that holds it. */
  source: string
  /** Host services the plugin declared with `inject`. */
  services: readonly string[]
  available: boolean
  /** Why it could not be used, when it could not. */
  failure: string | null
}

export interface KernelHost {
  /**
   * Every kernel that came up, in mount order; the first is the default.
   *
   * The map is live: installing a kernel adds to it, uninstalling removes from it,
   * and the router reads it on every call, so nothing has to be rebuilt.
   */
  readonly drivers: ReadonlyMap<string, KernelDriver>
  /** Kernels that failed, so the settings page can name them. */
  readonly failures: readonly KernelPluginFailure[]
  /** Everything mounted or refused right now, for the settings page. */
  plugins(): KernelPluginReport[]
  /** Mount one installed plugin's kernel half without restarting the app. */
  mountInstalled(name: string): Promise<KernelMountResult>
  /** Unmount a kernel by id; its conversations then report it as missing. */
  unmount(id: string): Promise<void>
  dispose(): Promise<void>
}

/**
 * Publish a kernel as its service.
 *
 * `id` and `capabilities` are checked before the service exists: a kernel that
 * claims a sandbox but cannot set one would draw a switch that fails on use, so it
 * is refused here instead, where the failure has a name a person can read.
 */
export function provideKernel(ctx: Context, driver: KernelDriver): void {
  assertKernelDriver(driver)
  // A plugin written in plain JavaScript may forget its display name; showing the id
  // is better than showing nothing in the picker. Defined on the instance rather than
  // spread, because a class-based driver keeps its methods on the prototype.
  if (typeof driver.label !== 'string' || driver.label.length === 0) {
    Object.defineProperty(driver, 'label', {
      value: driver.id,
      enumerable: true,
      configurable: true,
    })
  }
  ctx.provide(`${KERNEL_PREFIX}${driver.id}`, driver)
}

/** Methods each capability promises; a `true` with no method behind it is a lie. */
const CAPABILITY_METHODS: Readonly<
  Record<keyof KernelDriver['capabilities'], readonly (keyof KernelDriver)[]>
> = {
  permission: ['setPermissionMode', 'applyPermission', 'sessionPermission', 'setSessionPermission'],
  approval: ['answerApproval'],
  model: [],
  skills: ['listSkills'],
  fork: ['fork'],
}

/** Methods every kernel has, whatever it declares. */
const CORE_METHODS: readonly (keyof KernelDriver)[] = [
  'start',
  'stop',
  'status',
  'install',
  'prompt',
  'cancel',
  'adopt',
  'openHistory',
  'historyPage',
  'onNotification',
  'answerQuestions',
  'applySettings',
  'projectRootFor',
  'probe',
]

function assertKernelDriver(value: unknown): asserts value is KernelDriver {
  if (typeof value !== 'object' || value === null) {
    throw new Error('内核插件没有给出内核对象')
  }
  const driver = value as Partial<KernelDriver>
  if (typeof driver.id !== 'string' || driver.id.length === 0) {
    throw new Error('内核插件缺少 id')
  }
  const missing = CORE_METHODS.filter((name) => typeof driver[name] !== 'function')
  if (missing.length > 0) {
    throw new Error(`内核「${driver.id}」缺少必需方法：${missing.join('、')}`)
  }
  const capabilities = driver.capabilities
  if (typeof capabilities !== 'object' || capabilities === null) {
    throw new Error(`内核「${driver.id}」没有声明 capabilities`)
  }
  const dishonoured: string[] = []
  for (const [capability, methods] of Object.entries(CAPABILITY_METHODS)) {
    if (capabilities[capability as keyof KernelDriver['capabilities']] !== true) continue
    for (const method of methods) {
      if (typeof driver[method] !== 'function') dishonoured.push(`${capability} → ${method}`)
    }
  }
  if (dishonoured.length > 0) {
    throw new Error(`内核「${driver.id}」声明了做不到的能力：${dishonoured.join('、')}`)
  }
}

/**
 * Start the kernel container.
 *
 * Built-ins mount first so the default kernel is the one the app was built around;
 * installed kernels follow, each isolated: a plugin that throws is reported and the
 * rest still come up, because one broken download must not take the app with it.
 */
export async function startKernelHost(options: KernelHostOptions): Promise<KernelHost> {
  const ctx = new Context()
  const drivers = new Map<string, KernelDriver>()
  const failures: KernelPluginFailure[] = []

  // `internal/service` fires for every published service, which is how a kernel
  // appears here: nothing enumerates plugins, only what they provided.
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (!name.startsWith(KERNEL_PREFIX)) return
    try {
      assertKernelDriver(value)
      drivers.set(value.id, value)
    } catch (error) {
      failures.push({ source: name, message: messageOf(error) })
    }
  })

  ctx.provide('pictor.models', options.services.models)
  ctx.provide('pictor.rules', options.services.rules)
  ctx.provide('pictor.guard', options.services.guard)
  ctx.provide('pictor.permission', options.services.permission)
  ctx.provide('pictor.workspace', options.services.workspace)
  ctx.provide('pictor.userdata', options.services.userData)

  /** Which plugin brought each kernel up, what it needs, and how to unload it. */
  const mounted = new Map<string, { source: string; services: readonly string[]; fiber: Fiber }>()

  const mount = async (
    plugin: KernelPlugin,
    source: string,
    failureName = source,
  ): Promise<string | null> => {
    const known = new Set(drivers.keys())
    let fiber: Fiber
    try {
      fiber = await ctx.plugin(plugin)
    } catch (error) {
      const message = messageOf(error)
      failures.push({ source: failureName, message })
      return message
    }
    // A plugin publishes its service synchronously inside `apply`, so whatever
    // arrived here came from this one.
    let last: string | null = null
    for (const id of drivers.keys()) {
      if (known.has(id)) continue
      mounted.set(id, { source, services: declaredServices(plugin), fiber })
      last = id
    }
    return last === null ? `${failureName} 没有提供内核服务` : null
  }

  for (const [index, plugin] of options.builtins.entries()) {
    // The successful ones are all `builtin`; a failure names which built-in it was.
    await mount(plugin, 'builtin', `builtin:${String(index)}`)
  }

  for (const found of discoverKernels(options.directories)) {
    if ('error' in found) {
      failures.push({ source: found.source, message: found.error })
      continue
    }
    await mount(found.plugin, found.source)
  }

  return {
    drivers,
    failures,
    plugins(): KernelPluginReport[] {
      const reports: KernelPluginReport[] = [...drivers].map(([id, driver]) => ({
        id,
        label: driver.label,
        source: mounted.get(id)?.source ?? 'builtin',
        services: mounted.get(id)?.services ?? [],
        available: isAvailable(driver),
        failure: null,
      }))
      for (const failure of failures) {
        reports.push({
          id: failure.source,
          label: failure.source,
          source: failure.source,
          services: [],
          available: false,
          failure: failure.message,
        })
      }
      return reports
    },
    async mountInstalled(name: string): Promise<KernelMountResult> {
      const found = discoverKernel(options.directories, name, { required: false })
      if (found === null) return { mounted: false, failure: null }
      if ('error' in found) return { mounted: false, failure: found.error }
      const failure = await mount(found.plugin, found.source)
      return { mounted: failure === null, failure }
    },
    async unmount(id: string): Promise<void> {
      const record = mounted.get(id)
      if (record === undefined) return
      // Unloading the fiber unprovides the service; the driver map is ours to clean.
      await record.fiber.dispose()
      mounted.delete(id)
      drivers.delete(id)
      const index = failures.findIndex((entry) => entry.source === id)
      if (index >= 0) failures.splice(index, 1)
    },
    async dispose(): Promise<void> {
      await ctx.fiber.dispose()
    },
  }
}

type KernelEntry = { source: string; plugin: KernelPlugin } | { source: string; error: string }

/** File naming the kernels installed as packages, rather than copied folders. */
export const PACKAGE_LIST = 'kernels.json'

/**
 * Installed kernels, found by directory and imported by path.
 *
 * Two shapes live side by side under the profile's `kernels/`:
 *
 * - a **folder**, copied in whole, which is what installing a directory produces;
 * - a **package**, installed into `kernels/node_modules` by the package manager and
 *   named in `kernels.json`, which is the only way a kernel can bring its own
 *   dependencies with it.
 *
 * Either way the entry point is imported by file: ESM resolution still walks up from
 * that file, which is where those dependencies live. The import itself is deferred to
 * mount time — the module graph is ESM, and a plugin that fails to import has to fail
 * alone.
 */
function discoverKernels(directories: readonly string[]): KernelEntry[] {
  const entries: KernelEntry[] = []
  const seen = new Set<string>()
  for (const directory of directories) {
    // The first root that offers a name wins; a plugin installed twice is one plugin.
    for (const name of [...installedFolders(directory), ...installedPackages(directory)]) {
      if (seen.has(name)) continue
      seen.add(name)
      const found = discoverKernel(directories, name, { required: false })
      if (found === null) continue
      seen.add(name)
      entries.push(found)
    }
  }
  return entries
}

/** One installed kernel by name, looked up across the roots: folder first, then package. */
function discoverKernel(
  directories: readonly string[],
  name: string,
  options: { required: boolean },
): KernelEntry | null {
  const root = kernelRoot(directories, name)
  if (root === null) return options.required ? { source: name, error: '内核目录不存在' } : null

  let main: string
  try {
    const found = kernelEntryOf(root)
    // A plugin that contributes no kernel shares this directory with ones that do;
    // it is not a broken kernel, it is simply not one.
    if (found === null) {
      return options.required ? { source: name, error: '这个插件没有声明内核' } : null
    }
    main = found
  } catch (error) {
    return { source: name, error: messageOf(error) }
  }

  const entry = join(root, main)
  if (!existsSync(entry)) return { source: name, error: `入口不存在：${main}` }
  return { source: name, plugin: mountModule(entry, name) }
}

/**
 * Where a plugin's kernel entry is.
 *
 * The `pictor` field is the format now: `main` in a `package.json` is the UI entry,
 * and a kernel names its own module under `contributes`. A package without the field
 * predates it and used `main` for the kernel itself, which still works.
 */
function kernelEntryOf(root: string): string | null {
  const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >

  if (!('pictor' in parsed)) {
    return typeof parsed.main === 'string' && parsed.main.length > 0 ? parsed.main : 'index.js'
  }

  const manifest = parsePackageManifest(parsed)
  for (const contribution of manifest.contributes ?? []) {
    if (contribution.point !== 'kernel') continue
    return parseKernelContribution(contribution.value).main
  }
  return null
}

/** Where a kernel lives: a folder under a root, or a package in its store. */
function kernelRoot(directories: readonly string[], name: string): string | null {
  for (const directory of directories) {
    const folder = join(directory, name)
    if (existsSync(join(folder, 'package.json'))) return folder
    const packaged = join(directory, 'node_modules', name)
    if (existsSync(join(packaged, 'package.json'))) return packaged
  }
  return null
}

/** Copied-in kernels: every child directory that is a package. */
function installedFolders(directory: string): string[] {
  try {
    return (
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        // `node_modules` holds packages, and they are listed by name instead.
        .filter((entry) => entry.name !== 'node_modules')
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(directory, name, 'package.json')))
        .sort()
    )
  } catch {
    return []
  }
}

/** Package-installed kernels: only the ones the list names, never a dependency. */
function installedPackages(directory: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(join(directory, PACKAGE_LIST), 'utf8')) as {
      packages?: unknown
    }
    if (!Array.isArray(parsed.packages)) return []
    return parsed.packages.filter((entry): entry is string => typeof entry === 'string').sort()
  } catch {
    return []
  }
}

/** A plugin that imports its module when cordis mounts it. */
function mountModule(entry: string, name: string): KernelPlugin {
  return {
    name: `installed:${name}`,
    async apply(ctx: Context): Promise<void> {
      const loaded = (await import(pathToFileURL(entry).href)) as {
        default?: unknown
        apply?: unknown
      }
      const inner = loaded.default ?? loaded.apply
      if (typeof inner !== 'function' && (typeof inner !== 'object' || inner === null)) {
        throw new Error(`内核插件 ${name} 没有 default 或 apply 导出`)
      }
      // A separate fiber, so the kernel's service disappears when it unloads.
      await ctx.plugin(inner as Plugin)
    },
  }
}

/**
 * A host service, which an `inject` list already promised exists.
 *
 * Cordis types a lookup as possibly undefined because a service can be unloaded
 * while a plugin is still running; here a plugin only starts once every injected
 * service is available, so a missing one means the host itself is broken.
 */
export function hostService<K extends Parameters<Context['get']>[0] & keyof Context>(
  ctx: Context,
  name: K,
): Context[K] {
  const value = ctx.get(name)
  if (value === undefined) throw new Error(`宿主服务 ${String(name)} 不可用`)
  return value
}

/** The host services a plugin declared, in the shape `inject` allows. */
function declaredServices(plugin: KernelPlugin): readonly string[] {
  const inject = (plugin as { inject?: unknown }).inject
  if (Array.isArray(inject))
    return inject.filter((entry): entry is string => typeof entry === 'string')
  if (typeof inject === 'object' && inject !== null) return Object.keys(inject)
  return []
}

/** Whether the kernel says it can run here; a broken one is not available. */
function isAvailable(driver: KernelDriver): boolean {
  try {
    return driver.status().binary !== null
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
