import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import {
  PluginContainer,
  PluginRootWatcher,
  PluginWatcher,
  discoverPlugins,
  expandPluginRoots,
  installedPackageRoots,
  type MountedPlugin,
} from '@pictor/plugin-host'
import {
  ContributionHost,
  type PanelContribution,
  type SlotContribution,
  type SlotKey,
  type SkillContribution,
  type ToolGuardContribution,
  type ToolHookContribution,
  type ToolViewContribution,
  type ViewContribution,
} from '@pictor/plugin-sdk'
import type { DiscoveredPlugin } from '@pictor/plugin-host'

import { FrameHost } from './frame-host.js'
import { PluginViews } from './plugin-views.js'
import type { SkillLibrary } from './skill-library.js'

export interface PluginRuntimeOptions {
  userData: string
  /** Where one plugin may keep files of its own, by plugin id. */
  dataDirectory?: (pluginId: string) => string
  /** Told about every plugin that could not start, and every refused contribution. */
  warn?: (message: string) => void
  /**
   * Reload a plugin when its files change.
   *
   * Off means an edit needs a restart; on means the plugin is unloaded and mounted
   * again, which is what this app can do without touching Node's module cache.
   */
  hotReload?: boolean
  /** Told after a plugin was reloaded, so the window can fetch its panels again. */
  onReload?: (id: string) => void
  /**
   * The directories plugins are kept in — parents, not plugins: `~/Pictor/plugins`, not
   * `~/Pictor/plugins/my-thing`. Read fresh on every reconcile.
   *
   * Absent means the mounted set only changes when the app asks it to, which is what a
   * caller that owns discovery itself wants.
   */
  pluginParents?: () => readonly string[]
  /** Told when a plugin appeared or vanished on disk, so the window can catch up. */
  onPluginsChanged?: () => void
  /**
   * Writes plugin skills to disk.
   *
   * A skill is a file the runtime scans, so the sync happens after every change to the
   * mounted set — which the container reports by resolving or rejecting, not on a timer.
   */
  skills?: SkillLibrary
}

/**
 * Plugins, in a cordis tree.
 *
 * This is the whole plugin runtime now: one `Context`, one `pictor` service the plugins
 * register through, and one container that mounts them. It replaced a host that imported
 * modules itself and a projection that re-derived the answers whenever a counter moved —
 * both of which existed because nothing owned the plugins' lifetimes. Cordis does, so
 * what is left here is assembly.
 *
 * The tree is shared with the kernel host, which is what makes `inject` mean the same
 * thing on both sides: a plugin can wait for `kernel.dsh`, and a kernel can read
 * `pictor.panels`, because they are services in one scope rather than two registries.
 */
export class PluginRuntime {
  readonly ctx: Context
  readonly contributions: ContributionHost
  readonly #container: PluginContainer
  readonly #watcher: PluginWatcher | null
  readonly #options: PluginRuntimeOptions
  /** Plugins turned off by the person; they are discovered but not mounted. */
  readonly #disabled = new Set<string>()
  /** Ids the person switched off before they were mounted, so `add` can honour it. */
  #appliedSkills = new Set<string>()
  /** Serves the files of views that ship a front end instead of a description. */
  readonly #frames = new FrameHost({ warn: (message) => this.#warn(message) })
  /** Notices a plugin directory appearing or going away under a plugin root. */
  readonly #rootWatcher: PluginRootWatcher | null
  /** Serialises reconciles: two of them interleaved would mount the same plugin twice. */
  #reconciling: Promise<void> = Promise.resolve()

