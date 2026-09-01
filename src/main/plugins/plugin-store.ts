import { randomUUID } from 'node:crypto'
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

import { z } from 'zod'
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'

import {
  pluginManifestSchema,
  pluginVersionSchema,
  type PluginManifest,
} from '../../plugin/manifest.js'
import { resolvePluginProfile, type PluginProfile } from '../../plugin/profile.js'
import {
  createEmptyPluginRegistry,
  pluginRegistrySchema,
  type InstalledPictorPlugin,
  type InstalledExtension,
  type PluginRegistry,
} from '../../plugin/registry.js'
import { isNodeError, readJsonFile, writeJsonFile } from '../persistence/atomic-json.js'

const MANIFEST_FILE = 'manifest.json'
const pluginPackageJsonSchema = z.object({
  name: z.string().min(1),
  version: pluginVersionSchema.optional(),
})

export interface PluginStoreOptions {
  userDataDirectory: string
  bundledPluginsDirectory: string
  profile?: PluginProfile
}

export interface StoredPluginPackage {
  entry: InstalledPictorPlugin
  manifest: PluginManifest
  rootPath: string
  dataPath: string
}

export interface PluginStoreIssue {
  source: string
  message: string
}

export interface PluginStoreSnapshot {
  registry: PluginRegistry
  plugins: readonly StoredPluginPackage[]
  blockedPlugins: readonly StoredPluginBlock[]
  nativeExtensions: readonly StoredNativeExtension[]
  issues: readonly PluginStoreIssue[]
}

export interface StoredPluginBlock {
  entry: InstalledPictorPlugin
  rootPath: string
  reason: string
}

export interface StoredNativeExtension {
  entry: Exclude<InstalledExtension, { kind: 'pictor-plugin' }>
  runtimePath: string
}

interface BundledPluginPackage {
  rootPath: string
  manifest: PluginManifest
}

export class PluginStore {
  private readonly registryPath: string
  private readonly pluginsDirectory: string
  private readonly pluginDataDirectory: string
  private readonly piExtensionsDirectory: string
  private readonly piPackagesDirectory: string
  private registry: PluginRegistry = createEmptyPluginRegistry()
  private issues: PluginStoreIssue[] = []
  private initialized = false

