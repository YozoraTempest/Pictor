import { watch, type FSWatcher } from 'node:fs'

/**
 * Watches plugins for edits and asks the runtime to reload them.
 *
 * This is the app's half of hot reload. The other half is in `PluginContainer.reload`,
 * which unloads the fiber and loads the file again under a new URL — Node evaluates a
 * module once per URL, so a fresh URL is the only way to read edited code without
 * restarting.
 *
 * Why not dsh's HMR: `@deepseek-ai/cordis-plugin-hmr` needs `--expose-internals` to reach
 * Node's module loader. Electron refuses that flag in `NODE_OPTIONS` and swallows it on
 * the command line, so the package cannot start in this process at all. What is left is
 * the part that does not need internals: notice the file changed, drop the plugin, mount
 * it again.
 *
 * The honest cost: every reload leaves the previous module in memory, and anything the
 * old code started that was not registered through `ctx.effect` keeps running. That is
 * why this is a switch, and why turning it off is a restart away from clean.
 */
export interface PluginWatcherOptions {
  /** Milliseconds to wait for a burst of writes to settle. */
  debounceMs?: number
  /** Reloads one plugin; returns whether it came back up. */
  reload: (id: string) => Promise<void>
  /** Told when a reload fails, so the failure is not silent. */
  warn?: (message: string) => void
}

export class PluginWatcher {
  readonly #options: PluginWatcherOptions
  /** One watcher per plugin root; keyed by plugin id so two roots cannot collide. */
  readonly #watchers = new Map<string, { root: string; watcher: FSWatcher }>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  #closed = false

  constructor(options: PluginWatcherOptions) {
    this.#options = options
  }

  /** Starts watching one plugin's directory. Idempotent. */
  watch(id: string, root: string): void {
    if (this.#closed || this.#watchers.has(id)) return

    let watcher: FSWatcher
    try {
      // `recursive` is supported on every platform this app ships for. A directory that
      // vanished between discovery and now is not an error worth reporting: the plugin
      // will fail its next mount with a better message.
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        this.#schedule(id, filename)
      })
    } catch (error) {
      this.#options.warn?.(`监听 ${id} 失败：${messageOf(error)}`)
      return
    }

    watcher.on('error', (error) => this.#options.warn?.(`监听 ${id} 出错：${messageOf(error)}`))
    this.#watchers.set(id, { root, watcher })
  }

  /** Stops watching one plugin; used when it is uninstalled. */
  unwatch(id: string): void {
    const entry = this.#watchers.get(id)
    if (entry !== undefined) {
      entry.watcher.close()
      this.#watchers.delete(id)
    }
    const timer = this.#timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.#timers.delete(id)
    }
  }

  /** Closes every watcher. */
  close(): void {
    this.#closed = true
    for (const id of [...this.#watchers.keys()]) this.unwatch(id)
  }

  /** Ids currently watched, for the settings page and for tests. */
  watching(): string[] {
    return [...this.#watchers.keys()]
  }

  /**
   * Coalesces a burst of writes into one reload.
   *
   * Saving a file in an editor is rarely one event: a temp file appears, is renamed, the
   * original is rewritten. Reloading per event would mount a plugin three times and
   * register its contributions three times over.
   */
  #schedule(id: string, filename: string | Buffer | null): void {
    // `node_modules` inside a plugin is a dependency tree, not the plugin's own code:
    // an install there is not an edit to reload for. Everything else counts, including
    // a file the plugin writes for itself — cheap to reload, and confusing to ignore.
    const name = typeof filename === 'string' ? filename : null
    if (name !== null && name.split(/[\\/]/).includes('node_modules')) return

    const pending = this.#timers.get(id)
    if (pending !== undefined) clearTimeout(pending)
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id)
        void this.#run(id)
      }, this.#options.debounceMs ?? 120),
    )
  }

  async #run(id: string): Promise<void> {
    if (this.#closed) return
    try {
      await this.#options.reload(id)
    } catch (error) {
      // A reload that fails leaves the plugin unloaded: the new file is broken, and
      // running the old code would be pretending the edit worked.
      this.#options.warn?.(`重载 ${id} 失败：${messageOf(error)}`)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
