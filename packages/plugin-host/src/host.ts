import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PluginContext, PluginLogger, PluginModule } from '@pictor/plugin-sdk'

import type { DiscoveredPlugin, PluginFailure } from './registry.js'

export interface PluginHostOptions {
  plugins: DiscoveredPlugin[]
  /** Version of the running application, checked against `engines.pictor`. */
  pictorVersion: string
  dataRoot: string
  logger?: PluginLogger
  /** Returning false skips a plugin without reporting a failure. */
  isEnabled?: (id: string, source: 'bundled' | 'user') => boolean
}

export interface PluginHostReport {
  activated: string[]
  skipped: string[]
  failures: PluginFailure[]
}

const silentLogger: PluginLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

interface ActivePlugin {
  id: string
  module: PluginModule
  disposers: Array<() => void>
}

/**
 * Loads plugin modules into the host process.
 *
 * Contract: a plugin that throws during import or activation is recorded as a
 * failure and unloaded, while every other plugin still starts. Deactivation
 * runs in reverse activation order.
 */
export class PluginHost {
  readonly #options: PluginHostOptions
  readonly #logger: PluginLogger
  /** Contributions by point, each tagged with the plugin that made it. */
  readonly #contributions = new Map<string, Array<{ pluginId: string; value: unknown }>>()
  readonly #active: ActivePlugin[] = []
  readonly #failures: PluginFailure[] = []
  readonly #activated: string[] = []
  readonly #skipped: string[] = []
  /**
   * Bumped whenever what the host holds changes.
   *
   * Whoever derives something from the contributions — the panel list, the tool
   * presenters, the guards — compares this number instead of re-reading on every call:
   * installing a plugin at runtime has to change the answer, and doing that work once
   * per change is cheaper than doing it per question.
   */
  #revision = 0

  constructor(options: PluginHostOptions) {
    this.#options = options
    this.#logger = options.logger ?? silentLogger
  }

  async start(plugins: DiscoveredPlugin[]): Promise<PluginHostReport> {
    for (const plugin of plugins) {
      const enabled = this.#options.isEnabled?.(plugin.id, 'user') ?? true
      if (!enabled) {
        this.#skipped.push(plugin.id)
        continue
      }

      // A plugin that only contributes a kernel has no module to activate here; the
      // kernel host mounts that half. Skipping is not a failure: it is the shape.
      if (plugin.manifest.main === undefined) {
        this.#skipped.push(plugin.id)
        continue
      }

      try {
        await this.#activate(plugin)
        this.#activated.push(plugin.id)
      } catch (error) {
        this.#failures.push({ source: plugin.root, reason: (error as Error).message })
        this.#logger.error(`plugin failed to activate: ${plugin.id}`, error)
      }
    }

    return this.report()
  }

  /**
   * Activates one plugin that arrived while the app was running.
   *
   * Installing must not need a restart: the contributions a plugin makes are the same
   * whether it was on disk at launch or copied in a minute ago. A plugin with no UI
   * entry is skipped here — its kernel half is mounted by the kernel host.
   */
  async add(plugin: DiscoveredPlugin): Promise<PluginHostReport> {
    const enabled = this.#options.isEnabled?.(plugin.id, 'user') ?? true
    if (!enabled || plugin.manifest.main === undefined) {
      if (!this.#skipped.includes(plugin.id)) this.#skipped.push(plugin.id)
      return this.report()
    }
    if (this.#activated.includes(plugin.id)) return this.report()

    try {
      await this.#activate(plugin)
      this.#activated.push(plugin.id)
    } catch (error) {
      this.#failures.push({ source: plugin.root, reason: (error as Error).message })
      this.#logger.error(`plugin failed to activate: ${plugin.id}`, error)
    }
    return this.report()
  }

  /** Removes one plugin and everything it contributed, leaving the rest running. */
  async remove(id: string): Promise<void> {
    const index = this.#active.findIndex((plugin) => plugin.id === id)
    // Nothing to unmount: it never activated, so it contributed nothing either.
    if (index < 0) return

    const plugin = this.#active[index] as ActivePlugin
    this.#active.splice(index, 1)
    for (const dispose of [...plugin.disposers].reverse()) {
      try {
        dispose()
      } catch (error) {
        this.#logger.warn(`contribution disposal failed for ${plugin.id}: ${String(error)}`)
      }
    }
    try {
      await plugin.module.deactivate?.()
    } catch (error) {
      this.#logger.warn(`plugin deactivate failed: ${plugin.id}: ${String(error)}`)
    }

    const at = this.#activated.indexOf(id)
    if (at >= 0) this.#activated.splice(at, 1)
  }

  async stop(): Promise<void> {
    for (const plugin of [...this.#active].reverse()) {
      for (const dispose of [...plugin.disposers].reverse()) {
        try {
          dispose()
        } catch (error) {
          this.#logger.warn(`contribution disposal failed for ${plugin.id}: ${String(error)}`)
        }
      }

      try {
        await plugin.module.deactivate?.()
      } catch (error) {
        this.#logger.warn(`plugin deactivate failed: ${plugin.id}: ${String(error)}`)
      }
    }

    this.#active.length = 0
  }
  /** Identifies the current set of contributions; equal numbers mean an equal answer. */
  revision(): number {
    return this.#revision
  }

  contributions(point: string): unknown[] {
    return (this.#contributions.get(point) ?? []).map((entry) => entry.value)
  }

  /**
   * The same contributions, still tagged with their plugin.
   *
   * A registration product — a skill written to disk, say — has to be undone when
   * its plugin goes away, so the host has to know who contributed what.
   */
  contributionsWithSource(point: string): Array<{ pluginId: string; value: unknown }> {
    return [...(this.#contributions.get(point) ?? [])]
  }

  failures(): PluginFailure[] {
    return [...this.#failures]
  }

  report(): PluginHostReport {
    return {
      activated: [...this.#activated],
      skipped: [...this.#skipped],
      failures: this.failures(),
    }
  }

  async #activate(plugin: DiscoveredPlugin): Promise<void> {
    const dataDirectory = join(this.#options.dataRoot, plugin.id)
    mkdirSync(dataDirectory, { recursive: true })

    const main = plugin.manifest.main
    if (main === undefined) throw new Error(`plugin ${plugin.id} has no module to activate`)
    const entry = join(plugin.root, main)
    const loaded = (await import(pathToFileURL(entry).href)) as {
      default?: PluginModule
      activate?: PluginModule['activate']
    }

    const module: PluginModule =
      loaded.default ??
      (loaded.activate === undefined
        ? (() => {
            throw new Error(`plugin ${plugin.id} has no default export or activate()`)
          })()
        : { activate: loaded.activate })

    const record: ActivePlugin = { id: plugin.id, module, disposers: [] }

    const context: PluginContext = {
      pluginId: plugin.id,
      pluginRoot: plugin.root,
      dataDirectory,
      logger: this.#logger,
      contribute: (point, value) => {
        const values = this.#contributions.get(point) ?? []
        const entry = { pluginId: plugin.id, value }
        values.push(entry)
        this.#contributions.set(point, values)
        this.#revision += 1

        const dispose = (): void => {
          const current = this.#contributions.get(point)
          if (current === undefined) return
          const index = current.indexOf(entry)
          if (index >= 0) {
            current.splice(index, 1)
            this.#revision += 1
          }
        }
        record.disposers.push(dispose)
        return dispose
      },
    }

    this.#active.push(record)
    await module.activate(context)
  }
}
