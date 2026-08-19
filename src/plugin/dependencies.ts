import semver from 'semver'

import type { PluginManifest } from './manifest.js'
import type { PluginDesiredState } from './registry.js'

export type PluginBlockCode =
  | 'incompatible-host'
  | 'missing-dependency'
  | 'dependency-disabled'
  | 'incompatible-dependency'
  | 'circular-dependency'
  | 'dependency-blocked'

export interface PluginBlock {
  code: PluginBlockCode
  message: string
  dependencyId?: string
  chain?: readonly string[]
}

export interface PluginCandidate {
  manifest: PluginManifest
  desiredState: PluginDesiredState
}

export interface PluginDependencyPlan {
  activationOrder: readonly PluginCandidate[]
  blocks: ReadonlyMap<string, PluginBlock>
}

export function planPluginDependencies(
  candidates: readonly PluginCandidate[],
  pictorVersion: string,
): PluginDependencyPlan {
  const candidatesById = new Map<string, PluginCandidate>()
  for (const candidate of candidates) {
    const id = candidate.manifest.id
    if (candidatesById.has(id)) throw new Error(`Duplicate Plugin ID: ${id}`)
    candidatesById.set(id, candidate)
  }

  const blocks = new Map<string, PluginBlock>()
  const activationOrder: PluginCandidate[] = []
  const states = new Map<string, 'visiting' | 'visited'>()
  const stack: string[] = []

  const visit = (candidate: PluginCandidate): void => {
    const { id } = candidate.manifest
    if (states.get(id) === 'visited') return

    if (!semver.satisfies(pictorVersion, candidate.manifest.engines.pictor)) {
      blocks.set(id, {
        code: 'incompatible-host',
        message: `${id} requires Pictor ${candidate.manifest.engines.pictor}, current version is ${pictorVersion}`,
      })
      states.set(id, 'visited')
      return
    }

    states.set(id, 'visiting')
    stack.push(id)

    for (const [dependencyId, range] of Object.entries(candidate.manifest.dependencies)) {
      const dependency = candidatesById.get(dependencyId)
      if (!dependency || dependency.desiredState === 'removed') {
        blocks.set(id, {
          code: 'missing-dependency',
          dependencyId,
          message: `${id} requires missing Plugin ${dependencyId} ${range}`,
        })
        break
      }
      if (dependency.desiredState === 'disabled') {
        blocks.set(id, {
          code: 'dependency-disabled',
          dependencyId,
          message: `${id} requires disabled Plugin ${dependencyId}`,
        })
        break
      }
      if (!semver.satisfies(dependency.manifest.version, range)) {
        blocks.set(id, {
          code: 'incompatible-dependency',
          dependencyId,
          message: `${id} requires ${dependencyId} ${range}, installed version is ${dependency.manifest.version}`,
        })
        break
      }

      if (states.get(dependencyId) === 'visiting') {
        const cycleStart = stack.indexOf(dependencyId)
        const chain = [...stack.slice(cycleStart), dependencyId]
        for (const cycleId of new Set(chain)) {
          blocks.set(cycleId, {
            code: 'circular-dependency',
            chain,
            message: `Circular Plugin dependency: ${chain.join(' -> ')}`,
          })
        }
        break
      }

      visit(dependency)
      if (blocks.has(dependencyId)) {
        if (!blocks.has(id)) {
          blocks.set(id, {
            code: 'dependency-blocked',
            dependencyId,
            message: `${id} is blocked because ${dependencyId} cannot be activated`,
          })
        }
        break
      }
    }

    stack.pop()
    states.set(id, 'visited')
    if (!blocks.has(id)) activationOrder.push(candidate)
  }

  for (const candidate of candidates) {
    if (candidate.desiredState === 'enabled') visit(candidate)
  }

  return { activationOrder, blocks }
}
