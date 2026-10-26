import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PI_PROVIDER_PREFIX, type McpServerSpec } from '@pictor/shared'

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

/**
 * Forgets the model choices that only Pi's own configuration could offer.
 *
 * Called whenever Pi is pointed back at Pictor's isolated directory: a conversation
 * that remembers one of those models would fail at startup, and forgetting it turns a
 * broken conversation into one that simply has not chosen yet. Pictor's own models
 * start with `pictor-`, which is what survives.
 */
export function forgetForeignPiModels(userData: string): void {
  const dropped = prunePiModelsFile(userData)
  if (dropped > 0) {
    console.warn(`[pi] 忘记了 ${String(dropped)} 个只存在于 Pi 自己配置里的模型选择`)
  }
}

/**
 * Pi's MCP servers, written where Pi reads them.
 *
 * Pi loads `mcp.json` from its own configuration directory, which inside Pictor is
 * `<profile>/pi-home`. Pictor keeps one list for every kernel, so the list is rendered
 * into Pi's format at spawn time: that is also the moment Pi reads it, and a
 * conversation that starts after an edit gets the servers the page shows.
 *
 * Pi's own configuration is its own business: when a person turned isolation off, this
 * writes nothing and `~/.pi/agent/mcp.json` stays exactly as they left it.
 */
export function writePiMcpJson(home: string, servers: readonly McpServerSpec[]): void {
  const file = join(home, 'mcp.json')
  const enabled = servers.filter((server) => server.enabled)
  if (enabled.length === 0) {
    // An empty file would be a list of zero servers either way; removing it keeps a
    // stale entry from an earlier version of Pictor out of Pi's configuration.
    rmSync(file, { force: true })
    return
  }

  const mcpServers: Record<string, unknown> = {}
  for (const server of enabled) {
    mcpServers[server.name] =
      server.transport === 'http'
        ? {
            url: server.url,
            ...(Object.keys(server.headers).length === 0 ? {} : { headers: server.headers }),
          }
        : {
            command: server.command,
            ...(server.args.length === 0 ? {} : { args: server.args }),
            ...(Object.keys(server.env).length === 0 ? {} : { env: server.env }),
          }
  }
  mkdirSync(home, { recursive: true })
  writeFileSync(file, `${JSON.stringify({ mcpServers }, null, 2)}\n`, 'utf8')
}
