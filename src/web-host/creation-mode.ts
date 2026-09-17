import { watch, type FSWatcher } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import type { PluginStore } from '../node/plugins/plugin-store.js'

const REGISTRY_FILE = 'plugin-registry.json'

export interface CreationModeWatcherOptions {
  readonly pluginStore: PluginStore
  readonly userDataDirectory: string
  readonly triggerPath: string
  readonly debounceMs?: number
}

export class CreationModeWatcher {
  private readonly sourceWatchers = new Map<string, FSWatcher>()
  private registryWatcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(private readonly options: CreationModeWatcherOptions) {}

  async start(): Promise<void> {
    if (this.registryWatcher) throw new Error('Creation Mode watcher has already started')
    await mkdir(this.options.userDataDirectory, { recursive: true })
    this.registryWatcher = watch(this.options.userDataDirectory, (_event, filename) => {
      if (String(filename ?? '') !== REGISTRY_FILE) return
      this.scheduleReload('Plugin Registry changed')
    })
    await this.watchDevelopmentPlugins()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.registryWatcher?.close()
    this.registryWatcher = null
    for (const watcher of this.sourceWatchers.values()) watcher.close()
    this.sourceWatchers.clear()
  }

  private async watchDevelopmentPlugins(): Promise<void> {
    const snapshot = await this.options.pluginStore.getSnapshot()
    for (const plugin of snapshot.plugins) {
      if (plugin.entry.source.kind !== 'development') continue
      const root = resolve(plugin.rootPath)
      if (this.sourceWatchers.has(root)) continue
      try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          const path = String(filename ?? '')
          if (isCreationModePluginOutput(path)) {
            this.scheduleReload(`${plugin.manifest.id} output changed`)
          }
        })
        watcher.on('error', (error) => {
          console.warn(`[creation-mode] stopped watching ${plugin.manifest.id}`, error)
          this.sourceWatchers.delete(root)
        })
        this.sourceWatchers.set(root, watcher)
      } catch (error) {
        console.warn(`[creation-mode] unable to watch ${plugin.manifest.id}`, error)
      }
    }
  }

  private scheduleReload(reason: string): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.requestReload(reason).catch((error) => {
        console.warn('[creation-mode] unable to request Web Host reload', error)
      })
    }, this.options.debounceMs ?? 220)
  }

  private async requestReload(reason: string): Promise<void> {
    if (this.stopped) return
    await mkdir(dirname(this.options.triggerPath), { recursive: true })
    await writeFile(this.options.triggerPath, `${new Date().toISOString()} ${reason}\n`, 'utf8')
    console.log(`[creation-mode] ${reason}; reloading Pictor Web Host`)
  }
}

export function isCreationModePluginOutput(path: string): boolean {
  const normalized = relative('.', path).replaceAll('\\', '/').replace(/^\.\//, '')
  return (
    normalized === 'manifest.json' ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('assets/') ||
    normalized.startsWith('pi/')
  )
}
