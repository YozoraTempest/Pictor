// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

const pluginsRoot = resolve('plugins')
const allowedModules = new Set(['host', 'gui', 'tui', 'runtime'])
const execFileAsync = promisify(execFile)

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
  const root = await mkdtemp(join(tmpdir(), 'pictor-plugin-manifest-boundary-'))
  try {
    const bundledRoot = join(root, 'bundled-plugins')
    await execFileAsync(process.execPath, [resolve('scripts/build-plugins.mjs')], {
      cwd: resolve('.'),
      env: { ...process.env, PICTOR_BUNDLED_PLUGINS_OUTPUT: bundledRoot },
    })
    const directories = await readdir(bundledRoot, { withFileTypes: true })
    const packages = directories.filter((directory) => directory.isDirectory())
    expect(packages.length).toBeGreaterThan(0)
    for (const directory of packages) {
      const packageRoot = join(bundledRoot, directory.name)
      const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')) as {
        modules?: Record<string, string>
      }
      expect(await stat(join(packageRoot, 'dist', 'main.js')).catch(() => null)).toBeNull()
      expect(await stat(join(packageRoot, 'dist', 'renderer.js')).catch(() => null)).toBeNull()
      for (const entry of Object.values(manifest.modules ?? {})) {
        await expect(stat(join(packageRoot, entry))).resolves.toBeTruthy()
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
