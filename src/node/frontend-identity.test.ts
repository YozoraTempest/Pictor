import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, it } from 'vitest'

import { resolveFrontendIdentity } from './frontend-identity.js'

it('resolves packaged identity only from the launcher-provided package root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pictor-frontend-identity-'))
  try {
    await mkdir(join(root, 'resources', 'bundled-plugins'), { recursive: true })
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"version":"0.4.0"}\n')
    await writeFile(
      join(root, 'out', 'package-identity.json'),
      `${JSON.stringify({
        version: '0.4.0',
        buildChannel: 'stable',
        sourceCommit: 'a'.repeat(40),
      })}\n`,
    )

    const identity = resolveFrontendIdentity({
      environment: {
        PICTOR_PACKAGED: '1',
        PICTOR_PACKAGE_ROOT: root,
        PICTOR_BUNDLED_PLUGINS_DIRECTORY: join(root, 'resources', 'bundled-plugins'),
      },
    })

    expect(identity).toMatchObject({
      packageRoot: root,
      bundledPluginsDirectory: join(root, 'resources', 'bundled-plugins'),
      version: '0.4.0',
      buildChannel: 'stable',
      sourceCommit: 'a'.repeat(40),
      packaged: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a packaged launch without explicit package identity', () => {
  expect(() =>
    resolveFrontendIdentity({
      environment: { PICTOR_PACKAGED: '1' },
    }),
  ).toThrow('PICTOR_PACKAGE_ROOT')
})
