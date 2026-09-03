// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { createNodeCliDependencies } from './node-adapter.js'

it('assembles Node dependencies without an Electron import in src/cli', async () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const files = await readdir(directory)
  const sources = await Promise.all(
    files
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFile(join(directory, file), 'utf8')),
  )

  expect(sources.join('\n')).not.toMatch(/(?:from|import)\s*['"]electron['"]|require\(['"]electron/)
  expect(
    createNodeCliDependencies({
      version: '0.4.0',
      projectRoot: process.cwd(),
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: {},
    }),
  ).toMatchObject({ version: '0.4.0' })
})

it('uses the installed GUI profile name for packaged CLI defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pictor-packaged-profile-'))
  try {
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"version":"0.4.0"}\n')
    await writeFile(
      join(root, 'out', 'package-identity.json'),
      `${JSON.stringify({ version: '0.4.0', buildChannel: 'development', sourceCommit: null })}\n`,
    )
    const dependencies = createNodeCliDependencies({
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: {
        PICTOR_PACKAGED: '1',
        PICTOR_PACKAGE_ROOT: root,
        PICTOR_BUNDLED_PLUGINS_DIRECTORY: join(root, 'bundled-plugins'),
      },
    })

    expect(dependencies.resolveUserDataDirectory(null)).toBe('/home/test/.config/pictor')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
