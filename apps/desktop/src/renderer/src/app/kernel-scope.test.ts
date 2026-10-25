import { describe, expect, it } from 'vitest'

import { kernelScopeOf } from './kernel-scope.js'

describe('kernelScopeOf', () => {
  it('answers with the kernel of a kernel page', () => {
    expect(kernelScopeOf('dsh')).toBe('dsh')
    expect(kernelScopeOf('pi')).toBe('pi')
  })

  it('scopes nothing else', () => {
    // Home is the page that spans every kernel; settings is not about kernels at
    // all. A new view has to opt in by appearing in the rail's kernel list.
    expect(kernelScopeOf('home')).toBeNull()
    expect(kernelScopeOf('settings')).toBeNull()
    expect(kernelScopeOf('nonsense')).toBeNull()
  })
})
