// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
      version: '0.3.0',
      projectRoot: process.cwd(),
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: {},
    }),
  ).toMatchObject({ version: '0.3.0' })
})
