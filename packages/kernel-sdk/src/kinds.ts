import type { ModelEffort } from '@pictor/shared'

/**
 * Sandbox mode one conversation runs under.
 *
 * Part of the kernel contract rather than of any one window: a kernel applies it, and
 * the composer only shows the choice a kernel says it can honour.
 */
export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * What one kernel can actually do.
 *
 * A kernel that cannot express something must not have a control in the window
 * pretending it can: a CLI with no sandbox still showed a permission picker, and
 * a picker that errors is worse than an absent one. Each driver declares what it
 * really offers, and the controls read that instead of assuming the default.
 */
export interface KernelCapabilities {
  /** A sandbox mode the kernel applies per conversation. */
  permission: boolean
  /**
   * The kernel lets Pictor decide when a call waits for a person.
   *
   * dsh answers this with its own sandbox and approval policy, so the switch is its
   * own; a kernel without a sandbox can still hold a call, and this is the promise
   * that the switch in the composer will mean something there.
   */
  approval: boolean
  /** The model chosen in Pictor reaches the kernel, effort included. */
  model: boolean
  /** The kernel exposes a skill catalog that a turn can load from. */
  skills: boolean
  /** The kernel can branch a conversation at a message boundary. */
  fork: boolean
  /** The kernel has slash commands of its own that Pictor can list and run. */
  commands: boolean
  /**
   * The kernel runs background jobs Pictor can list and cancel.
   *
   * Only the cancel is behind this flag. A kernel that emits job events but has no way
   * to stop one still gets its roster drawn — the panel shows what the kernel says is
   * running — it just never offers a stop button that cannot be honoured.
   */
  jobs: boolean
}

/** One model a kernel can run, in that kernel's own words. */
export interface KernelModel {
  /** What the kernel calls it; opaque to Pictor. */
  id: string
  /** Human name, falling back to the id. */
  label: string
  provider: string | null
  /** Whether this model accepts images. */
  images: boolean
  contextWindow: number | null
  /**
   * Levels this model accepts, weakest first, when the kernel declares them.
   *
   * `null` means the kernel said nothing, which is not the same as "none": the
   * composer then offers no level control instead of an empty one.
   */
  efforts: ModelEffort[] | null
}

/**
 * What one background job printed, as far as a read could see.
 *
 * `segments` keeps the stream each chunk came from (`stdout`, `stderr`, or the producer's
 * own `log` narration): a failure is readable only if the reader can tell which of them
 * said it. `text` is the same content joined, for copying.
 */
export interface KernelJobOutput {
  /** Every chunk in arrival order, grouped by stream. */
  segments: { channel: string | null; text: string }[]
  /** All segments joined; what a person would paste somewhere else. */
  text: string
  /**
   * True when the stream was still open when the read stopped.
   *
   * A running job's output never "ends", so a reader must be able to say "so far" instead
   * of implying the job finished.
   */
  partial: boolean
  /** True when the runtime said earlier output is gone (evicted or never kept). */
  lossy: boolean
}

/** One conversation's model state, in the kernel's own words. */
export interface KernelModelState {
  models: KernelModel[]
  /** The model this conversation is running, or null before it has run. */
  activeId: string | null
  /** The thinking level in effect, or null when the kernel's own default applies. */
  activeEffort: ModelEffort | null
}

/**
 * Whose model set the composer's picker should show.
 *
 * `pictor` is the app's own provider list, which dsh is booted with; `kernel` means
 * the kernel has its own catalogue and answers for it; null means there is nothing
 * to choose — a kernel that runs whatever it was configured with.
 */
export type KernelModelSource = 'pictor' | 'kernel' | null

/** What one kernel looks like from the renderer's side. */
export interface KernelInfo {
  id: string
  label: string
  /**
   * Icon name the kernel asked for, or null when it did not say.
   *
   * A name, not a component: the window owns the vocabulary, so a kernel that names an
   * icon this build does not know gets the generic one instead of a blank rail button.
   */
  icon: string | null
  default: boolean
  available: boolean
  capabilities: KernelCapabilities
  modelSource: KernelModelSource
}

/** Status of one kernel: whether it can run, what it runs with, why it failed. */
export interface HarnessStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error'
  /** Launcher path, or null when no runtime is installed. */
  binary: string | null
  /** Version the launcher on this machine reports, or null when unreadable. */
  version: string | null
  /** Version this build pins; a difference is what "stale" means. */
  expectedVersion: string | null
  /** Runtime home: profiles, session logs and storages live here. */
  home: string
  provider: string | null
  model: string | null
  serverInfo: { name: string; version: string } | null
  /** Sandbox mode the runtime is (or will be) booted with. */
  permissionMode: PermissionMode
  error: string | null
}

/**
 * One command a kernel can run without sending anything to the model.
 *
 * A slash command is the kernel's own business: `/compact` shortens the context,
 * `/permission` changes the sandbox. Pictor shows what the kernel offers and hands the
 * complete line back, because only the kernel knows what its commands mean.
 */
export interface KernelCommand {
  /** The name without its leading slash, as the kernel spells it. */
  name: string
  /** One line for the menu; the kernel wrote it. */
  description: string
  /**
   * Placeholder for free-form words after the name, when the command takes any.
   *
   * Absent means the command takes no arguments, which is how a menu knows not to
   * promise a text field that the command would ignore.
   */
  input?: string
}
