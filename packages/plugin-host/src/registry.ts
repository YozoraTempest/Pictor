import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parseManifest, type PluginManifest } from '@pictor/plugin-sdk'

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
 * Reads every plugin root that contains a `manifest.json`.
 *
 * A broken manifest is reported and skipped; discovery never throws because one
 * plugin is malformed.
 */
export function discoverPlugins(roots: string[]): DiscoveryResult {
  const plugins: DiscoveredPlugin[] = []
  const failures: PluginFailure[] = []
  const seen = new Map<string, string>()

  for (const root of roots) {
    const manifestPath = join(root, 'manifest.json')
    if (!existsSync(manifestPath)) continue

    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
      const manifest = parseManifest(raw)

      const previous = seen.get(manifest.id)
      if (previous !== undefined) {
        failures.push({
          source: root,
          reason: `duplicate plugin id ${manifest.id}; already provided by ${previous}`,
        })
        continue
      }

      seen.set(manifest.id, root)
      plugins.push({ id: manifest.id, root, manifestPath, manifest })
    } catch (error) {
      failures.push({ source: root, reason: (error as Error).message })
    }
  }

  return { plugins, failures }
}

/** Expands `<root>/*` into candidate plugin roots, skipping files. */
export function expandPluginRoots(parentDirectories: string[]): string[] {
  const roots: string[] = []

  for (const parent of parentDirectories) {
    if (!existsSync(parent)) continue

    for (const entry of readdirSync(parent)) {
      const path = join(parent, entry)
      if (statSync(path).isDirectory() && existsSync(join(path, 'manifest.json'))) {
        roots.push(path)
      }
    }
  }

  return roots
}
