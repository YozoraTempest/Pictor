import { describe, expect, it } from 'vitest'

import {
  KernelContributionError,
  parseKernelContribution,
  parseKernelContributions,
} from './kernel.js'

describe('parseKernelContribution', () => {
  it('accepts an entry and a label', () => {
    expect(parseKernelContribution({ main: 'kernel.js', label: 'Codex' })).toEqual({
      main: 'kernel.js',
      label: 'Codex',
    })
  })

  it('accepts an entry with no label', () => {
    expect(parseKernelContribution({ main: 'dist/kernel.mjs' })).toEqual({
      main: 'dist/kernel.mjs',
    })
  })

  it('refuses an entry that climbs out of the plugin root', () => {
    expect(() => parseKernelContribution({ main: '../outside.js' })).toThrow(
      KernelContributionError,
    )
  })

  it('refuses an absolute entry', () => {
    expect(() => parseKernelContribution({ main: '/etc/passwd' })).toThrow(/inside/)
  })

  it('refuses a missing entry', () => {
    expect(() => parseKernelContribution({ label: 'Codex' })).toThrow(/main/)
  })

  it('refuses a label that is not a name', () => {
    expect(() => parseKernelContribution({ main: 'kernel.js', label: '  ' })).toThrow(/label/)
    expect(() => parseKernelContribution({ main: 'kernel.js', label: 'x'.repeat(61) })).toThrow(
      /label/,
    )
  })
})

describe('parseKernelContributions', () => {
  it('keeps the good payloads when one is broken', () => {
    const parsed = parseKernelContributions([{ main: 'a.js' }, { main: '../b.js' }])

    expect(parsed.kernels).toEqual([{ main: 'a.js' }])
    expect(parsed.failures).toHaveLength(1)
  })
})
