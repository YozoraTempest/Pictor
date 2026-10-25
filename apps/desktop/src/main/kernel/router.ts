import type { HarnessNotification } from '@pictor/harness'
import type {
  CatalogSkill,
  ChatAnswer,
  ChatHistoryPage,
  ChatImage,
  ForkPoint,
  ModelEffort,
} from '@pictor/shared'

import type {
  HarnessStatus,
  KernelCapabilities,
  KernelInfo,
  KernelModelState,
  PermissionMode,
} from '../../shared/bridge.js'
import type { AgentProbeResult, KernelDriver } from './driver.js'
import { isModelSource } from './model-source.js'

export type { KernelInfo }

/** A conversation belongs to exactly one kernel, so it has to be looked up. */
export interface KernelLookup {
  /** Which kernel runs this conversation. */
  kernelOf: (sessionId: string) => Promise<string | null>
}

export interface KernelRouterOptions {
  /** Every kernel this build can drive, by id. The first one is the default. */
  drivers: ReadonlyMap<string, KernelDriver>
  /** Which kernel a conversation belongs to; falls back to the default. */
  lookup: KernelLookup
  /** Human name per kernel id, for the picker. */
  labels?: Readonly<Record<string, string>>
}

/**
 * Sends each call to the kernel that owns the conversation.
 *
 * Conversations name their kernel; everything else in the app talks to this
 * router and never to a driver. That is what lets a second kernel exist without
 * every call site learning about it: the ones that carry a session id are routed,
 * and the ones that do not (start, stop, install, status) go to the default,
 * because a process is still one process.
 *
 * A conversation whose kernel is missing from this build is not silently handed
 * to another one — that would run the same history somewhere it never happened.
 * The call fails instead, and the reason names the missing kernel.
 */
export class KernelRouter implements KernelDriver {
  readonly #options: KernelRouterOptions
  readonly #fallback: KernelDriver

  constructor(options: KernelRouterOptions) {
    const first = options.drivers.values().next()
    if (first.done === true) throw new Error('至少需要一个内核')
    this.#options = options
    this.#fallback = first.value
  }

  /** The kernel everything without a session id goes to. */
  get id(): string {
    return this.#fallback.id
  }

  /** Lifecycle is the default kernel's, so its capabilities are the router's. */
  get capabilities(): KernelCapabilities {
    return this.#fallback.capabilities
  }

