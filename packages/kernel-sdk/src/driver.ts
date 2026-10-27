import type { HarnessNotification } from '@vulonlok/harness-dsh'
import type {
  CatalogSkill,
  ChatAnswer,
  ChatHistoryPage,
  ChatJob,
  ChatMessage,
  ChatImage,
  ForkPoint,
  ModelEffort,
} from '@vulonlok/shared'

import type {
  HarnessStatus,
  KernelCapabilities,
  KernelCommand,
  KernelJobOutput,
  PermissionMode,
} from './kinds.js'

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
  /** Human name for the picker; the kernel knows its own best. */
  readonly label: string
  /**
   * Lucide icon name for the rail, e.g. `terminal`.
   *
   * The window maps the name to a component, so a kernel this build has never heard of
   * can still name its own icon instead of borrowing a generic one. Unknown names fall
   * back to that generic icon rather than drawing nothing.
   */
  readonly icon?: string
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
  /**
   * Slash commands this kernel offers, and the way to run one.
   *
   * Optional because a kernel may have none; a kernel that declares
   * `capabilities.commands` has to implement both, which the host checks at mount.
   */
  commands?(sessionId: string): Promise<KernelCommand[]>
  runCommand?(sessionId: string, line: string): Promise<string | null>

  // ---- background jobs -----------------------------------------------------
  /**
   * The jobs the kernel currently considers live or recently finished.
   *
   * Asked rather than remembered: a roster rebuilt from events alone would keep
   * claiming a job is running after the runtime that owned it died. Optional because
   * a kernel may have no background work; a kernel that declares `capabilities.jobs`
   * has to implement {@link killJob}, which is what the flag actually guards.
   */
  jobs?(sessionId: string): Promise<ChatJob[]>
  /** Asks the kernel to stop one background job. */
  killJob?(sessionId: string, jobId: string): Promise<void>
  /**
   * What one background job has printed so far.
   *
   * Read rather than tailed: a live stream per row would cost a socket for something
   * nobody is looking at until they ask. `partial` says whether the job was still running
   * when the read stopped, so the window can say "so far" instead of implying an end.
   */
  jobOutput?(sessionId: string, jobId: string): Promise<KernelJobOutput>

  // ---- subagents -----------------------------------------------------------
  /**
   * One child agent's stored transcript, read on demand.
   *
   * A child is its own session, so this is a read of that session rather than a view of
   * the parent's: what it returns describes work that happened elsewhere, and nothing
   * here merges it into the parent's transcript. Optional because a kernel may have no
   * subagents, and because a child started by an external provider has no local log to
   * read at all.
   */
  childTranscript?(sessionId: string, childId: string, mode: string): Promise<ChatMessage[]>

  // ---- diagnosis -----------------------------------------------------------
  /** Runs one throwaway turn against the configured model. */
  probe(prompt: string, cwd: string): Promise<AgentProbeResult>
}
