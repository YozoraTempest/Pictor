// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, expect, it } from 'vitest'

import type { ApplicationHost } from '../../src/application/index.js'
import { createNodeCliDependencies } from '../../src/cli/node-adapter.js'
import { ContributionPoint } from '../../src/kernel/module.js'
import { agentWorkspaceContract } from '../../src/modules/agent-workspace/shared.js'
import { createTuiNodeApplication, createTuiProfileLock } from '../../src/tui/node-adapter.js'

const pluginsRoot = resolve('plugins')
const allowedModules = new Set(['host', 'gui', 'tui', 'runtime'])
const execFileAsync = promisify(execFile)
const guiWorkbenchContributions = new ContributionPoint<unknown>('gui.workbenches')

let root = ''
let bundledPluginsDirectory = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pictor-bundled-plugins-'))
  bundledPluginsDirectory = join(root, 'bundled-plugins')
  await execFileAsync(process.execPath, [resolve('scripts/build-plugins.mjs')], {
    cwd: resolve('.'),
    env: { ...process.env, PICTOR_BUNDLED_PLUGINS_OUTPUT: bundledPluginsDirectory },
  })
}, 60_000)

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

it('declares only 0.4 manifests and explicit Host/GUI/TUI/Runtime entries', async () => {
  const directories = await readdir(pluginsRoot, { withFileTypes: true })
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    const manifest = JSON.parse(
      await readFile(join(pluginsRoot, directory.name, 'manifest.json'), 'utf8'),
    ) as {
      version?: string
      engines?: { pictor?: string }
      modules?: Record<string, string>
    }
    expect(manifest.version, directory.name).toBe('0.4.0')
    expect(manifest.engines?.pictor, directory.name).toBe('^0.4.0')
    expect(Object.keys(manifest.modules ?? {}).every((key) => allowedModules.has(key))).toBe(true)
    expect(manifest.modules, directory.name).not.toHaveProperty('main')
    expect(manifest.modules, directory.name).not.toHaveProperty('renderer')
  }
})

it('builds bundled packages with declared entries and no legacy dist entry', async () => {
  const directories = await readdir(bundledPluginsDirectory, { withFileTypes: true })
  const packages = directories.filter((directory) => directory.isDirectory())
  expect(packages.length).toBeGreaterThan(0)
  for (const directory of packages) {
    const packageRoot = join(bundledPluginsDirectory, directory.name)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')) as {
      modules?: Record<string, string>
    }
    expect(await stat(join(packageRoot, 'dist', 'main.js')).catch(() => null)).toBeNull()
    expect(await stat(join(packageRoot, 'dist', 'renderer.js')).catch(() => null)).toBeNull()
    for (const entry of Object.values(manifest.modules ?? {})) {
      await expect(stat(join(packageRoot, entry))).resolves.toBeTruthy()
    }
  }
})

it('activates Agent Workspace in the Node Host without loading GUI Modules', async () => {
  const userDataDirectory = join(root, 'cli-user-data')
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
})

it('activates the default TUI Host Profile without Updater failures', async () => {
  const userDataDirectory = join(root, 'tui-user-data')
  const application = await createTuiNodeApplication(
    {
      userData: {
        userDataDirectory,
        dataDirectory: join(userDataDirectory, 'data-v1'),
      },
      frontendLock: createTuiProfileLock(userDataDirectory),
      safeMode: false,
    },
    {
      version: '0.4.0',
      projectRoot: resolve('.'),
      bundledPluginsDirectory,
      platform: 'linux',
      homeDirectory: root,
      environment: {},
      emit: () => undefined,
    },
  )

  try {
    const services = await application.applicationHost.start()
    const statuses = services.pluginHost.getStatuses()
    expect(statuses.filter(({ effectiveState }) => effectiveState === 'failed')).toEqual([])
    expect(statuses.filter(({ effectiveState }) => effectiveState === 'blocked')).toEqual([])
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'pictor.updater', effectiveState: 'active' }),
      ]),
    )
  } finally {
    await application.applicationHost.stop()
  }
}, 60_000)
