import type { HarnessNotification } from '@vulonlok/harness-dsh'
import type {
  ApprovalMode,
  CatalogSkill,
  ChatAnswer,
  ChatHistoryPage,
  ChatImage,
  ChatJob,
  ChatMessage,
  ForkPoint,
  ModelEffort,
} from '@vulonlok/shared'

import type {
  HarnessStatus,
  KernelCapabilities,
  KernelInfo,
  KernelJobOutput,
  KernelModelState,
  PermissionMode,
} from '../../shared/bridge.js'
import {
  isApprovalSource,
  isCommandSource,
  type KernelApprovalSource,
  type KernelCommand,
} from '@vulonlok/kernel-sdk'
import type { AgentProbeResult, KernelDriver } from '@vulonlok/kernel-sdk'
import { isCatalogueSource, isModelSource } from '@vulonlok/kernel-sdk'
import { isSettingsSource } from '@vulonlok/kernel-sdk'

export type { KernelInfo }

/**
 * dsh, as the app drives it.
 *
 * There is one engine, and this is it. A conversation's id names the transcript, not a
 * backend; a call does not pick a driver. What used to be a router now forwards, because
 * the state it routed on — which kernel owns this conversation — is the same constant for
 * every conversation in the app.
 *
 * The capability checks stay. They are not about choosing between engines: dsh itself
 * declines to be more than one thing at a time. A build of it that keeps no job registry
 * answers no jobs, a namespace that decides its own policy hands over no approval switch,
 * and each of those is answered here rather than drawn as a control that fails on use.
 */
export class DshHarness implements KernelDriver {
  readonly #driver: KernelDriver

  constructor(driver: KernelDriver) {
    this.#driver = driver
  }

