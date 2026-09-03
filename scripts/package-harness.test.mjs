import { describe, expect, it } from 'vitest'

import { findPackagedPageTarget, windowsProcessTreeKillArguments } from './package-harness.mjs'

describe('package harness', () => {
  it('accepts only the packaged application page target', () => {
    const packagedPage = { type: 'page', url: 'app://bundle/index.html', title: 'Pictor' }
    expect(
      findPackagedPageTarget([
        { type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
        { type: 'service_worker', url: 'app://bundle/index.html' },
        packagedPage,
      ]),
    ).toEqual(packagedPage)
    expect(findPackagedPageTarget([{ type: 'page', url: 'http://localhost' }])).toBeNull()
  })

  it('closes the complete Windows launcher process tree', () => {
    expect(windowsProcessTreeKillArguments(4321)).toEqual([
      '/d',
      '/c',
      'taskkill.exe',
      '/PID',
      '4321',
      '/T',
      '/F',
    ])
  })
})
