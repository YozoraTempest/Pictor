import type {
  FrontendLock,
  FrontendLockLease,
  ProfileLockConflict,
  ProfileLockOwner,
  UserData,
} from '../application/index.js'
import type { CommandClient } from '../commands/index.js'

export interface CliWriter {
  write(content: string): unknown
}

export interface CliIo {
  readonly stdout: CliWriter
  readonly stderr: CliWriter
}

export type CliSignal = 'SIGINT'

export interface CliSignals {
  on(signal: CliSignal, listener: () => void): unknown
  off(signal: CliSignal, listener: () => void): unknown
}

export interface CliProfileLock extends FrontendLock {
  getConflict?(): ProfileLockConflict | null
}

export interface CliApplicationHostOptions {
  readonly userData: UserData
  readonly frontendLock: FrontendLock
  readonly safeMode: boolean
  readonly pluginProfile?: CliPluginProfile
}

export interface CliApplicationHost {
  start(): Promise<{ commandClient: CommandClient }>
  stop(): Promise<void>
}

export interface CliDependencies {
  readonly io: CliIo
  readonly version: string
  readonly resolveUserDataDirectory: (explicitDirectory: string | null) => string
  readonly createProfileLock: (profilePath: string) => CliProfileLock
  readonly createApplicationHost: (
    options: CliApplicationHostOptions,
  ) => CliApplicationHost | Promise<CliApplicationHost>
  readonly signals?: CliSignals
  readonly cancelTimeoutMs?: number
}

export type CliOutputFormat = 'text' | 'json'

export type CliPluginProfile = 'default' | 'developer'

export interface ParsedCliCommand {
  readonly commandId: string
  readonly input: unknown
}

export interface ParsedCliRequest {
  readonly output: CliOutputFormat
  readonly userDataDirectory: string | null
  readonly profile: CliPluginProfile | null
  readonly safeMode: boolean
  readonly request:
    | { readonly kind: 'help'; readonly topic: readonly string[] }
    | { readonly kind: 'version' }
    | { readonly kind: 'command'; readonly command: ParsedCliCommand }
}

export type CliErrorCode = 'usage' | 'profile-locked' | 'command-failed' | 'internal' | 'cancelled'

export interface CliError {
  readonly code: CliErrorCode
  readonly message: string
  readonly commandId?: string
  readonly executionId?: string
  readonly field?: string
  readonly owner?: Omit<ProfileLockOwner, 'token'> | null
  readonly lockPath?: string
}

export interface CliRunResult {
  readonly exitCode: import('./exit-codes.js').CliExitCode
  readonly error?: CliError
}

export type { CommandClient, FrontendLock, FrontendLockLease }
