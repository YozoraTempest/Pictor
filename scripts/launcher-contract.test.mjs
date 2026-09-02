// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, it } from 'vitest'

it('keeps the POSIX and Windows launchers on the three-Frontend contract', async () => {
  const posix = await readFile(resolve('packaging', 'posix', 'pictor'), 'utf8')
  const windows = await readFile(resolve('packaging', 'windows', 'pictor.cmd'), 'utf8')

  for (const source of [posix, windows]) {
    expect(source).toContain('PICTOR_PACKAGE_ROOT')
    expect(source).toContain('PICTOR_BUNDLED_PLUGINS_DIRECTORY')
    expect(source).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(source).toContain('out')
    expect(source).toContain('cli')
    expect(source).toContain('tui')
    expect(source).toContain('Pictor')
  }
  expect(posix).toContain('unset ELECTRON_RUN_AS_NODE')
  expect(windows).toContain('set "ELECTRON_RUN_AS_NODE="')
  expect(posix).not.toMatch(/\b(?:node|nodejs)\b/)
  expect(windows).not.toMatch(/\bnode(?:\.exe)?\b/i)
})
