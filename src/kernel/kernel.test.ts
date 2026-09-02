// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  ContributionPoint as SdkContributionPoint,
  Token as SdkToken,
  defineModule as defineSdkModule,
} from '@pictor/plugin-sdk/module'
import { ModuleKernel } from './kernel.js'
import { ContributionPoint, Token, defineModule } from './module.js'

describe('ModuleKernel', () => {
  it('activates providers before consumers and disposes modules in reverse order', async () => {
    const events: string[] = []
    const valueToken = new Token<number>('example.value')
    const labels = new ContributionPoint<string>('example.labels')
    const provider = defineModule({
      id: 'provider',
      provides: valueToken,
      activate(context) {
        events.push('start provider')
        context.onDispose({
          dispose: () => {
            events.push('stop provider')
          },
        })
        return 42
      },
    })
    const consumer = defineModule({
      id: 'consumer',
      requires: [valueToken] as const,
      activate(context, value) {
        events.push(`start consumer ${value}`)
        context.contribute(labels, 'ready')
        context.onDispose({
          dispose: () => {
            events.push('stop consumer')
          },
        })
      },
    })
    const kernel = new ModuleKernel()

    await kernel.start([consumer, provider])

    expect(kernel.get(valueToken)).toBe(42)
    expect(kernel.getContributions(labels)).toEqual(['ready'])
    await kernel.stop()
    expect(events).toEqual([
      'start provider',
      'start consumer 42',
      'stop consumer',
      'stop provider',
    ])
    expect(kernel.getContributions(labels)).toEqual([])
  })

  it('rejects duplicate modules and providers', async () => {
    const token = new Token<number>('duplicate.value')
    const module = defineModule({ id: 'same', provides: token, activate: () => 1 })
    const kernel = new ModuleKernel()

    await expect(kernel.start([module, module])).rejects.toThrow('Duplicate Module ID: same')

    const other = defineModule({ id: 'other', provides: token, activate: () => 2 })
    await expect(kernel.start([module, other])).rejects.toThrow(
      'Duplicate provider for duplicate.value',
    )
  })

  it('matches Tokens and Contribution Points by stable ID across bundled SDK copies', async () => {
    const provided = new SdkToken<number>('portable.value')
    const required = new Token<number>('portable.value')
    const contributed = new SdkContributionPoint<string>('portable.labels')
    const queried = new ContributionPoint<string>('portable.labels')
    const provider = defineSdkModule({ id: 'provider', provides: provided, activate: () => 42 })
    const consumer = defineModule({
      id: 'consumer',
      requires: [required] as const,
      activate(context, value) {
        context.contribute(contributed, `value ${value}`)
      },
    })
    const kernel = new ModuleKernel()

    await kernel.start([consumer, provider])

    expect(kernel.get(required)).toBe(42)
    expect(kernel.getContributions(queried)).toEqual(['value 42'])
    await kernel.stop()
  })

  it('rejects missing and circular dependencies', async () => {
    const firstToken = new Token<number>('first')
    const secondToken = new Token<number>('second')
    const missing = defineModule({
      id: 'missing',
      requires: [firstToken] as const,
      activate: () => undefined,
    })

    await expect(new ModuleKernel().start([missing])).rejects.toThrow(
      'Missing provider for first, required by missing',
    )

    const first = defineModule({
      id: 'first',
      requires: [secondToken] as const,
      provides: firstToken,
      activate: () => 1,
    })
    const second = defineModule({
      id: 'second',
      requires: [firstToken] as const,
      provides: secondToken,
      activate: () => 2,
    })
    await expect(new ModuleKernel().start([first, second])).rejects.toThrow(
      'Circular Module dependency',
    )
  })

  it('releases partial activation when a module fails', async () => {
    const dispose = vi.fn()
    const failing = defineModule({
      id: 'failing',
      activate(context) {
        context.onDispose({ dispose })
        throw new Error('activation failed')
      },
    })
    const kernel = new ModuleKernel()

    await expect(kernel.start([failing])).rejects.toThrow('activation failed')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