  constructor(options: PluginRuntimeOptions) {
    this.#options = options
    this.ctx = new Context()
    this.contributions = new ContributionHost({
      warn: (message) => this.#warn(message),
    })
    this.#container = new PluginContainer({
      ctx: this.ctx,
      warn: (message) => this.#warn(message),
      // Which plugin is registering, for the directory its views may write to.
      withOwner: (id, work) => this.contributions.withOwner(id, work),
    })

    // One service, so a plugin that wants a panel and a tool view declares one need.
    this.ctx.provide('pictor', this.contributions.service())

    this.#watcher =
      options.hotReload === false
        ? null
        : new PluginWatcher({
            reload: async (id) => {
              await this.#container.reload(id)
              // Skills come from the file that just ran, so they follow it.
              this.syncSkills()
              this.#options.onReload?.(id)
            },
            warn: (message) => this.#warn(message),
          })

    // Same switch as the per-plugin watcher: one preference means "the plugin list follows
    // the disk", and splitting it into two would ask a person to reason about which half of
    // the same behaviour they want.
    this.#rootWatcher =
      options.hotReload === false || options.pluginParents === undefined
        ? null
        : new PluginRootWatcher({
            directories: () => [...(options.pluginParents?.() ?? [])],
            changed: () => void this.reconcile(),
            warn: (message) => this.#warn(message),
          })
  }

  /** Whether edits are being picked up without a restart. */
  get hotReload(): boolean {
    return this.#watcher !== null
  }

  /** Mounts everything that resolved, in dependency order; failures stay on the record. */
  async start(plugins: readonly DiscoveredPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      if (this.#disabled.has(plugin.id)) continue
      await this.add(plugin)
    }
    this.syncSkills()
    this.beginWatching()
  }

  /**
   * Starts noticing plugin directories appearing and going away.
   *
   * Separate from `start()` because the caller may mount plugins itself — the app filters
   * by the person's on/off choices before any of them are added, and calling `start()` with
   * that already-filtered list would mean mounting twice.
   */
  beginWatching(): void {
    this.#rootWatcher?.sync()
  }

  /**
   * Makes the mounted set match the directories again.
   *
   * Two questions, answered against one discovery pass: something appeared that is not
   * mounted (mount it), and something mounted is no longer on disk (unmount it). A plugin
   * the person switched off is left off — that is a decision, not a missing directory.
   *
   * Reconciles queue behind each other: a copy that produces twenty events must not mount
   * the same directory five times over.
   */
  reconcile(): Promise<void> {
    this.#reconciling = this.#reconciling.then(() => this.#reconcileNow()).catch(() => undefined)
    return this.#reconciling
  }

  async #reconcileNow(): Promise<void> {
    const parents = this.#options.pluginParents?.()
    if (parents === undefined) return

    // The same two sources discovery uses at startup: folders beside `installed.json`, and
    // packages named by it. Asking either one alone would drop half the plugin list.
    const roots = [
      ...expandPluginRoots([...parents]),
      ...parents.flatMap((parent) => installedPackageRoots(parent)),
    ]
    const mounted = new Map(this.#container.list().map((plugin) => [plugin.id, plugin]))
    let changed = false

    for (const plugin of discoverPlugins(roots).plugins) {
      if (mounted.has(plugin.id) || this.#disabled.has(plugin.id)) continue
      await this.add(plugin)
      changed = true
    }

    for (const plugin of mounted.values()) {
      if (existsSync(plugin.root)) continue
      await this.#unmountGone(plugin.id)
      changed = true
    }

    if (!changed) return
    this.syncSkills()
    this.#rootWatcher?.sync()
    this.#options.onPluginsChanged?.()
  }

  /**
   * Unmounts a plugin whose directory vanished.
   *
   * Deliberately not `remove()`: that records the person's decision to switch the plugin
   * off, and a deleted directory is not a decision. Left as is, putting the folder back
   * would bring the plugin back.
   */
  async #unmountGone(id: string): Promise<void> {
    this.#watcher?.unwatch(id)
    try {
      await this.#container.unmount(id)
      this.#warn(`插件目录不在了，已卸载：${id}`)
    } catch (error) {
      this.#warn(`卸载 ${id} 失败：${messageOf(error)}`)
    }
  }

  /** Mounts one plugin. A failure is reported and does not stop the others. */
  async add(plugin: DiscoveredPlugin): Promise<void> {
    this.#disabled.delete(plugin.id)
    try {
      const mounted = await this.#container.mount(plugin)
      this.#watcher?.watch(plugin.id, mounted.root)
    } catch (error) {
      this.#warn(messageOf(error))
    }
    this.syncSkills()
  }

  /** Unmounts one plugin: cordis runs its disposers, so its contributions go with it. */
  async remove(id: string): Promise<void> {
    this.#disabled.add(id)
    this.#watcher?.unwatch(id)
    await this.#container.unmount(id)
    this.syncSkills()
  }

  /** Stops watching everything, and stops answering frame URLs; called when the app closes. */
  dispose(): void {
    this.#watcher?.close()
    this.#rootWatcher?.close()
    void this.#frames.close()
  }

  /** The server a frame view's files are served from. */
  frames(): FrameHost {
    return this.#frames
  }

  /** The directory a plugin was installed into, which is what a frame may read. */
  #rootOf(pluginId: string): string | null {
    return this.#container.list().find((plugin) => plugin.id === pluginId)?.root ?? null
  }

  /** Whether the person has this plugin on. */
  isEnabled(id: string): boolean {
    return !this.#disabled.has(id)
  }

  mounted(): MountedPlugin[] {
    return this.#container.list()
  }

  /** Everything refused so far: bad payloads, failed imports, missing entries. */
  failures(): readonly string[] {
    return [
      ...this.#container.failures().map((failure) => failure.reason),
      ...this.contributions.failures(),
    ]
  }

  /**
   * What the window's About page shows.
   *
   * `skipped` means *waiting*: a plugin whose `inject` names a service this host does not
   * provide is mounted and will start the moment that service exists, so calling it a
   * failure would be wrong, and calling it active would be a lie.
   */
  report(): {
    activated: string[]
    skipped: string[]
    failures: Array<{ source: string; reason: string }>
  } {
    const mounted = this.#container.list()
    return {
      activated: mounted.filter((plugin) => plugin.state === 'active').map((plugin) => plugin.id),
      skipped: mounted.filter((plugin) => plugin.state !== 'active').map((plugin) => plugin.id),
      failures: [
        ...this.#container.failures(),
        ...this.contributions.failures().map((reason) => ({ source: 'plugin', reason })),
      ],
    }
  }

  /** Which plugin registered one contribution, across every point. */
  ownerFor(value: object): string | null {
    return (
      this.contributions.panels.ownerOf(value as never) ??
      this.contributions.views.ownerOf(value as never) ??
      this.contributions.toolGuards.ownerOf(value as never) ??
      this.contributions.toolHooks.ownerOf(value as never) ??
      this.contributions.toolViews.ownerOf(value as never) ??
      this.contributions.skills.ownerOf(value as never)
    )
  }

  // ---- what the rest of the app reads -------------------------------------------

  /**
   * Panel frames, minus the ones with nothing behind them.
   *
   * A panel names the view it draws; a panel whose view nobody registered would be a row
   * that opens nothing, so it is dropped here — at the one place both answers are known.
   */
  panels(): readonly PanelContribution[] {
    return this.contributions.panels
      .list()
      .filter((panel) => this.contributions.views.has(panel.view))
  }

  toolViews(): readonly ToolViewContribution[] {
    return this.contributions.toolViews.list()
  }

  guards(): readonly ToolGuardContribution[] {
    return this.contributions.toolGuards.list()
  }

  hooks(): readonly ToolHookContribution[] {
    return this.contributions.toolHooks.list()
  }

  views(): readonly ViewContribution[] {
    return this.contributions.views.list()
  }

  /**
   * The seats a plugin took, for one slot.
   *
   * A seat whose view nobody registered is dropped here, for the same reason a panel is:
   * rendering it would draw an empty frame with a title, and the person cannot tell that
   * from a plugin with nothing to say.
   */
  slots(key: SlotKey): readonly SlotContribution[] {
    return this.contributions.slots
      .list()
      .filter((seat) => seat.slot === key && this.contributions.views.has(seat.view))
  }

  /** Every seat, grouped by slot — what the window asks for once per refresh. */
  allSlots(): readonly SlotContribution[] {
    return this.contributions.slots.list().filter((seat) => this.contributions.views.has(seat.view))
  }

  /** Skills per plugin, for the library that writes their files. */
  skillsByPlugin(): Map<string, readonly SkillContribution[]> {
    const byPlugin = new Map<string, SkillContribution[]>()
    const registry = this.contributions.skills
    for (const skill of registry.list()) {
      const owner = registry.ownerOf(skill) ?? 'unknown'
      const list = byPlugin.get(owner) ?? []
      list.push(skill)
      byPlugin.set(owner, list)
    }
    return byPlugin
  }

  /** A view runner whose directories are the contributing plugin's own. */
  viewRunner(): PluginViews {
    const owners = new Map<string, string>()
    for (const view of this.contributions.views.list()) {
      const owner = this.contributions.views.ownerOf(view)
      if (owner !== null) owners.set(view.id, owner)
    }
    return new PluginViews(this.contributions.views.list(), {
      dataDirectory:
        this.#options.dataDirectory ??
        ((pluginId) => join(this.#options.userData, 'plugin-data', pluginId)),
      pluginRoot: (pluginId) => this.#rootOf(pluginId),
      frames: this.#frames,
    }).withOwners(owners)
  }

  /**
   * Rewrites every plugin's skills, and removes those of a plugin that stopped
   * contributing.
   *
   * Called after each mount change instead of on a timer: the file has to exist before
   * the runtime next scans, and it has to be gone when the plugin is.
   */
  syncSkills(): void {
    const library = this.#options.skills
    if (library === undefined) return

    const wanted = this.skillsByPlugin()
    for (const [pluginId, list] of wanted) library.syncPlugin(pluginId, list)
    for (const pluginId of this.#appliedSkills) {
      if (!wanted.has(pluginId)) library.clearPlugin(pluginId)
    }
    this.#appliedSkills = new Set(wanted.keys())
  }

  /** Packages installed as packages, which live in `node_modules` rather than beside it. */
  packageRoots(directory: string): string[] {
    return installedPackageRoots(directory)
  }

  #warn(message: string): void {
    this.#options.warn?.(message)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
