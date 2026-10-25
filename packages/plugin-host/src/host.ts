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

    const entry = join(plugin.root, plugin.manifest.main)
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

        const dispose = (): void => {
          const current = this.#contributions.get(point)
          if (current === undefined) return
          const index = current.indexOf(entry)
          if (index >= 0) current.splice(index, 1)
        }
        record.disposers.push(dispose)
        return dispose
      },
    }

    this.#active.push(record)
    await module.activate(context)
  }
}
