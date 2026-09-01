import {
  resolveUserDataDirectory,
  type UserDataDirectoryOptions,
} from '../application/user-data.js'

export type CliPlatformEnvironment = UserDataDirectoryOptions

export function resolveCliUserDataDirectory(
  explicitDirectory: string | null,
  options: CliPlatformEnvironment = {},
): string {
  return resolveUserDataDirectory(explicitDirectory, options)
}
