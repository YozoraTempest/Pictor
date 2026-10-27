/**
 * The contribution points, as cordis services.
 *
 * A plugin no longer calls `context.contribute(point, value)`. It asks the app for the
 * point it wants — `ctx.pictor.panels(...)` — and gets back a disposer, which cordis
 * runs when the plugin's fiber unloads. That is the whole difference from the old host:
 * the registration's lifetime is the plugin's lifetime, enforced by the container
 * instead of by a list this app keeps and has to remember to prune.
 *
 * One service (`pictor`) rather than seven, because a plugin that wants two points would
 * otherwise have to name five services it does not use, and every one of them would be
 * another reason the plugin refuses to start on a host that lacks one.
 */

import { PanelContributionError, parsePanelContribution, type PanelContribution } from './panels.js'
import { SkillContributionError, parseSkillContribution, type SkillContribution } from './skills.js'
import {
  ToolGuardContributionError,
  parseToolGuardContribution,
  type ToolGuardContribution,
} from './tool-guards.js'
import {
  ToolHookContributionError,
  parseToolHookContribution,
  type ToolHookContribution,
} from './tool-hooks.js'
import {
  ToolViewContributionError,
  parseToolViewContribution,
  type ToolViewContribution,
} from './tool-views.js'
import {
  SlotContributionError,
  parseSlotContribution,
  slotCellOf,
  type SlotContribution,
} from './slots.js'
import { ViewContributionError, parseViewContribution, type ViewContribution } from './views.js'

/** Every point a plugin may register, and what it holds. */
export interface ContributionMap {
  panels: PanelContribution
  views: ViewContribution
  toolGuards: ToolGuardContribution
  toolHooks: ToolHookContribution
  toolViews: ToolViewContribution
  skills: SkillContribution
  slots: SlotContribution
}

export type ContributionPoint = keyof ContributionMap

/**
 * One point's registrations.
 *
 * A duplicate key is refused rather than replacing: two plugins cannot both own
 * `acme.today`, and the second one asking is a mistake worth naming. The first keeps
 * working, because one plugin's bad id is not the other's failure.
 */
export class ContributionRegistry<T> {
  readonly #point: string
  readonly #keyOf: (value: T) => string
  readonly #parse: (raw: unknown) => T
  readonly #byKey = new Map<string, T>()
  /** Which plugin registered each contribution; a view uses it for its own directory. */
  readonly #owners = new WeakMap<object, string>()
  readonly #failures: string[] = []
  /** Told about every refusal, so the settings page can name a plugin that misbehaved. */
  readonly #warn: (message: string) => void

  constructor(options: {
    point: string
    keyOf: (value: T) => string
    parse: (raw: unknown) => T
    warn?: (message: string) => void
  }) {
    this.#point = options.point
    this.#keyOf = options.keyOf
    this.#parse = options.parse
    this.#warn = options.warn ?? ((): void => undefined)
  }

