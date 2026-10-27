import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parsePackageManifest, type PluginManifest } from '@pictor/plugin-sdk'

export interface DiscoveredPlugin {
  id: string
  root: string
  manifestPath: string
  manifest: PluginManifest
}

export interface PluginFailure {
  /** Plugin root or manifest path that failed. */
  source: string
  reason: string
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[]
  failures: PluginFailure[]
}

/**
 * Reads every plugin root, in either format.
 *
 * A plugin is an npm package whose `package.json` declares `pictor`: that is what
 * makes `npm install` the only install step, and it is why there is no second file
 * that could disagree with `name` and `version`. A directory without the field is not
 * a plugin — it is left alone rather than reported as broken.
 *
 * A broken plugin is reported and skipped; discovery never throws because one plugin
 * is malformed.
 */
export function discoverPlugins(roots: string[]): DiscoveryResult {
  const plugins: DiscoveredPlugin[] = []
  const failures: PluginFailure[] = []
  const seen = new Map<string, string>()

  for (const root of roots) {
    const found = readPlugin(root)
    if (found === null) continue
    if ('reason' in found) {
      failures.push({ source: root, reason: found.reason })
      continue
    }

    const previous = seen.get(found.manifest.id)
    if (previous !== undefined) {
      failures.push({
        source: root,
        reason: `duplicate plugin id ${found.manifest.id}; already provided by ${previous}`,
      })
      continue
    }

    seen.set(found.manifest.id, root)
    plugins.push({
      id: found.manifest.id,
      root,
      manifestPath: found.manifestPath,
      manifest: found.manifest,
    })
  }

  return { plugins, failures }
}

/** One plugin's manifest, or why it could not be read, or nothing at all. */
function readPlugin(
  root: string,
): { manifest: PluginManifest; manifestPath: string } | { reason: string } | null {
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) return null

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) return null

    // Two ways in, and the second is what makes a plugin installable by both this app
    // and dsh: a `pictor` block describes a plugin before it starts, and a bare
    // `main` is a plain cordis plugin whose needs live in code.
    //
    // A package with neither is not a plugin at all — a stray folder in the profile is
    // left alone rather than reported as broken.
    if (!('pictor' in raw) && !('main' in raw)) return null
    return { manifest: parsePackageManifest(raw), manifestPath }
  } catch (error) {
    return { reason: (error as Error).message }
  }
}

/**
 * Expands `<root>/*` into candidate plugin roots, skipping files.
 *
 * A candidate is any child directory carrying a `package.json`; whether it declares
 * `pictor` is `discoverPlugins`' job, so this stays a cheap directory listing.
 */
export function expandPluginRoots(parentDirectories: string[]): string[] {
  const roots: string[] = []

  for (const parent of parentDirectories) {
    if (!existsSync(parent)) continue

    for (const entry of readdirSync(parent)) {
      // `node_modules` holds packages this profile installed *for* plugins, and a dot
      // directory is machinery. Since a cordis plugin needs only a `main` entry, every
      // dependency would otherwise look like one.
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const path = join(parent, entry)
      if (statSync(path).isDirectory() && existsSync(join(path, 'package.json'))) {
        roots.push(path)
      }
    }
  }

  return roots
}
