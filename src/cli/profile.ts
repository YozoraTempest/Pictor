import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface CliPlatformEnvironment {
  readonly platform?: NodeJS.Platform
  readonly homeDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export function resolveCliUserDataDirectory(
  explicitDirectory: string | null,
  options: CliPlatformEnvironment = {},
): string {
  if (explicitDirectory !== null) return resolve(explicitDirectory)

  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const homeDirectory = options.homeDirectory ?? homedir()
  const appDataDirectory =
    platform === 'win32'
      ? (environment.APPDATA ?? join(homeDirectory, 'AppData', 'Roaming'))
      : (environment.XDG_CONFIG_HOME ?? join(homeDirectory, '.config'))

  // The CLI is the development Frontend for this stage. This mirrors the
  // existing Electron development profile selected in main/index.ts.
  return resolve(join(appDataDirectory, 'pictor-dev'))
}
