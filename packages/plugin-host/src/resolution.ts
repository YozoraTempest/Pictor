import { satisfies, validRange } from 'semver'

import type { DiscoveredPlugin, PluginFailure } from './registry.js'

export interface ResolutionResult {
  /** Plugins in activation order: dependencies come first. */
  ordered: DiscoveredPlugin[]
  failures: PluginFailure[]
}

/**
 * Validates engine compatibility, dependency satisfaction and acyclicity, then
 * returns a deterministic activation order.
 */
export function resolveActivationOrder(
  plugins: DiscoveredPlugin[],
  pictorVersion: string,
): ResolutionResult {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const failures: PluginFailure[] = []
  const usable = new Map<string, DiscoveredPlugin>()

  for (const plugin of plugins) {
    const range = plugin.manifest.engines.pictor

    if (validRange(range) === null) {
      failures.push({ source: plugin.root, reason: `invalid engine range: ${range}` })
      continue
    }

    if (!satisfies(pictorVersion, range)) {
      failures.push({
        source: plugin.root,
        reason: `requires pictor ${range}, host is ${pictorVersion}`,
      })
      continue
    }

    const missing = Object.entries(plugin.manifest.dependencies ?? {}).find(
      ([dependencyId]) => !byId.has(dependencyId),
    )
    if (missing !== undefined) {
      failures.push({
        source: plugin.root,
        reason: `missing dependency: ${missing[0]}`,
      })
      continue
    }

    usable.set(plugin.id, plugin)
  }

  for (const plugin of usable.values()) {
    for (const [dependencyId, range] of Object.entries(plugin.manifest.dependencies ?? {})) {
      const dependency = usable.get(dependencyId)
      if (dependency === undefined) {
        failures.push({
          source: plugin.root,
          reason: `dependency ${dependencyId} is not usable`,
        })
      } else if (!satisfies(dependency.manifest.version, range)) {
        failures.push({
          source: plugin.root,
          reason: `dependency ${dependencyId}@${dependency.manifest.version} does not satisfy ${range}`,
        })
      }
    }
  }

  const usableAfterDependencyCheck = new Map(
    [...usable].filter(
      ([id]) => !failures.some((failure) => usable.get(id)?.root === failure.source),
    ),
  )

  const ordered: DiscoveredPlugin[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string, path: string[]): void => {
    const current = state.get(id)
    if (current === 'done') return
    if (current === 'visiting') {
      failures.push({
        source: usableAfterDependencyCheck.get(id)?.root ?? id,
        reason: `dependency cycle: ${[...path, id].join(' -> ')}`,
      })
      return
    }

    const plugin = usableAfterDependencyCheck.get(id)
    if (plugin === undefined) return

    state.set(id, 'visiting')
    for (const dependencyId of Object.keys(plugin.manifest.dependencies ?? {}).sort()) {
      visit(dependencyId, [...path, id])
    }
    state.set(id, 'done')
    ordered.push(plugin)
  }

  for (const id of [...usableAfterDependencyCheck.keys()].sort()) {
    visit(id, [])
  }

  const excluded = new Set(
    failures
      .map(
        (failure) =>
          [...usableAfterDependencyCheck.values()].find((p) => p.root === failure.source)?.id,
      )
      .filter((id): id is string => id !== undefined),
  )

  return { ordered: ordered.filter((plugin) => !excluded.has(plugin.id)), failures }
}
