import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  enabledKernelPlugins,
  isKernelPluginPackage,
  kernelPluginIdOf,
  type KernelPluginSpec,
} from '@vulonlok/shared'

/**
 * Installs dsh plugins into the kernel's own profile.
 *
 * The kernel is a real dsh process with a real profile directory: a `package.json`, a
 * `node_modules`, and a `cordis.patch.yml` that Pictor regenerates on every boot. So a dsh
 * plugin installs exactly the way dsh installs one — a package in that profile — and is
 * mounted through an `insert` entry, which is the mechanism `dsh` itself documents for
 * anything the bundle stack did not declare.
 *
 * Two paths, because dsh has two:
 *
 * - **A bundle** (`dsh.bundle.patch` in its manifest) brings its own patch. Adding its name
 *   to `dsh.profile.bundles` is enough; that list is read before the user patch layer.
 * - **A plain plugin** declares nothing and is inert until an entry names it. Pictor adds
 *   the entry to the list it writes into the patch.
 *
 * The list itself lives in settings, not in a file here: the patch is generated from
 * settings on every boot, so anything written by hand would be erased by the next model
 * change. That is also why installing takes a restart — the same contract MCP servers have.
 */
export interface KernelPluginInstallerOptions {
  /** The kernel's profile directory, which is also the package manager's cwd. */
  profile: string
  /**
   * The kernel installation's own `node_modules`.
   *
   * A package dsh already ships must **not** be installed into the profile: the profile
   * copy wins resolution, and a second copy of `@deepseek-ai/cordis` means two service
   * registries — every plugin then waits forever and startup fails. Installing nothing and
   * writing the entry is what dsh itself does for its own bundles.
   */
  installation?: string
  /** Node and npm, resolved by the caller; absent means installs are unavailable. */
  npm?: () => { node: string; cli: string }
  /** The stored list, and the way it is written back. */
  read: () => readonly KernelPluginSpec[]
  write: (plugins: readonly KernelPluginSpec[]) => Promise<void>
  /** Progress lines from the package manager, for the dialog that started it. */
  onLine?: (line: string) => void
}

/**
 * A spec the installer accepts.
 *
 * Package name, or a `file:`/`link:` path — the two forms the profile can resolve without
 * a registry. A git or tarball URL goes through the package manager verbatim, which is why
 * it is allowed through without being parsed here.
 */
export function kernelPluginSpec(value: string): { spec: string; name: string } | null {
  const spec = value.trim()
  if (spec.length === 0) return null

  const fromPath = /^(?:file|link):(.+)$/.exec(spec)
  if (fromPath !== null) {
    const path = fromPath[1] ?? ''
    if (path.length === 0) return null
    return { spec, name: packageNameAt(path) ?? kernelPluginIdOf(path) }
  }

  if (isKernelPluginPackage(spec)) return { spec, name: spec }
  // A git url or tarball: the package manager knows how to read it, and the name is only
  // known once it is installed, so the caller reads it back afterwards.
  if (/^(?:git\+|https?:|github:)/.test(spec)) return { spec, name: '' }
  return null
}

/**
 * A package the kernel installation already ships.
 *
 * Checked by directory rather than by import: this runs before anything starts, and the
 * only question is whether resolution would find the installation's copy first.
 */
function shippedPackage(
  installation: string | undefined,
  name: string,
): { name: string; root: string; version: string | null } | null {
  if (installation === undefined || name.length === 0) return null
  const root = join(installation, 'node_modules', name)
  if (!existsSync(join(root, 'package.json'))) return null
  return { name, root, version: versionAt(root) }
}

/** The `name` field of a package at a directory, without importing it. */
export function packageNameAt(root: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: unknown
      dsh?: { bundle?: { patch?: unknown } }
    }
    return typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : null
  } catch {
    return null
  }
}

/** Whether a profile dependency declares its own patch, which makes it a bundle. */
export function isBundlePackage(root: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    return typeof manifest.dsh?.bundle?.patch === 'string'
  } catch {
    return false
  }
}

export interface KernelPluginInstallResult {
  plugin: KernelPluginSpec
  /** Where the package's files are, so the caller can read what else it declares. */
  root: string
  /** `bundle` when the package carried its own patch; `entry` when Pictor added one. */
  mount: 'bundle' | 'entry'
  /** Lines the package manager printed, for the dialog to show behind 「详情」. */
  log: string[]
}

export class KernelPluginInstaller {
  readonly #options: KernelPluginInstallerOptions

  constructor(options: KernelPluginInstallerOptions) {
    this.#options = options
  }

  /** Where the kernel's packages live, for the page that explains it. */
  get profile(): string {
    return this.#options.profile
  }

  /** The kernel installation: the packages it ships are the kernel's, not the profile's. */
  get installation(): string | undefined {
    return this.#options.installation
  }

