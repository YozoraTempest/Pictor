import { describe, expect, it } from 'vitest'

import { KERNEL_VIEW_PREFIX, kernelOfView, kernelViewId } from './kernel-scope.js'

describe('kernel view ids', () => {
  it('names a page after the kernel it holds', () => {
    expect(kernelViewId('pi')).toBe(`${KERNEL_VIEW_PREFIX}pi`)
    expect(kernelOfView(kernelViewId('pi'))).toBe('pi')
  })

  it('round-trips a kernel id this build has never heard of', () => {
    // An installed kernel names itself, and the page follows: nothing here keeps a
    // list of the known ones.
    expect(kernelOfView(kernelViewId('plugin:weird id'))).toBe('plugin:weird id')
  })

  it('answers null for every view that is not one kernel’s', () => {
    expect(kernelOfView('home')).toBeNull()
    expect(kernelOfView('settings')).toBeNull()
    expect(kernelOfView('nonsense')).toBeNull()
    // A bare prefix names nobody, so it must not resolve to a kernel called "".
    expect(kernelOfView(KERNEL_VIEW_PREFIX)).toBeNull()
  })
})
