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
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  /** `null` when the session does not belong to any project. */
  projectId: string | null
  title: string
  piSessionId: string | null
  pinned: boolean
  /** Archived sessions stay in the database but leave the working list. */
  archived: boolean
  /** Sections (user-defined tags) the session is filed under. */
  sectionIds: string[]
  createdAt: number
  updatedAt: number
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