  /**
   * Installs one package and records how to mount it.
   *
   * The recorded entry is written even for a bundle: `dsh.profile.bundles` makes it load,
   * but the row still has to exist so the page can list it and switch it off. A bundle's
   * `insert` is redundant on the first boot and correct after a bundle-list edit, so both
   * roads lead to the plugin being mounted.
   */
  async install(value: string): Promise<KernelPluginInstallResult> {
    const parsed = kernelPluginSpec(value)
    if (parsed === null) {
      throw new Error('装不了这个地址：用包名、file: 路径，或 npm 认识的 git/tarball 地址')
    }

    const current = this.#options.read()
    if (current.some((plugin) => plugin.name === parsed.spec || plugin.name === parsed.name)) {
      throw new Error(`已经装过：${parsed.name || parsed.spec}`)
    }

    // Already in the kernel installation: an entry is the whole install. Copying it into
    // the profile would shadow the installation and split the service tree.
    const shipped = shippedPackage(this.#options.installation, parsed.name)
    if (shipped !== null) {
      const plugin: KernelPluginSpec = {
        id: kernelPluginIdOf(shipped.name),
        name: shipped.name,
        config: null,
        enabled: true,
        source: 'bundled',
        version: shipped.version,
      }
      await this.#options.write([...current, plugin])
      return {
        plugin,
        root: shipped.root,
        mount: isBundlePackage(shipped.root) ? 'bundle' : 'entry',
        log: [],
      }
    }

    const npm = this.#options.npm
    if (npm === undefined) throw new Error('没有可用的 npm，无法安装内核插件')

    const log: string[] = []
    const onLine = (line: string): void => {
      log.push(line)
      this.#options.onLine?.(line)
    }

    // Two flags, both about not forking the kernel:
    //
    // - `--legacy-peer-deps`: a dsh plugin declares `@deepseek-ai/cordis` as a peer, and
    //   npm 7+ installs peers by default. That copy lands in the profile, wins resolution,
    //   and the kernel ends up with two service registries — which fails to start, with
    //   every plugin waiting. The installation already provides the peer.
    // - `--ignore-scripts` is deliberately absent: a plugin may need its build step, and
    //   the kernel is the process it is meant to run in.
    const code = await run(
      npm(),
      ['install', parsed.spec, '--legacy-peer-deps', '--no-audit', '--no-fund'],
      this.#options.profile,
      onLine,
    )
    if (code !== 0) throw new Error(`安装失败（退出码 ${String(code)}）：${parsed.spec}`)

    const name =
      parsed.name.length > 0 ? parsed.name : nameAfterInstall(this.#options.profile, current)
    if (name === null) throw new Error(`${parsed.spec} 装好了，但找不到它的包名`)

    const root = join(this.#options.profile, 'node_modules', name)
    if (!existsSync(join(root, 'package.json'))) {
      throw new Error(`${name} 装好了，但 profile 里没有它的目录`)
    }

    const bundle = isBundlePackage(root)
    const plugin: KernelPluginSpec = {
      id: kernelPluginIdOf(name),
      name,
      config: null,
      enabled: true,
      source: parsed.spec === name ? 'npm' : parsed.spec,
      version: versionAt(root),
    }

    await this.#options.write([...this.#options.read(), plugin])
    return { plugin, root, mount: bundle ? 'bundle' : 'entry', log }
  }

  /**
   * Removes one package from the profile.
   *
   * A package still listed by a bundle descriptor is left on disk: another entry may depend
   * on it, and removing a dependency out from under a working profile is worse than a
   * stale directory. The row is dropped either way, which is what the person asked for.
   */
  async remove(id: string): Promise<void> {
    const plugins = this.#options.read()
    const plugin = plugins.find((entry) => entry.id === id)
    if (plugin === undefined) throw new Error(`没有这个内核插件：${id}`)

    await this.#options.write(plugins.filter((entry) => entry.id !== id))

    const npm = this.#options.npm
    if (npm === undefined) return
    await run(
      npm(),
      ['uninstall', plugin.name, '--no-audit', '--no-fund'],
      this.#options.profile,
      () => undefined,
    )
  }

  /** Turns one plugin on or off; a restart is what applies it. */
  async setEnabled(id: string, enabled: boolean): Promise<KernelPluginSpec[]> {
    const plugins = this.#options.read()
    const next = plugins.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin))
    await this.#options.write(next)
    return next
  }

  /** The entries a boot right now would mount, for the page's own count. */
  mounted(): KernelPluginSpec[] {
    return enabledKernelPlugins(this.#options.read())
  }
}

/** The package name a spec produced, by diffing what the profile now contains. */
function nameAfterInstall(profile: string, before: readonly KernelPluginSpec[]): string | null {
  const known = new Set(before.map((plugin) => plugin.name))
  // The spec itself is often the name (`github:acme/kit` is not, but the installed
  // directory is), so the directory list is the reliable answer.
  for (const entry of readdirNames(join(profile, 'node_modules'))) {
    if (entry.startsWith('.') || entry.startsWith('@')) continue
    if (!known.has(entry)) return entry
  }
  for (const scope of readdirNames(join(profile, 'node_modules'))) {
    if (!scope.startsWith('@')) continue
    for (const entry of readdirNames(join(profile, 'node_modules', scope))) {
      const name = `${scope}/${entry}`
      if (!known.has(name)) return name
    }
  }
  return null
}

function readdirNames(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function versionAt(root: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/** Runs the package manager, forwarding lines as they arrive. */
function run(
  npm: { node: string; cli: string },
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(npm.node, [npm.cli, ...args], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const forward = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const text = line.trim()
        if (text.length > 0) onLine(text)
      }
    }
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

/** Writes the package-manifest change a bundle install needs. */
export function addProfileBundle(profile: string, name: string): void {
  const path = join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(name)) return
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...manifest,
        dsh: {
          ...manifest.dsh,
          profile: { ...manifest.dsh?.profile, bundles: [...bundles, name] },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}