  /** Every kernel, for the picker; `available` is the driver's own answer. */
  list(): KernelInfo[] {
    return [...this.#options.drivers.entries()].map(([id, driver]) => ({
      id,
      label: this.#options.labels?.[id] ?? id,
      default: id === this.#fallback.id,
      available: driver.status().binary !== null,
      // What this kernel can actually do travels with it: the window hides the
      // controls a kernel cannot answer instead of letting them fail on use.
      capabilities: driver.capabilities,
      // Whose model list the picker should show: Pictor's, the kernel's own, or none.
      modelSource: isModelSource(driver) ? 'kernel' : driver.capabilities.model ? 'pictor' : null,
    }))
  }

  async #for(sessionId: string): Promise<KernelDriver> {
    const wanted = await this.#options.lookup.kernelOf(sessionId)
    if (wanted === null) return this.#fallback
    const driver = this.#options.drivers.get(wanted)
    if (driver === undefined) {
      throw new Error(`这个会话使用的内核「${wanted}」不在当前版本里，无法继续`)
    }
    return driver
  }

  // ---- lifecycle: no session id, so the default kernel owns it --------------

  start(cwd: string): Promise<HarnessStatus> {
    return this.#fallback.start(cwd)
  }

  stop(): Promise<HarnessStatus> {
    return this.#fallback.stop()
  }

  status(): HarnessStatus {
    return this.#fallback.status()
  }

  install(): Promise<HarnessStatus> {
    return this.#fallback.install()
  }

  setPermissionMode(mode: PermissionMode): void {
    this.#fallback.setPermissionMode(mode)
  }

  applyPermission(mode: PermissionMode): Promise<void> {
    return this.#fallback.applyPermission(mode)
  }

  applySettings(): Promise<void> {
    return this.#fallback.applySettings()
  }

  probe(prompt: string, cwd: string): Promise<AgentProbeResult> {
    return this.#fallback.probe(prompt, cwd)
  }

  /** Notifications from every kernel go to the same listener. */
  onNotification(listener: (notification: HarnessNotification) => void): () => void {
    const disposers = [...this.#options.drivers.values()].map((driver) =>
      driver.onNotification(listener),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  // ---- conversation-scoped: routed -----------------------------------------

  async prompt(
    sessionId: string,
    text: string,
    images?: readonly ChatImage[],
    effort?: ModelEffort | null,
  ): Promise<void> {
    return (await this.#for(sessionId)).prompt(sessionId, text, images, effort)
  }

  async cancel(sessionId: string): Promise<void> {
    return (await this.#for(sessionId)).cancel(sessionId)
  }

  async fork(sessionId: string, at?: ForkPoint): Promise<string> {
    return (await this.#for(sessionId)).fork(sessionId, at)
  }

  async adopt(sessionId: string, kernelSessionId: string): Promise<void> {
    return (await this.#for(sessionId)).adopt(sessionId, kernelSessionId)
  }

  async openHistory(sessionId: string): Promise<ChatHistoryPage> {
    return (await this.#for(sessionId)).openHistory(sessionId)
  }

  async historyPage(sessionId: string, limit: number, offset: number): Promise<ChatHistoryPage> {
    return (await this.#for(sessionId)).historyPage(sessionId, limit, offset)
  }

  async sessionPermission(sessionId: string): Promise<string | null> {
    return (await this.#for(sessionId)).sessionPermission(sessionId)
  }

  async setSessionPermission(sessionId: string, mode: PermissionMode): Promise<void> {
    return (await this.#for(sessionId)).setSessionPermission(sessionId, mode)
  }

  async projectRootFor(sessionId: string): Promise<string | null> {
    return (await this.#for(sessionId)).projectRootFor(sessionId)
  }

  /** The models the conversation's kernel offers, in its own words. */
  async kernelModels(sessionId: string): Promise<KernelModelState> {
    const driver = await this.#for(sessionId)
    if (!isModelSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」不提供自己的模型列表`)
    }
    return driver.models(sessionId)
  }

  async selectKernelModel(sessionId: string, id: string): Promise<void> {
    const driver = await this.#for(sessionId)
    if (!isModelSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」不提供自己的模型列表`)
    }
    return driver.selectModel(sessionId, id)
  }

  async selectKernelEffort(sessionId: string, effort: ModelEffort | null): Promise<void> {
    const driver = await this.#for(sessionId)
    if (!isModelSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」不提供自己的思考档位`)
    }
    return driver.setEffort(sessionId, effort)
  }

  async listSkills(sessionId: string): Promise<CatalogSkill[]> {
    return (await this.#for(sessionId)).listSkills(sessionId)
  }

  /**
   * An approval answers an event, not a conversation.
   *
   * The event ids are minted by one kernel, and only that kernel can settle it,
   * so every driver is asked. A CLI kernel holds no approval at all and throws;
   * the answer then belongs to the one that does.
   */
  async answerApproval(eventId: string, allow: boolean): Promise<void> {
    return this.#dispatchByEvent('answerApproval', (driver) =>
      driver.answerApproval(eventId, allow),
    )
  }

  async answerQuestions(eventId: string, answers: readonly ChatAnswer[] | null): Promise<void> {
    return this.#dispatchByEvent('answerQuestions', (driver) =>
      driver.answerQuestions(eventId, answers),
    )
  }

  async #dispatchByEvent(
    label: string,
    run: (driver: KernelDriver) => Promise<void>,
  ): Promise<void> {
    const failures: string[] = []
    for (const driver of this.#options.drivers.values()) {
      try {
        await run(driver)
        return
      } catch (error) {
        failures.push(`${driver.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`没有内核接受这次${label}：${failures.join(' / ')}`)
  }
}
