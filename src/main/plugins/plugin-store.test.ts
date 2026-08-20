// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PluginStore } from './plugin-store.js'

describe('PluginStore', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function createStoreFixture(): Promise<{
    root: string
    userData: string
    bundled: string
  }> {
    const root = await mkdtemp(join(tmpdir(), 'pictor-plugin-store-'))
    roots.push(root)
    const userData = join(root, 'user-data')
    const bundled = join(root, 'bundled-plugins')
    await mkdir(bundled, { recursive: true })
    return { root, userData, bundled }
  }

  async function writePlugin(
    directory: string,
    id = 'pictor.example',
    version = '1.0.0',
  ): Promise<void> {
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify({
        id,
        name: id,
        version,
        engines: { pictor: '^0.2.0' },
        dependencies: {},
        modules: { main: './dist/main.js' },
      })}\n`,
    )
    await mkdir(join(directory, 'dist'), { recursive: true })
    await writeFile(join(directory, 'dist', 'main.js'), 'export default []\n')
  }

  it('installs Bundled Plugins into the user Store and creates all registry roots', async () => {
    const fixture = await createStoreFixture()
    await writePlugin(join(fixture.bundled, 'example'))
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })

    await store.initialize()
    const snapshot = await store.getSnapshot()

    expect(snapshot.issues).toEqual([])
    expect(snapshot.plugins).toHaveLength(1)
    expect(snapshot.plugins[0]).toMatchObject({
      entry: { id: 'pictor.example', source: { kind: 'bundled' }, desiredState: 'enabled' },
      manifest: { id: 'pictor.example', version: '1.0.0' },
    })
    await expect(
      readFile(join(snapshot.plugins[0]!.rootPath, 'dist', 'main.js'), 'utf8'),
    ).resolves.toContain('export default')
    for (const directory of ['plugins', 'plugin-data', 'pi-extensions', 'pi-packages']) {
      expect((await stat(join(fixture.userData, directory))).isDirectory()).toBe(true)
    }
  })

  it('keeps removed Bundled Plugins removed across restart, preserves data, and restores on request', async () => {
    const fixture = await createStoreFixture()
    await writePlugin(join(fixture.bundled, 'example'))
    const options = {
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    }
    const firstStore = new PluginStore(options)
    await firstStore.initialize()
    const dataPath = join(fixture.userData, 'plugin-data', 'pictor.example')
    await mkdir(dataPath, { recursive: true })
    await writeFile(join(dataPath, 'state.json'), '{}\n')

    await firstStore.remove('pictor.example')
    const restartedStore = new PluginStore(options)
    await restartedStore.initialize()

    expect((await restartedStore.getSnapshot()).plugins).toEqual([])
    await expect(readFile(join(dataPath, 'state.json'), 'utf8')).resolves.toBe('{}\n')

    const restored = await restartedStore.restoreBundled('pictor.example')
    expect(restored.entry.desiredState).toBe('enabled')
    expect((await restartedStore.getSnapshot()).plugins).toHaveLength(1)
    await expect(readFile(join(dataPath, 'state.json'), 'utf8')).resolves.toBe('{}\n')
  })

  it('installs a local Plugin and deletes data only when explicitly requested', async () => {
    const fixture = await createStoreFixture()
    const localPlugin = join(fixture.root, 'local-plugin')
    await writePlugin(localPlugin, 'pictor.local', '2.0.0')
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })
    await store.initialize()

    const installed = await store.installFromDirectory(localPlugin)
    await mkdir(installed.dataPath, { recursive: true })
    await writeFile(join(installed.dataPath, 'state.json'), '{}\n')
    await store.setEnabled('pictor.local', false)
    expect((await store.getSnapshot()).registry.entries[0]).toMatchObject({
      id: 'pictor.local',
      desiredState: 'disabled',
    })

    await store.remove('pictor.local', { deleteData: true })
    await expect(stat(installed.dataPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('loads a Development Plugin from its live source directory after restart', async () => {
    const fixture = await createStoreFixture()
    const developmentPlugin = join(fixture.root, 'development-plugin')
    await writePlugin(developmentPlugin, 'pictor.development', '1.0.0')
    const options = {
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    }
    const store = new PluginStore(options)
    await store.initialize()

    const installed = await store.installDevelopmentFromDirectory(developmentPlugin)
    expect(installed.entry.source).toEqual({
      kind: 'development',
      reference: developmentPlugin,
    })
    await writeFile(join(developmentPlugin, 'dist', 'main.js'), 'export default ["updated"]\n')

    const restarted = new PluginStore(options)
    await restarted.initialize()
    const snapshot = await restarted.getSnapshot()
    expect(snapshot.plugins[0]?.rootPath).toBe(developmentPlugin)
    await expect(
      readFile(join(snapshot.plugins[0]!.rootPath, 'dist', 'main.js'), 'utf8'),
    ).resolves.toContain('updated')
  })

  it('reports an invalid Bundled Manifest without preventing Core Store startup', async () => {
    const fixture = await createStoreFixture()
    const invalid = join(fixture.bundled, 'invalid')
    await mkdir(invalid, { recursive: true })
    await writeFile(join(invalid, 'manifest.json'), '{"id":"invalid"}\n')
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })

    await expect(store.initialize()).resolves.toBeUndefined()
    const snapshot = await store.getSnapshot()
    expect(snapshot.plugins).toEqual([])
    expect(snapshot.issues).toHaveLength(1)
  })

  it('installs native Pi Extension files without wrapping or rewriting their source', async () => {
    const fixture = await createStoreFixture()
    const extensionPath = join(fixture.root, 'hello.ts')
    const source = 'export default function hello(pi) { pi.on("agent_start", () => {}) }\n'
    await writeFile(extensionPath, source)
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })
    await store.initialize()

    const installed = await store.installPiExtension(extensionPath)

    expect(installed.entry).toMatchObject({
      kind: 'pi-extension',
      id: 'hello',
      desiredState: 'enabled',
    })
    await expect(readFile(join(installed.runtimePath, 'index.ts'), 'utf8')).resolves.toBe(source)
    expect((await store.getSnapshot()).nativeExtensions).toHaveLength(1)

    await writeFile(extensionPath, source.replace('agent_start', 'turn_start'))
    const live = (await store.getSnapshot()).nativeExtensions[0]
    expect(live?.runtimePaths).toEqual([extensionPath])
    await expect(readFile(live!.runtimePaths[0]!, 'utf8')).resolves.toContain('turn_start')

    await store.setNativeExtensionEnabled('pi-extension', 'hello', false)
    expect((await store.getSnapshot()).nativeExtensions).toEqual([])
    await store.removeNativeExtension('pi-extension', 'hello')
    expect((await store.getSnapshot()).registry.entries[0]).toMatchObject({
      kind: 'pi-extension',
      desiredState: 'removed',
    })
  })

  it('keeps a local Pi Package in its native package layout', async () => {
    const fixture = await createStoreFixture()
    const packagePath = join(fixture.root, 'pi-package')
    await mkdir(join(packagePath, 'extensions'), { recursive: true })
    await writeFile(
      join(packagePath, 'package.json'),
      `${JSON.stringify({ name: 'example-pi-package', version: '1.2.3' })}\n`,
    )
    await writeFile(join(packagePath, 'extensions', 'hello.js'), 'export default function () {}\n')
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })
    await store.initialize()

    const installed = await store.installPiPackage(packagePath)

    expect(installed.entry).toMatchObject({
      kind: 'pi-package',
      id: 'example-pi-package',
      version: '1.2.3',
    })
    expect(installed.runtimePaths).toEqual([join(installed.runtimePath, 'extensions', 'hello.js')])
    await expect(
      readFile(join(installed.runtimePath, 'extensions', 'hello.js'), 'utf8'),
    ).resolves.toContain('export default')
  })

  it('installs an explicitly provided Pi Package spec through the native Package Manager', async () => {
    const fixture = await createStoreFixture()
    const packagePath = join(fixture.root, 'spec-package')
    await mkdir(join(packagePath, 'extensions'), { recursive: true })
    await writeFile(
      join(packagePath, 'package.json'),
      `${JSON.stringify({ name: 'spec-pi-package', version: '2.0.0' })}\n`,
    )
    await writeFile(join(packagePath, 'extensions', 'spec.js'), 'export default function () {}\n')
    const store = new PluginStore({
      userDataDirectory: fixture.userData,
      bundledPluginsDirectory: fixture.bundled,
    })
    await store.initialize()

    const installed = await store.installPiPackageFromSpec(packagePath)

    expect(installed.entry).toMatchObject({
      kind: 'pi-package',
      id: 'spec-pi-package',
      source: packagePath,
      version: '2.0.0',
    })
    expect(installed.runtimePaths).toEqual([join(installed.runtimePath, 'extensions', 'spec.js')])
  })
})
