import type { HarnessNotification } from '@pictor/harness'
import type {
  ApprovalMode,
  CatalogSkill,
  ChatAnswer,
  ChatHistoryPage,
  ChatImage,
  ChatJob,
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
import {
  isApprovalSource,
  isCommandSource,
  type KernelApprovalSource,
  type KernelCommand,
} from '@pictor/kernel-sdk'
import type { AgentProbeResult, KernelDriver } from '@pictor/kernel-sdk'
import { isCatalogueSource, isModelSource } from '@pictor/kernel-sdk'
import { isSettingsSource } from '@pictor/kernel-sdk'

export type { KernelInfo }

/** A conversation belongs to exactly one kernel, so it has to be looked up. */
export interface KernelLookup {
  /** Which kernel runs this conversation. */
  kernelOf: (sessionId: string) => Promise<string | null>
}

export interface KernelRouterOptions {
  /** Every kernel this build can drive, by id. The first one is the default. */
  drivers: ReadonlyMap<string, KernelDriver>
  /**
   * Which kernel new conversations start on.
   *
   * A person's choice, not a build fact: the default used to be "whichever loaded
   * first", which made the built-in kernel impossible to replace. A name that is not
   * among `drivers` is ignored -- the kernel may simply not be installed here.
   */
  defaultKernel?: string | null
  /** Which kernel a conversation belongs to; falls back to the default. */
  lookup: KernelLookup
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
  /**
   * The kernel everything without a conversation goes to.
   *
   * Null when this machine has no kernel at all, which is a real state: a person may
   * have turned off the built-in one before installing another. The app still opens,
   * and every call that needs a kernel says so instead of pretending.
   */
  #fallback: KernelDriver | null

  constructor(options: KernelRouterOptions) {
    this.#options = options
    this.#fallback = pickDefault(options.drivers, options.defaultKernel ?? null)
  }

  /**
   * Points new conversations at another kernel.
   *
   * Only the default changes: conversations already created keep the kernel that ran
   * them, which is why this is not a "switch" but a choice of where the next one
   * starts.
   */
  /**
   * Points new conversations at another kernel.
   *
   * Only the default changes: conversations already created keep the kernel that ran
   * them, which is why this is not a "switch" but a choice of where the next one
   * starts. An unknown id changes nothing.
   */
  setDefault(id: string): boolean {
    const chosen = this.#options.drivers.get(id)
    if (chosen === undefined) return false
    this.#fallback = chosen
    return true
  }

  /**
   * Re-picks the default after a kernel was mounted or unmounted.
   *
   * Turning off the kernel new conversations started on would otherwise leave the
   * router pointing at a driver that no longer has a service — every call would fail
   * with "this kernel is missing" even though another one is right there.
   */
  refreshDefault(): void {
    if (this.#fallback !== null && this.#options.drivers.has(this.#fallback.id)) return
    this.#fallback = this.#options.drivers.values().next().value ?? null
  }

  /** The default kernel, or the reason there is nothing to answer with. */
  #require(): KernelDriver {
    if (this.#fallback === null) {
      throw new Error('这台机器上没有可用的内核；先到「设置 › 通用 › 插件」装一个')
    }
    return this.#fallback
  }

  /**
   * Settings the mounted kernels declare, in a shape the window can draw.
   *
   * The page renders what it is handed: a kernel with a knob of its own describes it,
   * and no other file needs to know that kernel exists.
   */
  settings(): Array<{
    kernel: string
    key: string
    label: string
    description: string
    hint: string
    value: boolean
  }> {
    const found: ReturnType<KernelRouter['settings']> = []
    for (const [id, driver] of this.#options.drivers) {
      if (!isSettingsSource(driver)) continue
      for (const setting of driver.settings()) {
        found.push({
          kernel: id,
          key: setting.key,
          label: setting.label,
          description: setting.description,
          hint: setting.hint(),
          value: setting.read(),
        })
      }
    }
    return found
  }

  /**
   * Writes one declared setting to the kernel that owns the key.
   *
   * Awaitable because the kernel also persists it: false means no mounted kernel
   * declared that key, which the window shows instead of pretending it stuck.
   */
  async setKernelSetting(key: string, value: boolean): Promise<boolean> {
    for (const driver of this.#options.drivers.values()) {
      if (!isSettingsSource(driver)) continue
      const setting = driver.settings().find((entry) => entry.key === key)
      if (setting === undefined) continue
      await setting.write(value)
      return true
    }
    return false
  }

  /** Tells every kernel that keeps a catalogue to forget it. */
  invalidateCatalogues(): void {
    for (const driver of this.#options.drivers.values()) {
      if (isCatalogueSource(driver)) driver.invalidateCatalogue()
    }
  }

  /** The kernel everything without a session id goes to. */
  get id(): string {
    return this.#fallback?.id ?? ''
  }

  /** Lifecycle, name and capabilities are all the default kernel's. */
  get label(): string {
    return this.#fallback?.label ?? '没有内核'
  }

  /** Lifecycle is the default kernel's, so its capabilities are the router's. */
  get capabilities(): KernelCapabilities {
    return this.#fallback?.capabilities ?? NO_CAPABILITIES
  }

  /**
   * State of the kernel running `sessionId`.
   *
   * Lifecycle used to belong to one process, so `status()` answering for the default
   * kernel was enough. An installed kernel has its own state, and asking the wrong
   * one either refuses a turn that could run or starts one that cannot.
   */
  async statusOf(sessionId: string): Promise<HarnessStatus> {
    return (await this.#for(sessionId)).status()
  }

  /** Every kernel, for the picker; `available` is the driver's own answer. */
  list(): KernelInfo[] {
    return [...this.#options.drivers.entries()].map(([id, driver]) => ({
      id,
      label: driver.label,
      default: id === this.#fallback?.id,
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
    if (wanted === null) return this.#require()
    const driver = this.#options.drivers.get(wanted)
    if (driver === undefined) {
      throw new Error(`这个会话使用的内核「${wanted}」不在当前版本里，无法继续`)
    }
    return driver
  }

  // ---- lifecycle: no session id, so the default kernel owns it --------------

  start(cwd: string): Promise<HarnessStatus> {
    return this.#require().start(cwd)
  }

  stop(): Promise<HarnessStatus> {
    return this.#require().stop()
  }

  status(): HarnessStatus {
    if (this.#fallback === null) return noKernelStatus()
    return this.#fallback.status()
  }

  /**
   * Every kernel's own status, in its own words.
   *
   * `status()` answers for the default kernel, which is what the composer's "is a
   * run possible" checks need. A settings page has to show all of them: one kernel
   * may be a server this app boots, another a CLI that gets spawned per conversation,
   * and a page that described only the first would be wrong about the second.
   */
  statuses(): Record<string, HarnessStatus> {
    return Object.fromEntries(
      [...this.#options.drivers.entries()].map(([id, driver]) => [id, driver.status()]),
    )
  }

  install(): Promise<HarnessStatus> {
    return this.#require().install()
  }

  setPermissionMode(mode: PermissionMode): void {
    this.#require().setPermissionMode(mode)
  }

  applyPermission(mode: PermissionMode): Promise<void> {
    return this.#require().applyPermission(mode)
  }

  applySettings(): Promise<void> {
    return this.#require().applySettings()
  }

  probe(prompt: string, cwd: string): Promise<AgentProbeResult> {
    return this.#require().probe(prompt, cwd)
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

  /** When this conversation's calls wait for a person, in the kernel's own terms. */
  async kernelApproval(sessionId: string): Promise<ApprovalMode> {
    const driver = await this.#for(sessionId)
    if (!isApprovalSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」自己决定何时问人`)
    }
    return driver.approvalMode(sessionId)
  }

  async selectKernelApproval(sessionId: string, mode: ApprovalMode): Promise<void> {
    const driver = await this.#for(sessionId)
    if (!isApprovalSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」自己决定何时问人`)
    }
    driver.setApprovalMode(sessionId, mode)
  }

  /**
   * The approval mode the guard should apply to one conversation.
   *
   * `never` when the kernel decides for itself — its own policy already decided to
   * hold the call, so applying a second mode here would ask twice — and `never` when
   * this build no longer has that kernel. A tool rule still applies either way.
   *
   * This is the question the guard asks; it is not the settings page's question,
   * which is why it answers instead of throwing.
   */
  async guardApprovalMode(sessionId: string): Promise<ApprovalMode> {
    const source = await this.#approvalSource(sessionId)
    return source === null ? 'never' : source.approvalMode(sessionId)
  }

  /** Whether this conversation already allowed one tool, in its own kernel's terms. */
  async guardIsGranted(sessionId: string, tool: string): Promise<boolean> {
    const source = await this.#approvalSource(sessionId)
    return source === null ? false : source.isGranted(sessionId, tool)
  }

  /** The kernel that owns this conversation and hands approval decisions to us. */
  async #approvalSource(sessionId: string): Promise<(KernelDriver & KernelApprovalSource) | null> {
    const wanted = await this.#options.lookup.kernelOf(sessionId)
    const driver = wanted === null ? this.#fallback : (this.#options.drivers.get(wanted) ?? null)
    return driver !== null && isApprovalSource(driver) ? driver : null
  }

  /**
   * The slash commands this conversation's kernel offers.
   *
   * Empty when the kernel has none — a kernel that runs whatever it was configured
   * with has nothing to switch, and an empty menu is a truthful answer.
   */
  async kernelCommands(sessionId: string): Promise<KernelCommand[]> {
    const driver = await this.#for(sessionId)
    if (!isCommandSource(driver)) return []
    return driver.commands(sessionId)
  }

  /** Runs one complete slash line on the kernel that owns the conversation. */
  async runKernelCommand(sessionId: string, line: string): Promise<string | null> {
    const driver = await this.#for(sessionId)
    if (!isCommandSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」没有命令`)
    }
    return driver.runCommand(sessionId, line)
  }

  /**
   * The background jobs the conversation's kernel reports right now.
   *
   * No capability gate: a kernel that emits no job events answers with an empty list,
   * which draws nothing. Only the stop is gated, because that is the half that would
   * otherwise be a button with nothing behind it.
   */
  async kernelJobs(sessionId: string): Promise<ChatJob[]> {
    const driver = await this.#for(sessionId)
    if (driver.jobs === undefined) return []
    return driver.jobs(sessionId)
  }

  /** Asks the kernel that owns the conversation to stop one background job. */
  async killKernelJob(sessionId: string, jobId: string): Promise<void> {
    const driver = await this.#for(sessionId)
    if (driver.killJob === undefined) {
      throw new Error(`这个会话的内核「${driver.id}」没有后台任务`)
    }
    await driver.killJob(sessionId, jobId)
  }

  /** Tools this conversation no longer asks about. */
  async kernelGrants(sessionId: string): Promise<string[]> {
    const driver = await this.#for(sessionId)
    if (!isApprovalSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」自己决定何时问人`)
    }
    return driver.grantedTools(sessionId)
  }

  async grantKernelTool(sessionId: string, tool: string): Promise<string[]> {
    const driver = await this.#for(sessionId)
    if (!isApprovalSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」自己决定何时问人`)
    }
    driver.grantTool(sessionId, tool)
    return driver.grantedTools(sessionId)
  }

  async revokeKernelGrants(sessionId: string): Promise<string[]> {
    const driver = await this.#for(sessionId)
    if (!isApprovalSource(driver)) {
      throw new Error(`这个会话的内核「${driver.id}」自己决定何时问人`)
    }
    driver.revokeGrants(sessionId)
    return driver.grantedTools(sessionId)
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

/** What every capability looks like when there is no kernel to ask. */
const NO_CAPABILITIES: KernelCapabilities = {
  permission: false,
  approval: false,
  model: false,
  skills: false,
  fork: false,
  commands: false,
  jobs: false,
}

/** The status of a machine with no kernel: nothing runs, and nothing is broken. */
function noKernelStatus(): HarnessStatus {
  return {
    state: 'stopped',
    binary: null,
    version: null,
    expectedVersion: null,
    home: '',
    provider: null,
    model: null,
    serverInfo: null,
    permissionMode: 'workspace-write',
    error: null,
  }
}

/**
 * Which kernel new conversations start on.
 *
 * The chosen one when it is present, otherwise the first that loaded. A name that is
 * not installed is ignored rather than turned into an error: the person's choice may
 * name a kernel they uninstalled, and refusing to start over that would be worse than
 * starting on another.
 */
function pickDefault(
  drivers: ReadonlyMap<string, KernelDriver>,
  wanted: string | null,
): KernelDriver | null {
  if (wanted !== null) {
    const chosen = drivers.get(wanted)
    if (chosen !== undefined) return chosen
  }
  return drivers.values().next().value ?? null
}