  /**
   * Validates and records one contribution; the returned function removes it.
   *
   * Validation throws rather than returning: a plugin whose payload does not fit the
   * contract has a bug, and a plugin that half-registers would be a page that half
   * works. The caller — cordis, usually through `ctx.effect` — decides whether that
   * takes the plugin down.
   */
  register(raw: unknown, owner?: string): () => void {
    const value = this.#parse(raw)
    const key = this.#keyOf(value)
    if (this.#byKey.has(key)) {
      const reason = `${this.#point}: ${key} is already registered`
      this.#failures.push(reason)
      this.#warn(reason)
      throw new Error(reason)
    }

    this.#byKey.set(key, value)
    if (owner !== undefined && typeof value === 'object' && value !== null) {
      this.#owners.set(value, owner)
    }
    return () => {
      // Only remove what this call put there: a later registration of the same key
      // would be a different contribution, and this disposer must not take it away.
      if (this.#byKey.get(key) === value) this.#byKey.delete(key)
    }
  }

  /** Register without a fiber — for the workbench's own, which never unloads. */
  adopt(raw: unknown): void {
    try {
      this.register(raw)
    } catch (error) {
      this.#warn(error instanceof Error ? error.message : String(error))
    }
  }

  list(): readonly T[] {
    return [...this.#byKey.values()]
  }

  get(key: string): T | undefined {
    return this.#byKey.get(key)
  }

  has(key: string): boolean {
    return this.#byKey.has(key)
  }

  /** The plugin a contribution came from, when the container recorded one. */
  ownerOf(value: T): string | null {
    if (typeof value !== 'object' || value === null) return null
    return this.#owners.get(value) ?? null
  }

  /** Everything refused so far, in the order the reasons arrived. */
  failures(): readonly string[] {
    return [...this.#failures]
  }
}

/**
 * What `ctx.pictor` is.
 *
 * Each member is a function you call with a contribution; the return value is the
 * disposer cordis will run. They are deliberately not `register()` methods: a plugin
 * author writes `ctx.effect(() => ctx.pictor.panels({ … }))`, and the shorter the call
 * the more obvious it is that the middle of that line is the plugin's own lifetime.
 */
export interface PictorContributions {
  /** A side-panel entry. It names the view it draws. */
  panels(value: unknown): () => void
  /** What a panel shows: blocks, not renderer code. */
  views(value: unknown): () => void
  /** Runs before a tool call; fails closed. */
  toolGuards(value: unknown): () => void
  /** Runs after a tool call; fails open. */
  toolHooks(value: unknown): () => void
  /** How a tool call is presented in the transcript. */
  toolViews(value: unknown): () => void
  /** A skill the runtime can load on demand; Pictor writes the file. */
  skills(value: unknown): () => void
  /**
   * A seat in the window, named with dsh's slot vocabulary.
   *
   * `slot` says where and `key` picks a cell inside a keyed or list slot; the content is
   * still a `views` id, so a seat holds a description rather than a component.
   */
  slots(value: unknown): () => void
}

export interface ContributionHostOptions {
  /** Told about every refused contribution. */
  warn?: (message: string) => void
  /**
   * The id a contribution belongs to, for diagnostics.
   *
   * Cordis knows which fiber is loading, but not which plugin package that fiber came
   * from; the container that mounted it does, and passes the answer here.
   */
  owner?: () => string
}

/** The registries behind `ctx.pictor`, in one object. */
export class ContributionHost {
  /**
   * The plugin whose `apply` is running.
   *
   * Cordis knows the fiber, but a contribution only needs to know whose directory it may
   * write to, and that is the package the container just mounted. Registration happens
   * synchronously inside `apply`, so a plain field is enough — and `withOwner` restores
   * the previous value rather than clearing it, so nesting stays honest.
   */
  #owner: string | null = null

  readonly panels: ContributionRegistry<PanelContribution>
  readonly views: ContributionRegistry<ViewContribution>
  readonly toolGuards: ContributionRegistry<ToolGuardContribution>
  readonly toolHooks: ContributionRegistry<ToolHookContribution>
  readonly toolViews: ContributionRegistry<ToolViewContribution>
  readonly skills: ContributionRegistry<SkillContribution>
  readonly slots: ContributionRegistry<SlotContribution>

  constructor(options: ContributionHostOptions = {}) {
    const warn = (message: string): void => {
      options.warn?.(options.owner === undefined ? message : `[${options.owner()}] ${message}`)
    }

    this.panels = new ContributionRegistry({
      point: 'panels',
      keyOf: (value) => value.id,
      parse: (raw) => parsePanelContribution(raw),
      warn,
    })
    this.views = new ContributionRegistry({
      point: 'views',
      keyOf: (value) => value.id,
      parse: (raw) => parseViewContribution(raw),
      warn,
    })
    this.toolGuards = new ContributionRegistry({
      point: 'toolGuards',
      keyOf: (value) => value.id,
      parse: (raw) => parseToolGuardContribution(raw),
      warn,
    })
    this.toolHooks = new ContributionRegistry({
      point: 'toolHooks',
      keyOf: (value) => value.id,
      parse: (raw) => parseToolHookContribution(raw),
      warn,
    })
    this.toolViews = new ContributionRegistry({
      point: 'toolViews',
      keyOf: (value) => value.id,
      parse: (raw) => parseToolViewContribution(raw),
      warn,
    })
    this.skills = new ContributionRegistry({
      point: 'skills',
      keyOf: (value) => value.name,
      parse: (raw) => parseSkillContribution(raw),
      warn,
    })
    this.slots = new ContributionRegistry({
      point: 'slots',
      // A seat is identified by where it sits, not by a name of its own: two plugins
      // asking for the same cell is the mistake worth refusing.
      keyOf: (value) => `${value.slot}:${slotCellOf(value)}`,
      parse: (raw) => parseSlotContribution(raw),
      warn,
    })
  }

  /** Runs `work` as `id`, so anything it registers knows whose it is. */
  withOwner<T>(id: string, work: () => T): T {
    const previous = this.#owner
    this.#owner = id
    try {
      return work()
    } finally {
      this.#owner = previous
    }
  }

  /** The service value `ctx.pictor` resolves to. */
  service(): PictorContributions {
    const owner = (): string | undefined => this.#owner ?? undefined
    return {
      panels: (value) => this.panels.register(value, owner()),
      views: (value) => this.views.register(value, owner()),
      toolGuards: (value) => this.toolGuards.register(value, owner()),
      toolHooks: (value) => this.toolHooks.register(value, owner()),
      toolViews: (value) => this.toolViews.register(value, owner()),
      skills: (value) => this.skills.register(value, owner()),
      slots: (value) => this.slots.register(value, owner()),
    }
  }

  /** Everything refused, across all points. */
  failures(): readonly string[] {
    return [
      ...this.panels.failures(),
      ...this.views.failures(),
      ...this.toolGuards.failures(),
      ...this.toolHooks.failures(),
      ...this.toolViews.failures(),
      ...this.skills.failures(),
      ...this.slots.failures(),
    ]
  }
}

/** The error types this module re-raises, keyed for callers that catch by class. */
export const CONTRIBUTION_ERRORS = {
  panel: PanelContributionError,
  view: ViewContributionError,
  toolGuard: ToolGuardContributionError,
  toolHook: ToolHookContributionError,
  toolView: ToolViewContributionError,
  skill: SkillContributionError,
  slot: SlotContributionError,
} as const
