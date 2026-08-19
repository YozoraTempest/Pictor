import { ModuleKernel } from '../kernel/kernel.js'
import type { ContributionPoint, PictorModule, Token } from '../kernel/module.js'
import { planPluginDependencies, type PluginCandidate } from './dependencies.js'
import type { PluginManifest } from './manifest.js'
import type { PluginDesiredState } from './registry.js'

export type PluginEffectiveState = 'active' | 'disabled' | 'blocked' | 'failed'

export interface PluginDefinition extends PluginCandidate {
  createModules(): readonly PictorModule[] | Promise<readonly PictorModule[]>
}

export interface PluginStatus {
  id: string
  version: string
  desiredState: PluginDesiredState
  effectiveState: PluginEffectiveState
  reason?: string
}

export interface PluginHostOptions {
  pictorVersion: string
  safeMode?: boolean
}

interface ActivePlugin {
  id: string
  kernel: ModuleKernel
}

export class PluginHost {
  private readonly activePlugins: ActivePlugin[] = []
  private statuses: PluginStatus[] = []
  private started = false

  constructor(private readonly options: PluginHostOptions) {}

  async start(definitions: readonly PluginDefinition[]): Promise<readonly PluginStatus[]> {
    if (this.started) throw new Error('Plugin Host has already started')
    this.started = true

    const plan = planPluginDependencies(definitions, this.options.pictorVersion)
    const definitionsById = new Map(
      definitions.map((definition) => [definition.manifest.id, definition]),
    )
    const statuses = new Map<string, PluginStatus>()

    for (const definition of definitions) {
      const { id, version } = definition.manifest
      const block = plan.blocks.get(id)
      if (definition.desiredState !== 'enabled') {
        statuses.set(id, this.status(definition, 'disabled'))
      } else if (this.options.safeMode) {
        statuses.set(id, this.status(definition, 'disabled', 'Safe mode ignores all Plugins'))
      } else if (block) {
        statuses.set(id, this.status(definition, 'blocked', block.message))
      } else {
        statuses.set(id, { id, version, desiredState: 'enabled', effectiveState: 'blocked' })
      }
    }

    if (!this.options.safeMode) {
      for (const candidate of plan.activationOrder) {
        const definition = definitionsById.get(candidate.manifest.id)
        if (!definition) continue

        const unavailableDependency = Object.keys(definition.manifest.dependencies).find(
          (dependencyId) => statuses.get(dependencyId)?.effectiveState !== 'active',
        )
        if (unavailableDependency) {
          statuses.set(
            definition.manifest.id,
            this.status(
              definition,
              'blocked',
              `${definition.manifest.id} is blocked because ${unavailableDependency} did not activate`,
            ),
          )
          continue
        }

        const kernel = new ModuleKernel()
        try {
          await kernel.start(await definition.createModules())
          this.activePlugins.push({ id: definition.manifest.id, kernel })
          statuses.set(definition.manifest.id, this.status(definition, 'active'))
        } catch (error) {
          statuses.set(
            definition.manifest.id,
            this.status(
              definition,
              'failed',
              error instanceof Error ? error.message : String(error),
            ),
          )
        }
      }
    }

    this.statuses = definitions.map((definition) => {
      const status = statuses.get(definition.manifest.id)
      if (!status) throw new Error(`Missing Plugin status: ${definition.manifest.id}`)
      return status
    })
    return this.getStatuses()
  }

  getStatuses(): readonly PluginStatus[] {
    return this.statuses.map((status) => ({ ...status }))
  }

  get<T>(token: Token<T>): T {
    const providers = this.activePlugins.filter(({ kernel }) => kernel.has(token))
    if (providers.length === 0) throw new Error(`Plugin capability is unavailable: ${token.id}`)
    if (providers.length > 1) throw new Error(`Duplicate Plugin capability: ${token.id}`)
    return providers[0]!.kernel.get(token)
  }

  getContributions<T>(point: ContributionPoint<T>): readonly T[] {
    return this.activePlugins.flatMap(({ kernel }) => kernel.getContributions(point))
  }

  async stop(): Promise<void> {
    for (const active of this.activePlugins.toReversed()) await active.kernel.stop()
    this.activePlugins.length = 0
    this.started = false
  }

  private status(
    definition: { manifest: PluginManifest; desiredState: PluginDesiredState },
    effectiveState: PluginEffectiveState,
    reason?: string,
  ): PluginStatus {
    const status: PluginStatus = {
      id: definition.manifest.id,
      version: definition.manifest.version,
      desiredState: definition.desiredState,
      effectiveState,
    }
    if (reason) status.reason = reason
    return status
  }
}
