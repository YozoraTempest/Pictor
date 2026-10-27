import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import type { PluginKind, PluginManifest } from '@pictor/plugin-sdk'

import type { DiscoveredPlugin, PluginFailure } from './registry.js'

/** Where a plugin's module is in its own lifecycle, as this app reports it. */
export type PluginState =
  /** Loaded and running: its `apply` finished. */
  | 'active'
  /** Waiting for a service it declared in `inject`. Not a failure, but not running. */
  | 'pending'
  /** Threw while importing or starting. */
  | 'failed'

export interface MountedPlugin {
  id: string
  /** Package name, which is also the directory name for a folder install. */
  name: string
  version: string
  root: string
  kind: PluginKind
  /** Services the plugin declared it needs, in its own words. */
  inject: readonly string[]
  /** Declared services that this host does not provide. */
  missing: readonly string[]
  state: PluginState
  failure: string | null
}

export interface PluginContainerOptions {
  /** The tree to mount into. Kernels already live in it, so both halves share one. */
  ctx: Context
  /** Told about every plugin that could not start. */
  warn?: (message: string) => void
  /**
   * Names the plugin for the duration of its `apply`.
   *
   * A contribution has to know whose directory it may write to, and cordis only knows
   * the fiber. The container knows the package, so it says so here and the contribution
   * service records it. Absent means contributions go unattributed, which is honest but
   * loses per-plugin directories.
   */
  withOwner?: <T>(id: string, work: () => T) => T
}

/**
 * Mounts plugin packages into a cordis tree.
 *
 * This replaced a host that called `import()` itself and kept a list of contributions to
 * prune. Cordis already owns the two things that list was imitating: a plugin runs inside
 * a fiber, and unloading the fiber runs every disposer the plugin registered. So the
 * container's whole job is turn a directory into a plugin, and keep the answer to "what
 * is mounted, and what is it waiting for".
 *
 * Both plugin shapes are accepted, because that is what makes a package installable by
 * this app and by dsh:
 *
 * - a **cordis plugin** — `export default { name, inject, apply }`, `export function
 *   apply`, `export const inject`, or a `Service` class. Needs only `package.json`'s
 *   `main`; nothing in JSON describes it.
 * - a **Pictor plugin** — the same, plus a `pictor` block that declares an id, an engine
 *   range and the contribution points, so the settings page can describe it before it
 *   starts.
 */
export class PluginContainer {
  readonly #ctx: Context
  readonly #warn: (message: string) => void
  readonly #withOwner: (<T>(id: string, work: () => T) => T) | null
  readonly #mounted = new Map<string, { plugin: DiscoveredPlugin; fiber: Fiber }>()
  readonly #failures: PluginFailure[] = []

  constructor(options: PluginContainerOptions) {
    this.#ctx = options.ctx
    this.#warn = options.warn ?? ((message) => console.warn(`[plugin] ${message}`))
    this.#withOwner = options.withOwner ?? null
  }

  /** The tree everything is mounted into. */
  get ctx(): Context {
    return this.#ctx
  }

  /** Ids that are mounted right now, running or waiting. */
  has(id: string): boolean {
    return this.#mounted.has(id)
  }

