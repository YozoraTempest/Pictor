import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { KernelInstaller } from './installer.js'

/** A profile directory, and a kernel folder that a person could have built. */
function workspace(): { userData: string; installer: KernelInstaller } {
  const userData = mkdtempSync(join(tmpdir(), 'pictor-kernels-'))
  return { userData, installer: new KernelInstaller({ userData }) }
}

function kernelFolder(name: string, manifest: Record<string, unknown> = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pictor-kernel-src-')), name)
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'example',
      version: '0.0.0',
      type: 'module',
      main: 'index.js',
      ...manifest,
    }),
    'utf8',
  )
  writeFileSync(join(root, 'index.js'), 'export function apply() {}\n', 'utf8')
  return root
}

describe('KernelInstaller', () => {
  it('copies a folder in and leaves it where the host looks', () => {
    const { userData, installer } = workspace()
    const source = kernelFolder('echo')

    const installed = installer.installFolder(source)

    expect(installed).toEqual({ name: 'echo', kind: 'folder' })
    const manifest = JSON.parse(
      readFileSync(join(userData, 'kernels/echo/package.json'), 'utf8'),
    ) as { main: string }
    expect(manifest.main).toBe('index.js')
  })

  it('refuses a directory that is not a package', () => {
    const { installer } = workspace()
    const empty = mkdtempSync(join(tmpdir(), 'pictor-empty-'))

    expect(() => installer.installFolder(empty)).toThrow(/package\.json/)
  })

  it('refuses a package whose entry point is missing', () => {
    const { installer } = workspace()
    const source = kernelFolder('broken', { main: 'dist/gone.js' })

    expect(() => installer.installFolder(source)).toThrow(/main/)
  })

  it('refuses a second kernel with the same name', () => {
    const { installer } = workspace()
    installer.installFolder(kernelFolder('echo'))

    expect(() => installer.installFolder(kernelFolder('echo'))).toThrow(/同名/)
  })

  it('removes a copied kernel', async () => {
    const { userData, installer } = workspace()
    installer.installFolder(kernelFolder('echo'))

    await installer.remove('echo')

    expect(() => readFileSync(join(userData, 'kernels/echo/package.json'), 'utf8')).toThrow()
  })

  it('refuses to remove something that is not installed', async () => {
    const { installer } = workspace()

    await expect(installer.remove('nothing')).rejects.toThrow(/没有这个内核/)
  })

  it('rejects a package spec that is not a package name', async () => {
    const { installer } = workspace()

    // Each of these would otherwise ask npm to run something else entirely.
    for (const spec of ['', 'file:../elsewhere', 'git+https://example.com/x.git', './local']) {
      await expect(installer.installPackage(spec)).rejects.toThrow(/包名/)
    }
  })

  it('rejects a name that cannot be a folder', async () => {
    const { installer } = workspace()

    await expect(installer.remove('..')).rejects.toThrow(/不合法/)
    await expect(installer.remove('node_modules')).rejects.toThrow(/不合法/)
  })
})
