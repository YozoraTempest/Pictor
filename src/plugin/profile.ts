import semver from 'semver'
import { z } from 'zod'

import { pluginIdSchema, pluginVersionRangeSchema, type PluginManifest } from './manifest.js'

export const pluginProfileSchema = z.object({
  id: pluginIdSchema,
  plugins: z.record(pluginIdSchema, pluginVersionRangeSchema),
})

export type PluginProfile = z.infer<typeof pluginProfileSchema>

export function resolvePluginProfile(
  profile: PluginProfile,
  manifests: readonly PluginManifest[],
): readonly string[] {
  const manifestsById = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const selected: string[] = []
  const visiting: string[] = []
  const visited = new Set<string>()

  const visit = (id: string, range: string): void => {
    if (visited.has(id)) return
    const manifest = manifestsById.get(id)
    if (!manifest) throw new Error(`Profile ${profile.id} requires missing Plugin ${id} ${range}`)
    if (!semver.satisfies(manifest.version, range)) {
      throw new Error(
        `Profile ${profile.id} requires ${id} ${range}, bundled version is ${manifest.version}`,
      )
    }
    const cycleStart = visiting.indexOf(id)
    if (cycleStart >= 0) {
      throw new Error(
        `Circular Profile dependency: ${[...visiting.slice(cycleStart), id].join(' -> ')}`,
      )
    }

    visiting.push(id)
    for (const [dependencyId, dependencyRange] of Object.entries(manifest.dependencies)) {
      visit(dependencyId, dependencyRange)
    }
    visiting.pop()
    visited.add(id)
    selected.push(id)
  }

  for (const [id, range] of Object.entries(profile.plugins)) visit(id, range)
  return selected
}
