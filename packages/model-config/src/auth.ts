import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AuthFile {
  version: 1
  providers: Record<string, { apiKey: string }>
}

const EMPTY: AuthFile = { version: 1, providers: {} }

/**
 * Reads the profile auth file.
 *
 * A missing or malformed file is treated as "no credentials" rather than a hard
 * failure: the app must still start and let the user fix the configuration.
 */
export function readAuthFile(path: string): AuthFile {
  if (!existsSync(path)) return { ...EMPTY, providers: {} }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AuthFile>
    if (parsed.version !== 1 || typeof parsed.providers !== 'object' || parsed.providers === null) {
      return { ...EMPTY, providers: {} }
    }
    return { version: 1, providers: parsed.providers }
  } catch {
    return { ...EMPTY, providers: {} }
  }
}

export function readApiKey(path: string, providerId: string): string | null {
  const key = readAuthFile(path).providers[providerId]?.apiKey
  return typeof key === 'string' && key.trim().length > 0 ? key : null
}

/** Writes atomically with `0600` permissions on Unix. */
export function writeApiKey(path: string, providerId: string, apiKey: string): void {
  const auth = readAuthFile(path)
  auth.providers[providerId] = { apiKey }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export function clearApiKey(path: string, providerId: string): void {
  if (!existsSync(path)) return

  const auth = readAuthFile(path)
  delete auth.providers[providerId]

  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}
