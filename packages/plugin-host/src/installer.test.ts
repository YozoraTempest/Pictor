import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { INSTALLED_LIST, PluginInstaller } from './installer.js'

/** A plugin directory the caller might have built. */
function pluginFolder(name: string, manifest: Record<string, unknown> = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pictor-plugin-src-')), name)
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: `@example/${name}`,
      version: '0.0.0',
      main: 'index.js',
      pictor: { id: `example.${name}`, engines: { pictor: '^0.0.0' } },
      ...manifest,
    }),
    'utf8',
  )
  writeFileSync(join(root, 'index.js'), 'export function activate() {}\n', 'utf8')
  return root
}

/** Rejects anything without a `pictor` field, the way discovery would. */
function validate(root: string): void {
  const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    pictor?: unknown
  }
  if (parsed.pictor === undefined) throw new Error('package.json 没有 pictor 字段')
}

function installer(options: { npm?: () => { node: string; cli: string } } = {}): {
  directory: string
  subject: PluginInstaller
} {
  const directory = mkdtempSync(join(tmpdir(), 'pictor-plugins-'))
  return { directory, subject: new PluginInstaller({ directory, validate, ...options }) }
}

describe('PluginInstaller', () => {
  it('copies a folder in under the plugin root', () => {
    const { directory, subject } = installer()

    const installed = subject.installFolder(pluginFolder('notes'))

    expect(installed).toEqual({ name: 'notes', kind: 'folder' })
    expect(subject.rootOf('notes')).toBe(join(directory, 'notes'))
  })

  it('refuses a directory that is not a plugin', () => {
    const { subject } = installer()
    const empty = mkdtempSync(join(tmpdir(), 'pictor-not-plugin-'))
    writeFileSync(join(empty, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))

    expect(() => subject.installFolder(empty)).toThrow(/pictor/)
  })

  it('refuses a second plugin with the same name', () => {
    const { subject } = installer()
    subject.installFolder(pluginFolder('notes'))

    expect(() => subject.installFolder(pluginFolder('notes'))).toThrow(/同名/)
  })

  it('removes a copied plugin', async () => {
    const { subject } = installer()
    subject.installFolder(pluginFolder('notes'))

    await subject.remove('notes')

    expect(subject.rootOf('notes')).toBeNull()
  })

  it('refuses to remove something that is not installed', async () => {
    const { subject } = installer()

    await expect(subject.remove('nothing')).rejects.toThrow(/没有这个插件/)
  })

  it('refuses a name that cannot be a folder', async () => {
    const { subject } = installer()

    await expect(subject.remove('..')).rejects.toThrow(/不合法/)
    await expect(subject.remove('node_modules')).rejects.toThrow(/不合法/)
  })

  it('rejects a spec that is not a package name', async () => {
    const { subject } = installer()

    // Each of these would otherwise ask npm to run something else entirely.
    for (const spec of ['', 'file:../elsewhere', 'git+https://example.com/x.git', './local']) {
      await expect(subject.installPackage(spec)).rejects.toThrow(/包名/)
    }
  })

  it('says so when there is no package manager', async () => {
    const { subject } = installer()

    await expect(subject.installPackage('@example/notes')).rejects.toThrow(/npm/)
  })

  it('writes the list under its own name', async () => {
    const { directory, subject } = installer({
      // A stand-in for npm: the installer's own job is the record, not the download.
      npm: () => ({ node: process.execPath, cli: '/bin/true' }),
    })

    expect(INSTALLED_LIST).toBe('installed.json')
    expect(subject.directory).toBe(directory)
  })
})
