// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import type { ApplicationHost } from '../application/index.js'
import { ContributionPoint } from '../kernel/module.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import { createNodeCliDependencies } from './node-adapter.js'

const execFileAsync = promisify(execFile)
const guiWorkbenchContributions = new ContributionPoint<unknown>('gui.workbenches')

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

it('activates Agent Workspace in the Node Host without loading GUI Modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pictor-cli-host-'))
  try {
    const bundledPluginsDirectory = join(root, 'bundled-plugins')
    await execFileAsync(process.execPath, [resolve('scripts/build-plugins.mjs')], {
      cwd: resolve('.'),
      env: { ...process.env, PICTOR_BUNDLED_PLUGINS_OUTPUT: bundledPluginsDirectory },
    })
    const userDataDirectory = join(root, 'user-data')
    const dependencies = createNodeCliDependencies({
      version: '0.4.0',
      projectRoot: resolve('.'),
      bundledPluginsDirectory,
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
      const services = (await host.start()) as Awaited<ReturnType<ApplicationHost['start']>>
      await expect(
        services.moduleRouter.invoke(agentWorkspaceContract.id, 'getSnapshot', null),
      ).resolves.toMatchObject({ ok: true, value: { projects: [], sessions: [] } })
      expect(services.pluginHost.getContributions(guiWorkbenchContributions)).toEqual([])
    } finally {
      await host.stop()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
