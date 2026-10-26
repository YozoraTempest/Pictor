import {
  parsePanelContributions,
  parseSkillContributions,
  parseToolGuardContributions,
  parseToolHookContributions,
  parseToolViewContributions,
  parseViewContributions,
  type PanelContribution,
  type SkillContribution,
  type ToolGuardContribution,
  type ToolHookContribution,
  type ToolViewContribution,
} from '@pictor/plugin-sdk'
import type { PluginHost } from '@pictor/plugin-host'

import { PluginViews } from './plugin-views.js'

/**
 * What plugins contribute, derived from the host instead of frozen at launch.
 *
 * Every parse here used to happen once, at startup, into arrays the rest of the app kept
 * forever. That made installing a plugin a half-truth: its `activate()` ran, its
 * contributions were recorded, and nothing read them again — so a panel appeared only
 * after a restart, and a guard installed at runtime guarded nothing. The fix is to treat
 * the answer as a *projection* of the host: recomputed when the host says it changed,
 * remembered in between.
 *
 * One projection, not one per consumer, because the panels have to agree with the views
 * they render: a panel naming a view nobody contributed is dropped here, once, and the
 * launcher never offers a row that opens nothing.
 */
export interface PluginContributionsOptions {
  /** Where one plugin may keep files of its own, by plugin id. */
  dataDirectory: (pluginId: string) => string
  /** Told about every contribution that was refused. Called once per change, not per call. */
  warn?: (message: string) => void
}

export interface ContributionSet {
  /** Panel frames, in contribution order, each with a view behind it. */
  panels: readonly PanelContribution[]
  toolViews: readonly ToolViewContribution[]
  /** Run before a call; fail closed. */
  guards: readonly ToolGuardContribution[]
  /** Run after a call; fail open. */
  hooks: readonly ToolHookContribution[]
  /** Skills per plugin: the library writes their files, so it wants them parsed. */
  skills: ReadonlyMap<string, readonly SkillContribution[]>
  views: PluginViews
}

/**
 * Projects the host's contributions, remembering the last answer.
 *
 * The memo is keyed by `host.revision()`: contributions only change when a plugin is
 * activated or removed, and re-parsing on every tool call would repeat the same warnings
 * a thousand times a session.
 */
export class PluginContributions {
  readonly #host: PluginHost
  readonly #options: PluginContributionsOptions
  #cached: { revision: number; value: ContributionSet } | null = null

  constructor(host: PluginHost, options: PluginContributionsOptions) {
    this.#host = host
    this.#options = options
  }

  /** The current answer. Cheap after the first call following a change. */
  current(): ContributionSet {
    const revision = this.#host.revision()
    if (this.#cached !== null && this.#cached.revision === revision) return this.#cached.value

    const value = this.#project()
    this.#cached = { revision, value }
    return value
  }

  #warn(message: string): void {
    this.#options.warn?.(message)
  }

  #project(): ContributionSet {
    const parsedViews = parseViewContributions(this.#host.contributions('views'))
    for (const failure of parsedViews.failures) this.#warn(`view ignored: ${failure.reason}`)

    // Who to ask for a view's own directory. A view is handed its contributor's
    // directory, never one the caller named.
    const owners = new Map<string, string>()
    for (const { pluginId, value } of this.#host.contributionsWithSource('views')) {
      const id = (value as { id?: unknown } | null)?.id
      if (typeof id === 'string') owners.set(id, pluginId)
    }

    const views = new PluginViews(parsedViews.views, {
      dataDirectory: this.#options.dataDirectory,
    }).withOwners(owners)

    const parsedPanels = parsePanelContributions(this.#host.contributions('panels'))
    for (const failure of parsedPanels.failures) this.#warn(`panel ignored: ${failure.reason}`)
    const panels = parsedPanels.panels.filter((panel) => {
      if (views.has(panel.view)) return true
      this.#warn(`panel ignored: 没有名为 ${panel.view} 的视图（${panel.id}）`)
      return false
    })

    const parsedToolViews = parseToolViewContributions(this.#host.contributions('toolViews'))
    for (const failure of parsedToolViews.failures) {
      this.#warn(`tool view ignored: ${failure.reason}`)
    }

    const parsedGuards = parseToolGuardContributions(this.#host.contributions('toolGuards'))
    for (const failure of parsedGuards.failures) this.#warn(`tool guard ignored: ${failure.reason}`)

    const parsedHooks = parseToolHookContributions(this.#host.contributions('toolHooks'))
    for (const failure of parsedHooks.failures) this.#warn(`tool hook ignored: ${failure.reason}`)

    return {
      panels,
      toolViews: parsedToolViews.views,
      guards: parsedGuards.guards,
      hooks: parsedHooks.hooks,
      skills: this.#skills(),
      views,
    }
  }

  /** One plugin's skills fail together: a bad one is not a partial skill. */
  #skills(): ReadonlyMap<string, readonly SkillContribution[]> {
    const byPlugin = new Map<string, unknown[]>()
    for (const { pluginId, value } of this.#host.contributionsWithSource('skills')) {
      const values = byPlugin.get(pluginId) ?? []
      values.push(value)
      byPlugin.set(pluginId, values)
    }

    const parsed = new Map<string, readonly SkillContribution[]>()
    for (const [pluginId, values] of byPlugin) {
      const outcome = parseSkillContributions(values)
      for (const failure of outcome.failures) this.#warn(`skill ignored: ${failure.reason}`)
      parsed.set(pluginId, outcome.skills)
    }
    return parsed
  }
}