  /** The engine. A conversation id is not consulted: there is nothing to choose. */
  #engine(): KernelDriver {
    return this.#driver
  }

  /**
   * Whether the engine new conversations start on is this one.
   *
   * Kept for the window, which names the default in the plugin list. The answer is
   * always yes when it names dsh: with one engine there is no other place to start.
   */
  setDefault(id: string): boolean {
    return id === this.#driver.id
  }

  /**
   * Settings the engine declares, in a shape the window can draw.
   *
   * The page renders what it is handed: a knob the runtime describes is a knob the
   * window draws, and no other file needs to know it exists.
   */
  settings(): Array<{
    kernel: string
    key: string
    label: string
    description: string
    hint: string
    value: boolean
  }> {
    const driver = this.#driver
    if (!isSettingsSource(driver)) return []
    return driver.settings().map((setting) => ({
      kernel: driver.id,
      key: setting.key,
      label: setting.label,
      description: setting.description,
      hint: setting.hint(),
      value: setting.read(),
    }))
  }

  /** Writes one declared setting; false means the engine declares no such key. */
  async setKernelSetting(key: string, value: boolean): Promise<boolean> {
    const driver = this.#driver
    if (!isSettingsSource(driver)) return false
    const setting = driver.settings().find((entry) => entry.key === key)
    if (setting === undefined) return false
    await setting.write(value)
    return true
  }

  /** Tells the engine to forget a catalogue it may be caching. */
  invalidateCatalogues(): void {
    if (isCatalogueSource(this.#driver)) this.#driver.invalidateCatalogue()
  }

  get id(): string {
    return this.#driver.id
  }

  get label(): string {
    return this.#driver.label
  }

  get capabilities(): KernelCapabilities {
    return this.#driver.capabilities
  }

  /** State of the engine. A conversation id would name a transcript, not a process. */
  async statusOf(_sessionId: string): Promise<HarnessStatus> {
    return this.#driver.status()
  }

  /** The engine, for the views that still describe themselves as a list. */
  list(): KernelInfo[] {
    const driver = this.#driver
    return [
      {
        id: driver.id,
        label: driver.label,
        icon: typeof driver.icon === 'string' && driver.icon.length > 0 ? driver.icon : null,
        default: true,
        available: driver.status().binary !== null,
        // What it can actually do travels with it: the window hides the controls it
        // cannot answer instead of letting them fail on use.
        capabilities: driver.capabilities,
        // Whose model list the picker should show: Pictor's, the engine's own, or none.
        modelSource: isModelSource(driver) ? 'kernel' : driver.capabilities.model ? 'pictor' : null,
      },
    ]
  }

  // ---- lifecycle ------------------------------------------------------------

  start(cwd: string): Promise<HarnessStatus> {
    return this.#engine().start(cwd)
  }

  stop(): Promise<HarnessStatus> {
    return this.#engine().stop()
  }

  status(): HarnessStatus {
    return this.#driver.status()
  }

  /** The engine's own status, keyed by id: one entry, because there is one engine. */
  statuses(): Record<string, HarnessStatus> {
    return { [this.#driver.id]: this.#driver.status() }
  }

  install(): Promise<HarnessStatus> {
    return this.#engine().install()
  }

  setPermissionMode(mode: PermissionMode): void {
    this.#engine().setPermissionMode(mode)
  }

  applyPermission(mode: PermissionMode): Promise<void> {
    return this.#engine().applyPermission(mode)
  }

  applySettings(): Promise<void> {
    return this.#engine().applySettings()
  }

  probe(prompt: string, cwd: string): Promise<AgentProbeResult> {
    return this.#engine().probe(prompt, cwd)
  }

  onNotification(listener: (notification: HarnessNotification) => void): () => void {
    return this.#driver.onNotification(listener)
  }

  // ---- conversation-scoped --------------------------------------------------

  prompt(
    sessionId: string,
    text: string,
    images?: readonly ChatImage[],
    effort?: ModelEffort | null,
  ): Promise<void> {
    return this.#engine().prompt(sessionId, text, images, effort)
  }

  cancel(sessionId: string): Promise<void> {
    return this.#engine().cancel(sessionId)
  }

  fork(sessionId: string, at?: ForkPoint): Promise<string> {
    return this.#engine().fork(sessionId, at)
  }

  async adopt(sessionId: string, kernelSessionId: string): Promise<void> {
    // The contract lets a driver adopt synchronously; the caller awaits either way.
    this.#engine().adopt(sessionId, kernelSessionId)
  }

  openHistory(sessionId: string): Promise<ChatHistoryPage> {
    return this.#engine().openHistory(sessionId)
  }

  historyPage(sessionId: string, limit: number, offset: number): Promise<ChatHistoryPage> {
    return this.#engine().historyPage(sessionId, limit, offset)
  }

  sessionPermission(sessionId: string): Promise<string | null> {
    return this.#engine().sessionPermission(sessionId)
  }

  setSessionPermission(sessionId: string, mode: PermissionMode): Promise<void> {
    return this.#engine().setSessionPermission(sessionId, mode)
  }

  projectRootFor(sessionId: string): Promise<string | null> {
    return this.#engine().projectRootFor(sessionId)
  }

  listSkills(sessionId: string): Promise<CatalogSkill[]> {
    return this.#engine().listSkills(sessionId)
  }

  // ---- capabilities the engine may or may not have --------------------------

  /** The models the engine offers, in its own words. */
  async kernelModels(sessionId: string): Promise<KernelModelState> {
    const driver = this.#driver
    if (!isModelSource(driver)) throw new Error(`「${driver.label}」不提供自己的模型列表`)
    return driver.models(sessionId)
  }

  async selectKernelModel(sessionId: string, id: string): Promise<void> {
    const driver = this.#driver
    if (!isModelSource(driver)) throw new Error(`「${driver.label}」不提供自己的模型列表`)
    return driver.selectModel(sessionId, id)
  }

  async selectKernelEffort(sessionId: string, effort: ModelEffort | null): Promise<void> {
    const driver = this.#driver
    if (!isModelSource(driver)) throw new Error(`「${driver.label}」不提供自己的思考档位`)
    return driver.setEffort(sessionId, effort)
  }

  /** When calls wait for a person, in the engine's own terms. */
  async kernelApproval(sessionId: string): Promise<ApprovalMode> {
    const driver = this.#driver
    if (!isApprovalSource(driver)) throw new Error(`「${driver.label}」自己决定何时问人`)
    return driver.approvalMode(sessionId)
  }

  async selectKernelApproval(sessionId: string, mode: ApprovalMode): Promise<void> {
    const driver = this.#driver
    if (!isApprovalSource(driver)) throw new Error(`「${driver.label}」自己决定何时问人`)
    driver.setApprovalMode(sessionId, mode)
  }

  /**
   * The approval mode the guard should apply to one conversation.
   *
   * `never` when the engine decides for itself — its own policy already decided to hold
   * the call, so applying a second mode here would ask twice. A tool rule still applies
   * either way. This is the question the guard asks, which is why it answers instead of
   * throwing.
   */
  async guardApprovalMode(sessionId: string): Promise<ApprovalMode> {
    const source = this.#approvalSource()
    return source === null ? 'never' : source.approvalMode(sessionId)
  }

  /** Whether this conversation already allowed one tool, in the engine's own terms. */
  async guardIsGranted(sessionId: string, tool: string): Promise<boolean> {
    const source = this.#approvalSource()
    return source === null ? false : source.isGranted(sessionId, tool)
  }

  /** The engine, when it hands approval decisions to the window. */
  #approvalSource(): (KernelDriver & KernelApprovalSource) | null {
    const driver = this.#driver
    return isApprovalSource(driver) ? driver : null
  }

  /**
   * The slash commands the engine offers.
   *
   * Empty when it has none — a runtime that runs whatever it was configured with has
   * nothing to switch, and an empty menu is a truthful answer.
   */
  async kernelCommands(sessionId: string): Promise<KernelCommand[]> {
    const driver = this.#driver
    if (!isCommandSource(driver)) return []
    return driver.commands(sessionId)
  }

  /** Runs one complete slash line. */
  async runKernelCommand(sessionId: string, line: string): Promise<string | null> {
    const driver = this.#driver
    if (!isCommandSource(driver)) throw new Error(`「${driver.label}」没有命令`)
    return driver.runCommand(sessionId, line)
  }

  /**
   * The background jobs the engine reports right now.
   *
   * No capability gate: an engine that emits no job events answers with an empty list,
   * which draws nothing. Only the stop is gated, because that is the half that would
   * otherwise be a button with nothing behind it.
   */
  async kernelJobs(sessionId: string): Promise<ChatJob[]> {
    const driver = this.#driver
    if (driver.jobs === undefined) return []
    return driver.jobs(sessionId)
  }

  /** What one background job printed, read on demand. */
  async kernelJobOutput(sessionId: string, jobId: string): Promise<KernelJobOutput> {
    const driver = this.#driver
    if (driver.jobOutput === undefined) throw new Error(`「${driver.label}」不提供任务输出`)
    return driver.jobOutput(sessionId, jobId)
  }

  /** Asks the engine to stop one background job. */
  async killKernelJob(sessionId: string, jobId: string): Promise<void> {
    const driver = this.#driver
    if (driver.killJob === undefined) throw new Error(`「${driver.label}」没有后台任务`)
    await driver.killJob(sessionId, jobId)
  }

  /**
   * One child agent's transcript.
   *
   * No capability gate: an engine with no subagents never reported one, so the window has
   * nothing to offer. The read is refused only when there is no such method at all, which
   * is a wiring mistake worth naming rather than an empty transcript.
   */
  async childTranscript(sessionId: string, childId: string, mode: string): Promise<ChatMessage[]> {
    const driver = this.#driver
    if (driver.childTranscript === undefined) throw new Error(`「${driver.label}」不提供子代理记录`)
    return driver.childTranscript(sessionId, childId, mode)
  }

  /** Tools this conversation no longer asks about. */
  async kernelGrants(sessionId: string): Promise<string[]> {
    const driver = this.#driver
    if (!isApprovalSource(driver)) throw new Error(`「${driver.label}」自己决定何时问人`)
    return driver.grantedTools(sessionId)
  }

  async grantKernelTool(sessionId: string, tool: string): Promise<string[]> {
    const driver = this.#driver
    if (!isApprovalSource(driver)) throw new Error(`「${driver.label}」自己决定何时问人`)
    driver.grantTool(sessionId, tool)
    return driver.grantedTools(sessionId)
  }

  async revokeKernelGrants(sessionId: string): Promise<string[]> {
    const driver = this.#driver
    if (!isApprovalSource(driver)) throw new Error(`「${driver.label}」自己决定何时问人`)
    driver.revokeGrants(sessionId)
    return driver.grantedTools(sessionId)
  }

  // ---- answers, which name an event rather than a conversation ---------------

  answerApproval(eventId: string, allow: boolean): Promise<void> {
    return this.#engine().answerApproval(eventId, allow)
  }

  answerQuestions(eventId: string, answers: readonly ChatAnswer[] | null): Promise<void> {
    return this.#engine().answerQuestions(eventId, answers)
  }
}
