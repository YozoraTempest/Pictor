/**
 * Serializable domain model shared by every process and package.
 *
 * Nothing here may import Node, Electron, React or a concrete implementation:
 * that is what keeps the Rust sidecar, the Electron main process and the
 * renderer able to share one contract.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface Project {
  id: string
  /** Primary working directory for the agent. */
  path: string
  name: string
  /** Extra working directories registered on the project. */
  folders: string[]
  /** Section the project is filed under; `null` = the built-in 项目 section. */
  sectionId: string | null
  position: number
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  /** `null` when the session does not belong to any project. */
  projectId: string | null
  title: string
  /**
   * Kernel that executes this conversation.
   *
   * Fixed when the conversation is created: switching kernels later is a branch
   * on the target kernel, because a conversation's history belongs to the one
   * that produced it.
   */
  kernelId: string
  /**
   * Kept from the pre-runtime layout: the column still exists so an old
   * profile opens unchanged, but nothing writes it and no reader branches on
   * it. Transcripts belong to the runtime.
   */
  piSessionId: string | null
  pinned: boolean
  /** Archived sessions stay in the database but leave the working list. */
  archived: boolean
  /** Manual sort key, used when a section is ordered by hand. */
  position: number
  /** Conversation this one was branched from; `null` for a root conversation. */
  parentId: string | null
  /** Sections (user-defined tags) the session is filed under. */
  sectionIds: string[]
  createdAt: number
  updatedAt: number
}

/**
 * Titles Pictor writes before anyone has named a conversation.
 *
 * `新会话 09:41` for a fresh one, and the same with ` · 分支` for a branch. The
 * runtime generates a real title from the first prompt; adopting it is only safe
 * while the title is still one of these, because anything else was typed by hand.
 */
const AUTO_TITLE = /^新会话 \d{2}:\d{2}(?: · 分支)*$/

export function isAutoSessionTitle(title: string): boolean {
  return AUTO_TITLE.test(title.trim())
}

/** A user-defined tag sessions can be filed under; purely a display grouping. */
export interface Section {
  id: string
  name: string
  position: number
  createdAt: number
}

export interface PluginRecord {
  id: string
  version: string
  enabled: boolean
  source: string
  installedAt: number
}

export type SettingsMap = Record<string, JsonValue>

export interface HostInfo {
  version: string
  schemaVersion: number
  database: string
}

/**
 * JSON-RPC error codes owned by the host core. Keep these in sync with
 * `crates/host-core/src/error.rs`.
 */
export const HOST_ERROR_CODES = {
  invalidParams: -32602,
  methodNotFound: -32601,
  notFound: -32004,
  conflict: -32009,
  storage: -32010,
  internal: -32603,
} as const

export type HostErrorCode = (typeof HOST_ERROR_CODES)[keyof typeof HOST_ERROR_CODES]

export * from './model.js'

export * from './chat.js'
export * from './pi-provider.js'

export type { ApprovalRequest, ChatImage } from './chat.js'

export * from './skill.js'

export * from './tool-rule.js'

export { pinnedVersionOf, versionStateOf, type VersionState } from './runtime-version.js'
export { DEFAULT_PERMISSION_MODE, isPermissionMode } from './permission.js'
export * from './mcp.js'
export * from './kernel-plugins.js'