  constructor(private readonly options: PluginStoreOptions) {
    this.registryPath = join(options.userDataDirectory, 'plugin-registry.json')
    this.pluginsDirectory = join(options.userDataDirectory, 'plugins')
    this.pluginDataDirectory = join(options.userDataDirectory, 'plugin-data')
    this.piExtensionsDirectory = join(options.userDataDirectory, 'pi-extensions')
    this.piPackagesDirectory = join(options.userDataDirectory, 'pi-packages')
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.pluginsDirectory, { recursive: true }),
      mkdir(this.pluginDataDirectory, { recursive: true }),
      mkdir(this.piExtensionsDirectory, { recursive: true }),
      mkdir(this.piPackagesDirectory, { recursive: true }),
    ])
    this.registry =
      (await readJsonFile(this.registryPath, pluginRegistrySchema)) ?? createEmptyPluginRegistry()
    this.issues = []

    let registryChanged = false
    const bundledPlugins = await this.discoverBundledPlugins()
    const selected = this.options.profile
      ? new Set(
          resolvePluginProfile(
            this.options.profile,
            bundledPlugins.map(({ manifest }) => manifest),
          ),
        )
      : null
    for (const bundled of bundledPlugins) {
      if (selected && !selected.has(bundled.manifest.id)) continue
      const entryIndex = this.registry.entries.findIndex(
        (entry) => entry.kind === 'pictor-plugin' && entry.id === bundled.manifest.id,
      )
      const existing = this.registry.entries[entryIndex]
      if (existing?.kind === 'pictor-plugin' && existing.desiredState === 'removed') continue
      if (existing?.kind === 'pictor-plugin' && existing.source.kind === 'development') continue

      const entry: InstalledPictorPlugin = {
        kind: 'pictor-plugin',
        id: bundled.manifest.id,
        version: bundled.manifest.version,
        source: { kind: 'bundled', reference: bundled.manifest.id },
        desiredState: existing?.kind === 'pictor-plugin' ? existing.desiredState : 'enabled',
      }
      if (existing?.kind === 'pictor-plugin' && existing.version !== entry.version) {
        this.issues.push({
          source: bundled.rootPath,
          message: `Installed Plugin ${existing.id}@${existing.version} is retained; install or restore ${existing.id}@${entry.version} explicitly to apply the 0.4 package.`,
        })
        continue
      }
      const installed = await this.isPackageInstalled(entry)
      if (existing?.kind !== 'pictor-plugin' || existing.version !== entry.version || !installed) {
        try {
          await this.copyPackage(bundled.rootPath, entry)
          if (entryIndex >= 0) this.registry.entries[entryIndex] = entry
          else this.registry.entries.push(entry)
          registryChanged = true
        } catch (error) {
          this.issues.push({ source: bundled.rootPath, message: this.errorMessage(error) })
        }
      }
    }

    if (registryChanged) await this.persistRegistry()
    this.initialized = true
  }

  async getSnapshot(): Promise<PluginStoreSnapshot> {
    this.ensureInitialized()
    const issues = [...this.issues]
    const plugins: StoredPluginPackage[] = []
    const blockedPlugins: StoredPluginBlock[] = []
    const nativeExtensions: StoredNativeExtension[] = []

    for (const entry of this.registry.entries) {
      if (entry.desiredState === 'removed') continue
      if (entry.kind !== 'pictor-plugin') {
        if (entry.desiredState !== 'enabled') continue
        const installedPath =
          entry.kind === 'pi-extension'
            ? join(this.piExtensionsDirectory, entry.id)
            : join(this.piPackagesDirectory, entry.id)
        const liveSource =
          entry.kind === 'pi-extension' ? await stat(entry.source).catch(() => null) : null
        const runtimePath =
          liveSource?.isFile() || liveSource?.isDirectory() ? entry.source : installedPath
        const runtimeStat = await stat(runtimePath).catch(() => null)
        if (runtimeStat?.isFile() || runtimeStat?.isDirectory()) {
          nativeExtensions.push({
            entry: { ...entry },
            runtimePath,
          })
        } else {
          issues.push({ source: runtimePath, message: `Installed ${entry.kind} is missing` })
        }
        continue
      }
      const rootPath =
        entry.source.kind === 'development'
          ? resolve(entry.source.reference)
          : this.packagePath(entry)
      try {
        const manifestResult = await this.readStoredManifest(rootPath)
        if (manifestResult.kind === 'blocked') {
          blockedPlugins.push({
            entry: { ...entry, source: { ...entry.source } },
            rootPath,
            reason: manifestResult.reason,
          })
          issues.push({ source: rootPath, message: manifestResult.reason })
          continue
        }
        const manifest = manifestResult.manifest
        if (manifest.id !== entry.id || manifest.version !== entry.version) {
          throw new Error(
            `Installed Manifest is ${manifest.id}@${manifest.version}, expected ${entry.id}@${entry.version}`,
          )
        }
        plugins.push({
          entry: { ...entry, source: { ...entry.source } },
          manifest,
          rootPath,
          dataPath: join(this.pluginDataDirectory, entry.id),
        })
      } catch (error) {
        issues.push({ source: rootPath, message: this.errorMessage(error) })
      }
    }

    return {
      registry: pluginRegistrySchema.parse(this.registry),
      plugins,
      blockedPlugins,
      nativeExtensions,
      issues,
    }
  }

  async installFromDirectory(sourceDirectory: string): Promise<StoredPluginPackage> {
    this.ensureInitialized()
    const rootPath = resolve(sourceDirectory)
    const manifest = await this.readManifest(rootPath)
    const entry: InstalledPictorPlugin = {
      kind: 'pictor-plugin',
      id: manifest.id,
      version: manifest.version,
      source: { kind: 'local', reference: rootPath },
      desiredState: 'enabled',
    }

    await this.copyPackage(rootPath, entry)
    this.replacePluginEntry(entry)
    await this.persistRegistry()
    return {
      entry,
      manifest,
      rootPath: this.packagePath(entry),
      dataPath: join(this.pluginDataDirectory, entry.id),
    }
  }

  async installDevelopmentFromDirectory(sourceDirectory: string): Promise<StoredPluginPackage> {
    this.ensureInitialized()
    const rootPath = resolve(sourceDirectory)
    const manifest = await this.readManifest(rootPath)
    const entry: InstalledPictorPlugin = {
      kind: 'pictor-plugin',
      id: manifest.id,
      version: manifest.version,
      source: { kind: 'development', reference: rootPath },
      desiredState: 'enabled',
    }
    this.replacePluginEntry(entry)
    await this.persistRegistry()
    return {
      entry,
      manifest,
      rootPath,
      dataPath: join(this.pluginDataDirectory, entry.id),
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.ensureInitialized()
    const entry = this.findPluginEntry(id)
    if (entry.desiredState === 'removed') {
      throw new Error(`Removed Plugin must be reinstalled or restored before enabling: ${id}`)
    }
    entry.desiredState = enabled ? 'enabled' : 'disabled'
    await this.persistRegistry()
  }

  async installPiExtension(sourcePath: string): Promise<StoredNativeExtension> {
    this.ensureInitialized()
    const source = resolve(sourcePath)
    const sourceStat = await stat(source)
    const id = this.nativeExtensionId(source)
    const target = join(this.piExtensionsDirectory, id)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    if (sourceStat.isDirectory()) {
      await cp(source, target, { recursive: true })
    } else if (sourceStat.isFile() && ['.ts', '.js'].includes(extname(source))) {
      await copyFile(source, join(target, `index${extname(source)}`))
    } else {
      throw new Error('Pi Extension must be a .ts/.js file or directory')
    }
    const entry = {
      kind: 'pi-extension' as const,
      id,
      source,
      desiredState: 'enabled' as const,
    }
    this.replaceExtensionEntry(entry)
    await this.persistRegistry()
    return { entry, runtimePath: target }
  }

  async installPiPackage(sourcePath: string): Promise<StoredNativeExtension> {
    this.ensureInitialized()
    const source = resolve(sourcePath)
    return this.installPiPackageDirectory(source, source)
  }

  async installPiPackageFromSpec(source: string): Promise<StoredNativeExtension> {
    this.ensureInitialized()
    const spec = source.trim()
    if (!spec) throw new Error('Pi Package spec is required')
    const agentDir = join(this.options.userDataDirectory, 'pi-package-manager')
    await mkdir(agentDir, { recursive: true })
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true })
    const packageManager = new DefaultPackageManager({
      cwd: this.options.userDataDirectory,
      agentDir,
      settingsManager,
    })
    await packageManager.install(spec)
    const installedPath = packageManager.getInstalledPath(spec, 'user')
    if (!installedPath) throw new Error(`Pi Package did not provide an installed path: ${spec}`)
    return this.installPiPackageDirectory(
      installedPath,
      spec,
      this.packageNodeModulesDirectory(installedPath),
    )
  }

  private async installPiPackageDirectory(
    sourcePath: string,
    registrySource: string,
    nodeModulesPath?: string | null,
  ): Promise<StoredNativeExtension> {
    const source = resolve(sourcePath)
    const packageJson = await readJsonFile(join(source, 'package.json'), pluginPackageJsonSchema)
    if (!packageJson) throw new Error('Pi Package is missing package.json')
    const id = this.nativeExtensionId(packageJson.name)
    const target = join(this.piPackagesDirectory, id)
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
    if (nodeModulesPath && resolve(nodeModulesPath) !== resolve(join(source, 'node_modules'))) {
      await cp(nodeModulesPath, join(target, 'node_modules'), { recursive: true })
    }
    const entry = {
      kind: 'pi-package' as const,
      id,
      source: registrySource,
      version: packageJson.version ?? null,
      desiredState: 'enabled' as const,
    }
    this.replaceExtensionEntry(entry)
    await this.persistRegistry()
    return { entry, runtimePath: target }
  }

  private packageNodeModulesDirectory(packagePath: string): string | null {
    let current = dirname(resolve(packagePath))
    while (true) {
      if (basename(current) === 'node_modules') return current
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }

  async setNativeExtensionEnabled(
    kind: 'pi-extension' | 'pi-package',
    id: string,
    enabled: boolean,
  ): Promise<void> {
    this.ensureInitialized()
    const entry = this.findNativeExtensionEntry(kind, id)
    if (entry.desiredState === 'removed')
      throw new Error(`Removed extension must be reinstalled: ${id}`)
    entry.desiredState = enabled ? 'enabled' : 'disabled'
    await this.persistRegistry()
  }

  async removeNativeExtension(kind: 'pi-extension' | 'pi-package', id: string): Promise<void> {
    this.ensureInitialized()
    const entry = this.findNativeExtensionEntry(kind, id)
    const directory =
      kind === 'pi-extension' ? this.piExtensionsDirectory : this.piPackagesDirectory
    await rm(join(directory, id), { recursive: true, force: true })
    entry.desiredState = 'removed'
    await this.persistRegistry()
  }

  async remove(id: string, options: { deleteData?: boolean } = {}): Promise<void> {
    this.ensureInitialized()
    const entry = this.findPluginEntry(id)
    await rm(join(this.pluginsDirectory, entry.id), { recursive: true, force: true })
    if (options.deleteData) {
      await rm(join(this.pluginDataDirectory, entry.id), { recursive: true, force: true })
    }
    entry.desiredState = 'removed'
    await this.persistRegistry()
  }

  async restoreBundled(id: string): Promise<StoredPluginPackage> {
    this.ensureInitialized()
    const bundled = (await this.discoverBundledPlugins()).find(
      (candidate) => candidate.manifest.id === id,
    )
    if (!bundled) throw new Error(`Unknown Bundled Plugin: ${id}`)

    const entry: InstalledPictorPlugin = {
      kind: 'pictor-plugin',
      id,
      version: bundled.manifest.version,
      source: { kind: 'bundled', reference: id },
      desiredState: 'enabled',
    }
    await this.copyPackage(bundled.rootPath, entry)
    this.replacePluginEntry(entry)
    await this.persistRegistry()
    return {
      entry,
      manifest: bundled.manifest,
      rootPath: this.packagePath(entry),
      dataPath: join(this.pluginDataDirectory, id),
    }
  }

  private async discoverBundledPlugins(): Promise<BundledPluginPackage[]> {
    let entries
    try {
      entries = await readdir(this.options.bundledPluginsDirectory, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }

    const packages: BundledPluginPackage[] = []
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue
      const rootPath = join(this.options.bundledPluginsDirectory, entry.name)
      try {
        packages.push({ rootPath, manifest: await this.readManifest(rootPath) })
      } catch (error) {
        this.issues.push({ source: rootPath, message: this.errorMessage(error) })
      }
    }
    return packages
  }

  private async readManifest(rootPath: string): Promise<PluginManifest> {
    const manifest = await readJsonFile(join(rootPath, MANIFEST_FILE), pluginManifestSchema)
    if (!manifest) throw new Error(`Missing ${MANIFEST_FILE}`)
    return manifest
  }

  private async readStoredManifest(
    rootPath: string,
  ): Promise<{ kind: 'current'; manifest: PluginManifest } | { kind: 'blocked'; reason: string }> {
    const source = JSON.parse(await readFile(join(rootPath, MANIFEST_FILE), 'utf8')) as unknown
    const parsed = pluginManifestSchema.safeParse(source)
    if (parsed.success) return { kind: 'current', manifest: parsed.data }
    if (isLegacyManifest(source)) {
      return {
        kind: 'blocked',
        reason:
          'Installed Plugin uses the 0.3 Manifest (main/renderer); Pictor 0.4 blocks it without migration. Install a 0.4 package with explicit host/gui entries or restore its bundled 0.4 package.',
      }
    }
    throw parsed.error
  }

  private async copyPackage(sourcePath: string, entry: InstalledPictorPlugin): Promise<void> {
    const stagingPath = join(this.pluginsDirectory, `.install-${randomUUID()}`)
    const idDirectory = join(this.pluginsDirectory, entry.id)
    const targetPath = this.packagePath(entry)
    try {
      await cp(sourcePath, stagingPath, { recursive: true })
      await rm(idDirectory, { recursive: true, force: true })
      await mkdir(idDirectory, { recursive: true })
      await rename(stagingPath, targetPath)
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
  }

  private replacePluginEntry(replacement: InstalledPictorPlugin): void {
    const index = this.registry.entries.findIndex(
      (entry) => entry.kind === 'pictor-plugin' && entry.id === replacement.id,
    )
    if (index >= 0) this.registry.entries[index] = replacement
    else this.registry.entries.push(replacement)
  }

  private replaceExtensionEntry(replacement: InstalledExtension): void {
    const index = this.registry.entries.findIndex(
      (entry) => entry.kind === replacement.kind && entry.id === replacement.id,
    )
    if (index >= 0) this.registry.entries[index] = replacement
    else this.registry.entries.push(replacement)
  }

  private findNativeExtensionEntry(
    kind: 'pi-extension' | 'pi-package',
    id: string,
  ): Exclude<InstalledExtension, { kind: 'pictor-plugin' }> {
    const entry = this.registry.entries.find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    )
    if (!entry || entry.kind === 'pictor-plugin') throw new Error(`Unknown ${kind}: ${id}`)
    return entry
  }

  private nativeExtensionId(pathOrName: string): string {
    const name = basename(pathOrName, extname(pathOrName))
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!name) throw new Error('Cannot derive an extension ID from the source')
    return name
  }

  private findPluginEntry(id: string): InstalledPictorPlugin {
    const entry = this.registry.entries.find(
      (candidate): candidate is InstalledPictorPlugin =>
        candidate.kind === 'pictor-plugin' && candidate.id === id,
    )
    if (!entry) throw new Error(`Unknown installed Plugin: ${id}`)
    return entry
  }

  private packagePath(entry: Pick<InstalledPictorPlugin, 'id' | 'version'>): string {
    return join(this.pluginsDirectory, entry.id, entry.version)
  }

  private async isPackageInstalled(entry: InstalledPictorPlugin): Promise<boolean> {
    return (await stat(this.packagePath(entry)).catch(() => null))?.isDirectory() ?? false
  }

  private async persistRegistry(): Promise<void> {
    await writeJsonFile(this.registryPath, pluginRegistrySchema.parse(this.registry))
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error('Plugin Store has not been initialized')
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

function isLegacyManifest(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('modules' in value)) return false
  const modules = value.modules
  return (
    modules !== null && typeof modules === 'object' && ('main' in modules || 'renderer' in modules)
  )
}
