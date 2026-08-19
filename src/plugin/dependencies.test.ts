// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { planPluginDependencies, type PluginCandidate } from './dependencies.js'
import { pluginManifestSchema } from './manifest.js'
import type { PluginDesiredState } from './registry.js'

function candidate(
  id: string,
  dependencies: Record<string, string> = {},
  options: {
    version?: string
    engine?: string
    desiredState?: PluginDesiredState
  } = {},
): PluginCandidate {
  return {
    manifest: pluginManifestSchema.parse({
      id,
      name: id,
      version: options.version ?? '1.0.0',
      engines: { pictor: options.engine ?? '^0.2.0' },
      dependencies,
      modules: {},
    }),
    desiredState: options.desiredState ?? 'enabled',
  }
}

describe('Plugin dependency planning', () => {
  it('orders dependencies before consumers', () => {
    const workspace = candidate('pictor.workspace', { 'pictor.runtime': '^1.0.0' })
    const runtime = candidate('pictor.runtime')

    const plan = planPluginDependencies([workspace, runtime], '0.2.1')

    expect(plan.activationOrder.map(({ manifest }) => manifest.id)).toEqual([
      'pictor.runtime',
      'pictor.workspace',
    ])
    expect(plan.blocks.size).toBe(0)
  })

  it('explains missing, disabled, incompatible, and host-version blocks', () => {
    const missing = candidate('pictor.missing-consumer', { 'pictor.absent': '^1.0.0' })
    const disabledProvider = candidate('pictor.disabled-provider', {}, { desiredState: 'disabled' })
    const disabledConsumer = candidate('pictor.disabled-consumer', {
      'pictor.disabled-provider': '^1.0.0',
    })
    const oldProvider = candidate('pictor.old-provider', {}, { version: '1.0.0' })
    const newConsumer = candidate('pictor.new-consumer', { 'pictor.old-provider': '^2.0.0' })
    const future = candidate('pictor.future', {}, { engine: '^9.0.0' })

    const plan = planPluginDependencies(
      [missing, disabledProvider, disabledConsumer, oldProvider, newConsumer, future],
      '0.2.1',
    )

    expect(plan.blocks.get('pictor.missing-consumer')?.code).toBe('missing-dependency')
    expect(plan.blocks.get('pictor.disabled-consumer')?.code).toBe('dependency-disabled')
    expect(plan.blocks.get('pictor.new-consumer')?.code).toBe('incompatible-dependency')
    expect(plan.blocks.get('pictor.future')?.code).toBe('incompatible-host')
    expect(plan.activationOrder.map(({ manifest }) => manifest.id)).toEqual(['pictor.old-provider'])
  })

  it('reports a complete cycle and blocks transitive consumers', () => {
    const outer = candidate('pictor.outer', { 'pictor.first': '^1.0.0' })
    const first = candidate('pictor.first', { 'pictor.second': '^1.0.0' })
    const second = candidate('pictor.second', { 'pictor.first': '^1.0.0' })

    const plan = planPluginDependencies([outer, first, second], '0.2.1')

    expect(plan.blocks.get('pictor.first')).toMatchObject({
      code: 'circular-dependency',
      chain: ['pictor.first', 'pictor.second', 'pictor.first'],
    })
    expect(plan.blocks.get('pictor.second')?.code).toBe('circular-dependency')
    expect(plan.blocks.get('pictor.outer')?.code).toBe('dependency-blocked')
    expect(plan.activationOrder).toEqual([])
  })

  it('recovers consumers when a compatible removed provider is reinstalled', () => {
    const consumer = candidate('pictor.consumer', { 'pictor.provider': '^1.0.0' })
    const removed = candidate('pictor.provider', {}, { desiredState: 'removed' })
    expect(
      planPluginDependencies([consumer, removed], '0.2.1').blocks.get('pictor.consumer')?.code,
    ).toBe('missing-dependency')

    const restored = candidate('pictor.provider')
    expect(
      planPluginDependencies([consumer, restored], '0.2.1').activationOrder.map(
        ({ manifest }) => manifest.id,
      ),
    ).toEqual(['pictor.provider', 'pictor.consumer'])
  })
})
