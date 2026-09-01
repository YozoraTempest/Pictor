// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { executeCommandAndWait } from '../commands/index.js'
import { pluginManagerSnapshotSchema } from '../shared/plugins.js'
import { createNodeCliDependencies } from './node-adapter.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'

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

it('activates Agent Workspace in the Node Host without loading GUI Modules', async () => {
  if (!(await stat(resolve('.pictor/bundled-plugins')).catch(() => null))) return
  const root = await mkdtemp(join(tmpdir(), 'pictor-cli-host-'))
  const userDataDirectory = join(root, 'user-data')
  const dependencies = createNodeCliDependencies({
    version: '0.4.0',
    projectRoot: resolve('.'),
    bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
    platform: 'linux',
    homeDirectory: root,
    environment: {},
  })
  const host = await dependencies.createApplicationHost({
    userData: {
      userDataDirectory,
      dataDirectory: join(userDataDirectory, 'data-v1'),
    },
    frontendLock: dependencies.createProfileLock(userDataDirectory),
    safeMode: false,
  })

  try {
    const services = await host.start()
    const snapshot = await executeCommandAndWait(
      services.commandClient,
      'plugin.list',
      null,
      { frontend: 'cli' },
      pluginManagerSnapshotSchema,
    )
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: agentWorkspaceContract.id, effectiveState: 'active' }),
        expect.objectContaining({
          id: 'pictor.workbench.delegate',
          effectiveState: 'blocked',
          reason: 'CLI does not load GUI Plugin Modules',
        }),
      ]),
    )
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})
