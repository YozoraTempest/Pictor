import { describe, expect, it } from 'vitest'

import type { KernelInfo } from '../../../../shared/bridge.js'
import { capabilitiesOf } from './capabilities.js'

function kernel(id: string, overrides: Partial<KernelInfo['capabilities']> = {}): KernelInfo {
  return {
    id,
    label: id,
    default: id === 'dsh',
    available: true,
    capabilities: { permission: true, model: true, skills: true, fork: true, ...overrides },
  }
}

const NO_SANDBOX = { permission: false, model: false, skills: false, fork: false }

describe('capabilitiesOf', () => {
  it('answers with what the conversation’s own kernel declares', () => {
    const kernels = [kernel('dsh'), kernel('pi', NO_SANDBOX)]

    expect(capabilitiesOf(kernels, 'dsh').permission).toBe(true)
    expect(capabilitiesOf(kernels, 'pi').permission).toBe(false)
    expect(capabilitiesOf(kernels, 'pi').fork).toBe(false)
  })

  it('assumes everything for a kernel this build does not know', () => {
    // A conversation filed under a kernel that has since been removed still has to
    // open: hiding every control would read as a broken app, and the turn itself
    // fails with a message that names the missing kernel.
    const everything = capabilitiesOf([kernel('dsh')], 'gone')

    expect(everything).toEqual({ permission: true, model: true, skills: true, fork: true })
  })

  it('assumes everything before the list has loaded', () => {
    expect(capabilitiesOf([], 'pi')).toEqual({
      permission: true,
      model: true,
      skills: true,
      fork: true,
    })
  })

  it('assumes everything for a conversation that is not saved yet', () => {
    // A draft has no kernel until its first prompt files it under the default.
    expect(capabilitiesOf([kernel('pi', NO_SANDBOX)], null).model).toBe(true)
  })
})
