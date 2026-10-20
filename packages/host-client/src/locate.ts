import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface HostCoreBinaryOptions {
  /** Repository root in development, or `app.getAppPath()` in a packaged build. */
  appRoot: string
  /** `process.resourcesPath` in a packaged build. */
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Resolves the sidecar executable without guessing at a user's install layout.
 *
 * Order: explicit env override, release build, debug build, packaged resource.
 */
export function resolveHostCoreBinary(options: HostCoreBinaryOptions): string {
  const override = options.env?.PICTOR_HOST_CORE
  if (override !== undefined && override.trim().length > 0) {
    return override
  }

  const executable = process.platform === 'win32' ? 'pictor-host-core.exe' : 'pictor-host-core'
  const candidates = [
    resolve(options.appRoot, 'target', 'release', executable),
    resolve(options.appRoot, 'target', 'debug', executable),
  ]

  if (options.resourcesPath !== undefined) {
    candidates.push(join(options.resourcesPath, 'host-core', executable))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(
    `cannot find ${executable}; run "cargo build -p pictor-host-core" or set PICTOR_HOST_CORE`,
  )
}
