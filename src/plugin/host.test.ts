// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { ContributionPoint, Token, defineModule } from '../kernel/module.js'
import { PluginHost, type PluginDefinition } from './host.js'
import { pluginManifestSchema } from './manifest.js'

function plugin(
  id: string,
  dependencies: Record<string, string>,
  createModules: PluginDefinition['createModules'],
): PluginDefinition {
  return {
    manifest: pluginManifestSchema.parse({
      id,
      name: id,
      version: '1.0.0',
      engines: { pictor: '^0.2.0' },
      dependencies,
      modules: {},
    }),
    desiredState: 'enabled',
    createModules,
  }
}

describe('PluginHost', () => {
  it('isolates activation failure and only blocks transitive dependents', async () => {
    const provider = plugin('pictor.provider', {}, () => [
      defineModule({
        id: 'provider.host',
        activate: () => {
          throw new Error('provider failed')
        },
      }),
    ])
    const consumerFactory = vi.fn(() => [])
    const consumer = plugin('pictor.consumer', { 'pictor.provider': '^1.0.0' }, consumerFactory)
    const independent = plugin('pictor.independent', {}, () => [
      defineModule({ id: 'independent.host', activate: () => undefined }),
    ])
    const host = new PluginHost({ pictorVersion: '0.2.1' })

    await expect(host.start([consumer, provider, independent])).resolves.toEqual([
      expect.objectContaining({ id: 'pictor.consumer', effectiveState: 'blocked' }),
      expect.objectContaining({ id: 'pictor.provider', effectiveState: 'failed' }),
      expect.objectContaining({ id: 'pictor.independent', effectiveState: 'active' }),
    ])
    expect(consumerFactory).not.toHaveBeenCalled()
    await host.stop()
  })

  it('uses one Module Kernel per Plugin and stops in reverse dependency order', async () => {
    const events: string[] = []
    const sharedToken = new Token<string>('same-token-id')
    const provider = plugin('pictor.provider', {}, () => [
      defineModule({
        id: 'same-module-id',
        provides: sharedToken,
        activate(context) {
          events.push('start provider')
          context.onDispose({
            dispose: () => {
              events.push('stop provider')
            },
          })
          return 'provider'
        },
      }),
    ])
    const consumer = plugin('pictor.consumer', { 'pictor.provider': '^1.0.0' }, () => [
      defineModule({
        id: 'same-module-id',
        provides: sharedToken,
        activate(context) {
          events.push('start consumer')
          context.onDispose({
            dispose: () => {
              events.push('stop consumer')
            },
          })
          return 'consumer'
        },
      }),
    ])
    const host = new PluginHost({ pictorVersion: '0.2.1' })

    await host.start([consumer, provider])
    await host.stop()

    expect(events).toEqual(['start provider', 'start consumer', 'stop consumer', 'stop provider'])
  })

  it('starts an empty Core Host and ignores factories in safe mode', async () => {
    const factory = vi.fn(() => [])
    const host = new PluginHost({ pictorVersion: '0.2.1', safeMode: true })

    expect(await host.start([])).toEqual([])
    await host.stop()
    expect(await host.start([plugin('pictor.example', {}, factory)])).toEqual([
      expect.objectContaining({ id: 'pictor.example', effectiveState: 'disabled' }),
    ])
    expect(factory).not.toHaveBeenCalled()
    await host.stop()
  })

  it('aggregates contributions from active Plugin Kernels by stable ID', async () => {
    const contributed = new ContributionPoint<string>('example.labels')
    const queried = new ContributionPoint<string>('example.labels')
    const host = new PluginHost({ pictorVersion: '0.2.1' })

    await host.start([
      plugin('pictor.first', {}, () => [
        defineModule({
          id: 'first.host',
          activate: (context) => context.contribute(contributed, 'first'),
        }),
      ]),
      plugin('pictor.second', {}, () => [
        defineModule({
          id: 'second.host',
          activate: (context) => context.contribute(contributed, 'second'),
        }),
      ]),
    ])

    expect(host.getContributions(queried)).toEqual(['first', 'second'])
    await host.stop()
  })
})
