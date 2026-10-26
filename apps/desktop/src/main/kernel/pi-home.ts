import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PI_PROVIDER_PREFIX } from '@pictor/shared'

/**
 * The configuration directory Pi runs on inside Pictor.
 *
 * Pi normally reads `~/.pi/agent`: its own services, keys, settings and extensions. A
 * second copy of the same services in there is what made two kernels drift apart, so
 * inside Pictor Pi gets a directory of its own — with nothing in it but what Pictor
 * registers. Its session files are unaffected: those already live in Pictor's own
 * folder and are passed with `--session-dir`.
 */
export function piHomeDir(userData: string): string {
  return join(userData, 'pi-home')
}

/** Creates the directory; Pi writes its own settings there from then on. */
export function ensurePiHome(userData: string): string {
  const directory = piHomeDir(userData)
  mkdirSync(directory, { recursive: true })
  return directory
}

/**
 * Drops remembered model choices that this configuration can no longer offer.
 *
 * Before isolation, a conversation could pick one of Pi's own models (`deepseek/*`,
 * `neko/*`). Those providers do not exist inside Pictor any more, and passing one to
 * a child makes it fail at startup — a conversation would look broken until someone
 * happened to pick another model. Pruning them at boot turns that into "no model
 * chosen yet", which the first turn resolves by Pi's own default.
 */
export function prunePiModels(models: Record<string, unknown>): {
  kept: Record<string, string>
  dropped: string[]
} {
  const kept: Record<string, string> = {}
  const dropped: string[] = []

  for (const [sessionId, value] of Object.entries(models)) {
    if (typeof value !== 'string') {
      dropped.push(sessionId)
      continue
    }
    if (!value.startsWith(PI_PROVIDER_PREFIX)) {
      dropped.push(sessionId)
      continue
    }
    kept[sessionId] = value
  }

  return { kept, dropped }
}

/** Prunes the stored choices in place; returns how many were dropped. */
export function prunePiModelsFile(userData: string): number {
  const file = join(userData, 'pi-models.json')
  if (!existsSync(file)) return 0

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // A file that cannot be read is not worth guessing about; Pi's driver will start
    // with no choices, which is the same state pruning aims for.
    return 0
  }
  if (typeof parsed !== 'object' || parsed === null) return 0

  const { kept, dropped } = prunePiModels(parsed as Record<string, unknown>)
  if (dropped.length === 0) return 0
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`, 'utf8')
  return dropped.length
}
