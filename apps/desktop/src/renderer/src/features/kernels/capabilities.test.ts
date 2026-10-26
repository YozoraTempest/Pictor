import { describe, expect, it } from 'vitest'

import type { KernelInfo } from '../../../../shared/bridge.js'
import { capabilitiesOf, modelSourceOf } from './capabilities.js'

function kernel(id: string, overrides: Partial<KernelInfo['capabilities']> = {}): KernelInfo {
  return {
    id,
    label: id,
    default: id === 'dsh',
    available: true,
    capabilities: {
      permission: true,
      approval: true,
      model: true,
      skills: true,
      fork: true,
      commands: true,
      jobs: true,
      ...overrides,
    },
    modelSource: 'pictor',
  }
}

const NO_SANDBOX = {
  permission: false,
  approval: false,
  model: false,
  skills: false,
  fork: false,
  commands: false,
  jobs: false,
}

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

    expect(everything).toEqual({
      permission: true,
      approval: true,
      model: true,
      skills: true,
      fork: true,
      commands: true,
      jobs: true,
    })
  })

  it('assumes everything before the list has loaded', () => {
    expect(capabilitiesOf([], 'pi')).toEqual({
      permission: true,
      approval: true,
      model: true,
      skills: true,
      fork: true,
      commands: true,
      jobs: true,
    })
  })

  it('assumes everything for a conversation that is not saved yet', () => {
    // A draft has no kernel until its first prompt files it under the default.
    expect(capabilitiesOf([kernel('pi', NO_SANDBOX)], null).model).toBe(true)
  })
})

describe('modelSourceOf', () => {
  it('tells the kernel that brings its own models apart from Pictor’s', () => {
    const kernels = [
      { ...kernel('dsh'), modelSource: 'pictor' as const },
      { ...kernel('pi'), modelSource: 'kernel' as const },
    ]

    expect(modelSourceOf(kernels, 'dsh')).toBe('pictor')
    expect(modelSourceOf(kernels, 'pi')).toBe('kernel')
  })

  it('falls back to Pictor’s list before the kernels have loaded', () => {
    // The status quo: an unknown kernel keeps the picker the app always drew.
    expect(modelSourceOf([], 'pi')).toBe('pictor')
    expect(modelSourceOf([], null)).toBe('pictor')
  })
})
