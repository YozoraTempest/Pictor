import { expect, it } from 'vitest'

import { appInfoSchema } from './app-info.js'

it('requires packaged build channels to identify their exact source commit', () => {
  const base = {
    name: 'Pictor',
    version: '0.3.0',
    platform: 'linux',
    arch: 'x64',
    distribution: 'arch',
  }

  expect(
    appInfoSchema.parse({ ...base, buildChannel: 'development', sourceCommit: null }),
  ).toMatchObject({ buildChannel: 'development', sourceCommit: null })
  expect(() =>
    appInfoSchema.parse({ ...base, buildChannel: 'nightly', sourceCommit: null }),
  ).toThrow('Packaged builds require an exact source commit')
  expect(
    appInfoSchema.parse({
      ...base,
      buildChannel: 'nightly',
      sourceCommit: 'a'.repeat(40),
    }),
  ).toMatchObject({ buildChannel: 'nightly', sourceCommit: 'a'.repeat(40) })
})
