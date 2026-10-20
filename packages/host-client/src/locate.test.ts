import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveHostCoreBinary } from './locate.js'

describe('resolveHostCoreBinary', () => {
  it('prefers an explicit override', () => {
    const binary = resolveHostCoreBinary({
      appRoot: '/nowhere',
      env: { PICTOR_HOST_CORE: '/custom/host-core' },
    })

    expect(binary).toBe('/custom/host-core')
  })

  it('finds a release build before a debug build', () => {
    const root = mkdtempSync(join(tmpdir(), 'pictor-locate-'))
    const executable = process.platform === 'win32' ? 'pictor-host-core.exe' : 'pictor-host-core'

    for (const profile of ['release', 'debug']) {
      const directory = join(root, 'target', profile)
      const path = join(directory, executable)
      mkdirSync(directory, { recursive: true })
      writeFileSync(path, '')
    }

    expect(resolveHostCoreBinary({ appRoot: root, env: {} })).toBe(
      join(root, 'target', 'release', executable),
    )
  })

  it('fails with an actionable message when nothing is found', () => {
    expect(() => resolveHostCoreBinary({ appRoot: '/nowhere', env: {} })).toThrow(
      /cargo build -p pictor-host-core/,
    )
  })
})
