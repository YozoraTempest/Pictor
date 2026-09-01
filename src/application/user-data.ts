import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface UserDataDirectoryOptions {
  readonly platform?: NodeJS.Platform
  readonly homeDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly applicationName?: string
}

export function resolveUserDataDirectory(
  explicitDirectory: string | null,
  options: UserDataDirectoryOptions = {},
): string {
  if (explicitDirectory !== null) return resolve(explicitDirectory)

  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const homeDirectory = options.homeDirectory ?? homedir()
  const appDataDirectory =
    platform === 'win32'
      ? (environment.APPDATA ?? join(homeDirectory, 'AppData', 'Roaming'))
      : (environment.XDG_CONFIG_HOME ?? join(homeDirectory, '.config'))
  return resolve(join(appDataDirectory, options.applicationName ?? 'pictor-dev'))
}
