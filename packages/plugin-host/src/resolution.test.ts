import { describe, expect, it } from 'vitest'

import type { DiscoveredPlugin } from './registry.js'
import { resolveActivationOrder } from './resolution.js'

function plugin(
  id: string,
  options: {
    version?: string
    engine?: string
    dependencies?: Record<string, string>
  } = {},
): DiscoveredPlugin {
  return {
    id,
    root: `/plugins/${id}`,
    manifestPath: `/plugins/${id}/manifest.json`,
    manifest: {
      id,
      name: id,
      version: options.version ?? '1.0.0',
      main: 'dist/index.js',
      engines: { pictor: options.engine ?? '^1.0.0' },
      ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
    },
  }
}

describe('resolveActivationOrder', () => {
  it('orders dependencies before dependents', () => {
    const result = resolveActivationOrder(
      [plugin('app', { dependencies: { base: '^1.0.0' } }), plugin('base')],
      '1.2.0',
    )

    expect(result.ordered.map((entry) => entry.id)).toEqual(['base', 'app'])
    expect(result.failures).toEqual([])
  })

  it('rejects an incompatible engine range', () => {
    const result = resolveActivationOrder([plugin('app', { engine: '^2.0.0' })], '1.0.0')

    expect(result.ordered).toEqual([])
    expect(result.failures[0]?.reason).toMatch(/requires pictor \^2\.0\.0/)
  })

  it('rejects a missing dependency', () => {
    const result = resolveActivationOrder(
      [plugin('app', { dependencies: { missing: '^1.0.0' } })],
      '1.0.0',
    )

    expect(result.ordered).toEqual([])
    expect(result.failures[0]?.reason).toMatch(/missing dependency: missing/)
  })

  it('rejects a dependency whose version does not satisfy the range', () => {
    const result = resolveActivationOrder(
      [plugin('app', { dependencies: { base: '^2.0.0' } }), plugin('base', { version: '1.0.0' })],
      '1.0.0',
    )

    expect(result.ordered.map((entry) => entry.id)).not.toContain('app')
    expect(result.failures.some((failure) => /does not satisfy/.test(failure.reason))).toBe(true)
  })

  it('detects cycles', () => {
    const result = resolveActivationOrder(
      [
        plugin('a', { dependencies: { b: '^1.0.0' } }),
        plugin('b', { dependencies: { a: '^1.0.0' } }),
      ],
      '1.0.0',
    )

    expect(result.failures.some((failure) => /cycle/.test(failure.reason))).toBe(true)
  })
})