  /**
   * Mounts one discovered plugin.
   *
   * Throws when the module cannot be imported or its `apply` throws, so the caller can
   * report a named failure. A plugin that is merely *waiting* for a service does not
   * throw: it mounted, and the report says which service is missing.
   */
  async mount(plugin: DiscoveredPlugin): Promise<MountedPlugin> {
    if (this.#mounted.has(plugin.id)) throw new Error(`${plugin.id} 已经挂载`)

    const main = plugin.manifest.main
    if (main === undefined) throw new Error(`${plugin.id} 没有可挂载的入口`)

    const entry = join(plugin.root, main)
    let loaded: ModuleShape
    try {
      loaded = (await import(pathToFileURL(entry).href)) as ModuleShape
    } catch (error) {
      throw this.#record(plugin, `导入失败：${messageOf(error)}`)
    }

    let fiber: Fiber
    try {
      const mounted = pluginOf(loaded, plugin)
      fiber = await this.#ctx.plugin(named(mounted, plugin.id, this.#withOwner) as Plugin)
    } catch (error) {
      throw this.#record(plugin, messageOf(error))
    }

    this.#mounted.set(plugin.id, { plugin, fiber })
    void fiber
    return this.report(plugin.id)
  }

  /** Unloads one plugin: cordis runs its disposers, which undoes its contributions. */
  async unmount(id: string): Promise<void> {
    const mounted = this.#mounted.get(id)
    if (mounted === undefined) return
    this.#mounted.delete(id)
    await mounted.fiber.dispose()
  }

  /** Everything mounted or refused right now. */
  list(): MountedPlugin[] {
    return [...this.#mounted.keys()].map((id) => this.report(id))
  }

  /** One plugin's current answer, or a reason there is nothing to report. */
  report(id: string): MountedPlugin {
    const mounted = this.#mounted.get(id)
    if (mounted === undefined) throw new Error(`没有挂载 ${id}`)

    const { plugin, fiber } = mounted
    const inject = declaredInject(fiber)
    const missing = inject.filter((service) => this.#ctx.get(service as never) === undefined)

    return {
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      root: plugin.root,
      kind: plugin.manifest.kind,
      inject,
      missing,
      state: stateOf(fiber, missing),
      failure: null,
    }
  }

  /** Refusals recorded while mounting; each names the plugin it came from. */
  failures(): readonly PluginFailure[] {
    return [...this.#failures]
  }

  #record(plugin: DiscoveredPlugin, reason: string): Error {
    this.#failures.push({ source: plugin.root, reason: `${plugin.id}: ${reason}` })
    this.#warn(`${plugin.id}: ${reason}`)
    return new Error(`${plugin.id}: ${reason}`)
  }
}

/** What a plugin module may look like, in either shape. */
interface ModuleShape {
  default?: unknown
  apply?: unknown
  inject?: unknown
  name?: unknown
}

/**
 * Turns a module into something cordis can mount.
 *
 * The named forms are accepted because a plugin written for dsh declares `apply` and
 * `inject` as module exports; the default form covers what this app's own examples use.
 * Nothing is invented when neither exists — a package with a `main` that exports nothing
 * useful is a package that cannot be a plugin.
 */
function pluginOf(loaded: ModuleShape, plugin: DiscoveredPlugin): unknown {
  if (loaded.default !== undefined && loaded.default !== null) return loaded.default

  if (typeof loaded.apply === 'function') {
    return {
      // A cordis plugin's own name wins: it is what shows up in cordis diagnostics.
      name: typeof loaded.name === 'string' ? loaded.name : plugin.manifest.name,
      ...(loaded.inject === undefined ? {} : { inject: loaded.inject }),
      apply: loaded.apply,
    }
  }

  throw new Error(`${plugin.id} 的模块既没有 default 导出，也没有 apply()`)
}

/**
 * Wraps a plugin so its `apply` runs under its own id.
 *
 * The forms are the ones cordis dispatches on. A class-based plugin is returned
 * untouched: cordis constructs it, and wrapping would change what `instanceof` means, so
 * its contributions go unattributed rather than the plugin being subtly different.
 */
function named(
  plugin: unknown,
  id: string,
  withOwner: (<T>(workId: string, work: () => T) => T) | null,
): unknown {
  if (withOwner === null) return plugin

  if (typeof plugin === 'function') {
    const apply = plugin as (ctx: Context) => unknown
    return (ctx: Context): unknown => withOwner(id, () => apply(ctx))
  }

  if (typeof plugin === 'object' && plugin !== null) {
    const record = plugin as { apply?: unknown }
    if (typeof record.apply === 'function') {
      const apply = record.apply as (ctx: Context) => unknown
      return { ...record, apply: (ctx: Context): unknown => withOwner(id, () => apply(ctx)) }
    }
  }

  return plugin
}

/** The services a plugin declared, whether it wrote them in code or in JSON. */
function declaredInject(fiber: Fiber): string[] {
  const inject = fiber.inject
  if (inject === null || inject === undefined) return []
  return Object.keys(inject).sort()
}

/**
 * Waiting and failing are different answers.
 *
 * A plugin whose `inject` names a service nobody provides is *pending*, not broken: it is
 * mounted, cordis will start it the moment that service appears, and the settings page
 * should say which service it is waiting for rather than call the plugin broken.
 */
function stateOf(fiber: Fiber, missing: readonly string[]): PluginState {
  // FiberState: PENDING = 0, LOADING = 1, ACTIVE = 2, FAILED = 3.
  if (missing.length > 0) return 'pending'
  const state = (fiber as { state?: number }).state
  if (state === 3) return 'failed'
  if (state === 2) return 'active'
  return 'pending'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A manifest that says what it is, for the report a plugin's row needs. */
export function describeManifest(manifest: PluginManifest): string {
  return manifest.kind === 'pictor'
    ? `${manifest.id} · ${manifest.version}`
    : `${manifest.name} · ${manifest.version} · cordis`
}

/** Packages installed as packages, listed by their `installed.json`. */
export function installedPackageRoots(directory: string): string[] {
  const list = join(directory, 'installed.json')
  if (!existsSync(list)) return []

  let names: unknown
  try {
    names = (JSON.parse(readFileSync(list, 'utf8')) as { packages?: unknown }).packages
  } catch {
    return []
  }
  if (!Array.isArray(names)) return []

  return names
    .filter((name): name is string => typeof name === 'string')
    .map((name) => join(directory, 'node_modules', name))
    .filter((root) => existsSync(join(root, 'package.json')))
}
