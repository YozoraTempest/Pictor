import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { ProviderList } from '@pictor/model-config'
import type { JsonValue, ModelSettings } from '@pictor/shared'

import type { KernelCapabilities } from './kinds.js'
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
 * The profile's model configuration, as much of it as a kernel may use.
 *
 * A kernel reads what it needs to start a turn; it does not get the service object,
 * because that object also writes providers, imports from other tools and holds the
 * key store. Naming four methods here is what makes "swap the kernel" safe: nothing
 * in a package can reach further than this.
 */
export interface KernelModelService {
  /** The selected model and the services it can choose from. */
  settings(): Promise<ModelSettings>
  /** Every configured service, with the active one marked. */
  providers(): Promise<ProviderList>
  /** Key for one service, or null when it has none stored. */
  apiKeyOf(providerId: string): string | null
  /** Key of the active service, which is what a runtime is booted with. */
  activeApiKey(): Promise<string | null>
}

/**
 * The person's tool rules, as a kernel uses them.
 *
 * One question — may this tool run without asking? — because that is the only thing a
 * kernel does with the book: the rules themselves belong to the window that edits them.
 */
export interface KernelRuleService {
  /** Whether a rule allows this tool outright. */
  allows(tool: string): boolean
}

/**
 * The profile's key/value store, for a kernel that owns a setting.
 *
 * Without this, a kernel's own switch would have to be persisted by whoever
 * assembles the app — which means the assembly has to know the key, and a second
 * kernel with a switch means a second special case in that file. Reads come from a
 * snapshot taken at startup and kept current by every write the app does, so a kernel
 * can answer for its own state synchronously and never from a stale copy.
 */
export interface KernelSettingsService {
  /** A stored value as last read or written; undefined when never set. */
  read(key: string): JsonValue | undefined
  /** Persists one value and remembers it. */
  write(key: string, value: JsonValue): Promise<void>
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
  models: KernelModelService
  rules: KernelRuleService
  guard: () => GuardEndpoint | null
  permission: () => Promise<'read-only' | 'workspace-write' | 'danger-full-access'>
  workspace: (sessionId: string) => Promise<string | null>
  userData: string
  settings: KernelSettingsService
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'pictor.models': KernelModelService
    'pictor.rules': KernelRuleService
    'pictor.guard': () => GuardEndpoint | null
    'pictor.permission': () => Promise<'read-only' | 'workspace-write' | 'danger-full-access'>
    'pictor.workspace': (sessionId: string) => Promise<string | null>
    'pictor.userdata': string
    'pictor.settings': KernelSettingsService
    [key: `kernel.${string}`]: KernelDriver
  }
}

/** A kernel plugin: a cordis plugin that provides exactly one `kernel.<id>`. */
export type KernelPlugin = Plugin<void>

/**
 * Where a kernel's plugin comes from.
 *
 * A built-in kernel is compiled into this app and an installed one is a directory
 * on disk, but both are "some module that exports a plugin": keeping that fact here,
 * instead of passing the plugin object around, is what makes turning a built-in into
 * its own package a change of one line rather than a change of shape.
 */
export interface KernelEntry {
  /** One plugin per call: a kernel switched off and on again is mounted afresh. */
  load: () => Promise<KernelPlugin>
}

/**
 * A kernel compiled into the app.
 *
 * `id` is carried beside the entry because the plugin itself only announces its id
 * once it is mounted — and a kernel a person turned off must never be mounted at all,
 * even briefly.
 */
export interface BuiltinKernel {
  id: string
  /** Shown in the picker and the plugin page, mounted or not. */
  label: string
  entry: KernelEntry
}

/** Methods each capability promises; a `true` with no method behind it is a lie. */
const CAPABILITY_METHODS: Readonly<
  Record<keyof KernelCapabilities, readonly (keyof KernelDriver)[]>
> = {
  permission: ['setPermissionMode', 'applyPermission', 'sessionPermission', 'setSessionPermission'],
  approval: ['answerApproval'],
  model: [],
  skills: ['listSkills'],
  fork: ['fork'],
  commands: ['commands', 'runCommand'],
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

/**
 * The rules a plugin's kernel object has to satisfy.
 *
 * Checked before the service exists: a kernel that claims a sandbox but cannot set
 * one would draw a switch that fails on use, so it is refused here instead, where
 * the failure has a name a person can read.
 */
export function assertKernelDriver(value: unknown): asserts value is KernelDriver {
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
 * Publish a kernel as its service.
 *
 * A plugin written in plain JavaScript may forget its display name; showing the id is
 * better than showing nothing in the picker. Defined on the instance rather than
 * spread, because a class-based driver keeps its methods on the prototype.
 */
export function provideKernel(ctx: Context, driver: KernelDriver): void {
  assertKernelDriver(driver)
  if (typeof driver.label !== 'string' || driver.label.length === 0) {
    Object.defineProperty(driver, 'label', {
      value: driver.id,
      enumerable: true,
      configurable: true,
    })
  }
  ctx.provide(`${KERNEL_PREFIX}${driver.id}`, driver)
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
