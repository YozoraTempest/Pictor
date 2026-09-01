// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { ModuleRouter, moduleHandlerContributions } from '../../kernel/contract.js'
import { ModuleKernel } from '../../kernel/kernel.js'
import { createUpdaterMainModule } from './main.js'

const temporaryDirectories: string[] = []
const sourceCommit = 'a'.repeat(40)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function startUpdater(dataPath: string) {
  const kernel = new ModuleKernel()
  await kernel.start([
    createUpdaterMainModule({
      appInfo: {
        name: 'Pictor',
        version: '0.3.0',
        buildChannel: 'stable',
        sourceCommit,
        platform: 'linux',
        arch: 'x64',
        distribution: 'arch',
      },
      dataPath,
      fetch: vi.fn<typeof fetch>(),
      openExternal: vi.fn(async () => undefined),
    }),
  ])
  return {
    kernel,
    router: new ModuleRouter(kernel.getContributions(moduleHandlerContributions)),
  }
}

it('contributes the Updater snapshot and persists the selected channel', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'pictor-updater-'))
  temporaryDirectories.push(dataPath)
  const first = await startUpdater(dataPath)

  await expect(first.router.invoke('pictor.updater', 'getSnapshot', null)).resolves.toMatchObject({
    appInfo: { version: '0.3.0', buildChannel: 'stable', sourceCommit },
    channel: 'stable',
  })
  await expect(
    first.router.invoke('pictor.updater', 'setChannel', { channel: 'nightly' }),
  ).resolves.toMatchObject({ channel: 'nightly' })
  await first.kernel.stop()

  const persisted = JSON.parse(await readFile(join(dataPath, 'preferences.json'), 'utf8'))
  expect(persisted).toEqual({ schemaVersion: 1, channel: 'nightly' })

  const second = await startUpdater(dataPath)
  await expect(second.router.invoke('pictor.updater', 'getSnapshot', null)).resolves.toMatchObject({
    channel: 'nightly',
  })
  await second.kernel.stop()
})
