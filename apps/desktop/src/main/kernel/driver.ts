import type { HarnessNotification } from '@pictor/harness'
import type {
  CatalogSkill,
  ChatAnswer,
  ChatHistoryPage,
  ChatImage,
  ForkPoint,
  ModelEffort,
} from '@pictor/shared'

import type { HarnessStatus, KernelCapabilities, PermissionMode } from '../../shared/bridge.js'

/**
 * One agent kernel, as the main process needs it.
 *
 * Pictor owns no agent loop: conversations are executed by a kernel, and this is
 * everything the rest of the app is allowed to assume about one. The first
 * implementation wraps dsh; a second one (a CLI, an SDK, a prototype) only has to
 * satisfy this contract to be usable behind the same windows.
 *
 * The methods are deliberately shaped around Pictor's own vocabulary — a Pictor
 * session id, a permission mode, a `ChatHistoryPage` — rather than around any one
 * kernel's protocol. Anything a kernel cannot express is answered honestly
 * (`null`, an empty page, a thrown error) instead of being faked.
 */
/** What one probe turn produced: the text, the durable events, or why it failed. */
export interface AgentProbeResult {
  ok: boolean
  text: string
  events: string[]
  message?: string
}

export interface KernelDriver {
  /** Stable id, used to remember which kernel a conversation belongs to. */
  readonly id: string
  /**
   * What this kernel can actually do.
   *
   * The window draws a control only where the kernel behind the conversation says
   * it exists, so a driver that cannot set a sandbox declares `permission: false`
   * and the picker disappears instead of failing on use.
   */
  readonly capabilities: KernelCapabilities

  // ---- lifecycle -----------------------------------------------------------
  /** Boots the kernel for this working directory; idempotent when already up. */
  start(cwd: string): Promise<HarnessStatus>
  /** Shuts it down and drops every stream. */
  stop(): Promise<HarnessStatus>
  /** Current state, cheap: never touches the kernel. */
  status(): HarnessStatus
  /** Installs the kernel where it is missing; resolves when the install ends. */
  install(): Promise<HarnessStatus>

  // ---- conversations -------------------------------------------------------
  /** Queues one user message; the answer arrives through {@link onNotification}. */
  prompt(
    sessionId: string,
    text: string,
    images?: readonly ChatImage[],
    effort?: ModelEffort | null,
  ): Promise<void>
  /** Stops the turn a conversation is running. */
  cancel(sessionId: string): Promise<void>
  /** Branches a conversation; resolves with the new Pictor session id. */
  /**
   * Branches a conversation; resolves with the new kernel session id.
   *
   * The point is whatever the caller's rows carry: a durable event boundary for a
   * kernel that forks by sequence, an entry id for one that forks by message.
   */
  fork(sessionId: string, at?: ForkPoint): Promise<string>
  /** Records that an existing kernel session belongs to a Pictor conversation. */
  adopt(sessionId: string, kernelSessionId: string): void

  // ---- history -------------------------------------------------------------
  /** Every stored event for one conversation, as chat rows. */
  openHistory(sessionId: string): Promise<ChatHistoryPage>
  historyPage(sessionId: string, limit: number, offset: number): Promise<ChatHistoryPage>

  // ---- events --------------------------------------------------------------
  /** Kernel notifications, already translated to Pictor's method names. */
  onNotification(listener: (notification: HarnessNotification) => void): () => void
  /** Settles a tool call the kernel is holding for a decision. */
  answerApproval(eventId: string, allow: boolean): Promise<void>
  /** Answers the model's question, or refuses it with `null`. */
  answerQuestions(eventId: string, answers: readonly ChatAnswer[] | null): Promise<void>

  // ---- settings ------------------------------------------------------------
  /** Records the sandbox default; the kernel may apply it immediately. */
  setPermissionMode(mode: PermissionMode): void
  /** Pushes the sandbox default into a running kernel. */
  applyPermission(mode: PermissionMode): Promise<void>
  /** Re-applies whatever boot-time settings changed while the kernel ran. */
  applySettings(): Promise<void>
  /** Sandbox mode one conversation is actually running under. */
  sessionPermission(sessionId: string): Promise<string | null>
  /** Switches one conversation's sandbox mode without a restart. */
  setSessionPermission(sessionId: string, mode: PermissionMode): Promise<void>
  /** Nearest repository ancestor of a conversation's directory. */
  projectRootFor(sessionId: string): Promise<string | null>
  /** The skills one conversation can see. */
  listSkills(sessionId: string): Promise<CatalogSkill[]>

  // ---- diagnosis -----------------------------------------------------------
  /** Runs one throwaway turn against the configured model. */
  probe(prompt: string, cwd: string): Promise<AgentProbeResult>
}
