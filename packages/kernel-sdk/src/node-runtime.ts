import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * A plain Node binary and the npm that ships with it.
 *
 * Two things need this: booting the dsh runtime, which refuses to run under
 * Electron's embedded node, and installing a kernel package. The app's own PATH is
 * not a reliable source — a packaged Electron started from a desktop entry does not
 * inherit a shell's fnm shims — so discovery looks where a developer's installs
 * actually are and lets an environment variable override it.
 */

/** `PICTOR_NODE_BIN`, then fnm's v22 installs, then the system locations. */
export function resolveNodeBinary(): string | null {
  const explicit = process.env['PICTOR_NODE_BIN']
  if (explicit !== undefined && existsSync(explicit)) return explicit

  const roots = [
    join(homedir(), '.local/share/fnm/node-versions'),
    join(homedir(), '.fnm/node-versions'),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const versions = readdirSync(root)
      .filter((entry) => entry.startsWith('v22.'))
      .sort()
      .reverse()
    for (const version of versions) {
      const candidate = join(root, version, 'installation/bin/node')
      if (existsSync(candidate)) return candidate
    }
  }

  for (const candidate of ['/usr/local/bin/node', '/usr/bin/node']) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The npm JS entry that belongs to `nodePath`. */
export function resolveNpmCli(nodePath: string): string | null {
  const explicit = process.env['PICTOR_NPM_CLI']
  if (explicit !== undefined && existsSync(explicit)) return explicit

  const candidates = [
    join(dirname(nodePath), '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
