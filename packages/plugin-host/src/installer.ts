import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * The file naming plugins installed as packages.
 *
 * The package manager owns `node_modules` and drags a plugin's dependencies in with
 * it, so "what a person installed" has to be recorded beside it: otherwise every
 * transitive dependency that happens to declare a `pictor` field would be mounted.
 */
export const INSTALLED_LIST = 'installed.json'

export interface InstalledPlugin {
  /** Directory name for a folder, package name for a package. */
  name: string
  kind: 'folder' | 'package'
}

export interface PluginInstallerOptions {
  /** Where plugins live; also the package manager's working directory. */
  directory: string
  /**
   * Node and npm, resolved by the caller.
   *
   * Injected rather than discovered here: finding a runtime is a desktop concern, and
   * a package that shells out on its own is a package that cannot be tested without
   * one. Absent means folder installs only.
   */
  npm?: () => { node: string; cli: string }
  /** Throws with a readable reason when a directory is not a plugin. */
  validate: (root: string) => void
}

/**
 * Installs and removes plugins under the profile.
 *
 * Two shapes, matching how the host discovers them: a folder copied in whole, and a
 * package installed into `node_modules` and named in `installed.json`. The second is
 * the one that lets a plugin bring its own dependencies, which is why both exist.
 *
 * Nothing here activates anything: the host owns that, and keeping the two apart means
 * a failed copy cannot leave a half-mounted plugin behind.
 */
export class PluginInstaller {
  readonly #options: PluginInstallerOptions

  constructor(options: PluginInstallerOptions) {
    this.#options = options
  }

  /** Where plugins are installed, for the page that explains it. */
  get directory(): string {
    return this.#options.directory
  }

  /** The root a name lives at, folder first, then package store. */
  rootOf(name: string): string | null {
    const folder = join(this.#options.directory, name)
    if (existsSync(join(folder, 'package.json'))) return folder
    const packaged = join(this.#options.directory, 'node_modules', name)
    if (existsSync(join(packaged, 'package.json'))) return packaged
    return null
  }

  /**
   * Copy a directory in as a plugin.
   *
   * The directory has to be self-contained: what its entry imports has to be inside
   * it, because nothing resolves its dependencies afterwards. Use the package form
   * when the plugin needs its own.
   */
  installFolder(source: string): InstalledPlugin {
    const root = resolve(source)
    this.#options.validate(root)

    const name = basename(root)
    if (!isPluginName(name)) throw new Error(`目录名不能当插件名：${name}`)
    if (this.rootOf(name) !== null) throw new Error(`已经装过同名插件：${name}`)

    mkdirSync(this.#options.directory, { recursive: true })
    cpSync(root, join(this.#options.directory, name), { recursive: true })
    return { name, kind: 'folder' }
  }

  /** Install a package as a plugin; it may bring its own dependencies. */
  async installPackage(
    spec: string,
    onLine: (line: string) => void = () => undefined,
  ): Promise<InstalledPlugin> {
    // Validate the request before looking for a package manager: a bad spec is the
    // caller's mistake and should say so even where npm is missing.
    const name = packageNameOf(spec)
    if (name === null) throw new Error('这不是一个包名；例子：@acme/pictor-kernel-codex@1.0.0')

    const npm = this.#options.npm
    if (npm === undefined) throw new Error('没有可用的 npm，无法安装插件包')
    if (existsSync(join(this.#options.directory, name))) {
      throw new Error(`已经装过同名插件：${name}`)
    }

    mkdirSync(this.#options.directory, { recursive: true })
    const manifest = join(this.#options.directory, 'package.json')
    if (!existsSync(manifest)) {
      writeFileSync(
        manifest,
        `${JSON.stringify({ name: 'pictor-plugins', private: true }, null, 2)}\n`,
        'utf8',
      )
    }

    const code = await runCommand(
      npm(),
      ['install', spec, '--no-audit', '--no-fund', '--loglevel=error'],
      this.#options.directory,
      onLine,
    )
    if (code !== 0) throw new Error(`安装 ${spec} 失败`)

    const installed = join(this.#options.directory, 'node_modules', name)
    if (!existsSync(join(installed, 'package.json'))) {
      throw new Error(`${spec} 装好了，但没有可用的包目录`)
    }
    // Validating after the install is what turns "npm succeeded" into "this is a
    // plugin": a package manager has no idea what a `pictor` field is.
    this.#options.validate(installed)
    this.#writePackages([...this.#packages(), name])
    return { name, kind: 'package' }
  }

  /**
   * Remove a plugin.
   *
   * A package goes through the package manager so its dependencies are cleaned up; a
   * folder is simply a folder. Either way the host decides whether it is still
   * mounted — this only owns the disk.
   */
  async remove(name: string, onLine: (line: string) => void = () => undefined): Promise<void> {
    if (!isPluginName(name)) throw new Error(`插件名不合法：${name}`)

    const folder = join(this.#options.directory, name)
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true })
      return
    }

    if (this.#packageInstalled(name)) {
      const npm = this.#options.npm
      if (npm === undefined) throw new Error('没有可用的 npm，无法卸载插件包')
      const code = await runCommand(
        npm(),
        ['uninstall', name, '--no-audit', '--no-fund', '--loglevel=error'],
        this.#options.directory,
        onLine,
      )
      if (code !== 0) throw new Error(`卸载 ${name} 失败`)
      this.#writePackages(this.#packages().filter((entry) => entry !== name))
      return
    }

    throw new Error(`没有这个插件：${name}`)
  }

  /** Names installed as packages, from either list version. */
  packages(): string[] {
    return this.#packages()
  }

  #packageInstalled(name: string): boolean {
    return existsSync(join(this.#options.directory, 'node_modules', name, 'package.json'))
  }

  #packages(): string[] {
    try {
      const parsed = JSON.parse(
        readFileSync(join(this.#options.directory, INSTALLED_LIST), 'utf8'),
      ) as { packages?: unknown }
      if (!Array.isArray(parsed.packages)) return []
      return parsed.packages.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      return []
    }
  }

  #writePackages(packages: readonly string[]): void {
    writeFileSync(
      join(this.#options.directory, INSTALLED_LIST),
      `${JSON.stringify({ packages }, null, 2)}\n`,
      'utf8',
    )
  }
}

/** A name that is safe as a directory under the plugin root. */
function isPluginName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value) && value !== 'node_modules'
}

/** `@scope/name@1.2.3` → `@scope/name`; anything that is not a package name fails. */
function packageNameOf(spec: string): string | null {
  const trimmed = spec.trim()
  if (trimmed.length === 0) return null
  if (/^(file:|link:|git|github:|https?:)/i.test(trimmed)) return null
  const at = trimmed.lastIndexOf('@')
  const name = at > 0 ? trimmed.slice(0, at) : trimmed
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) ? name : null
}

/** Run npm and stream its output; resolves with the exit code. */
function runCommand(
  command: { node: string; cli: string },
  args: readonly string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(command.node, [command.cli, ...args], { cwd, env: { ...process.env } })
    const collect = (chunk: Buffer | string): void => {
      for (const line of String(chunk).split('\n')) {
        const text = line.trim()
        if (text.length > 0) onLine(text.slice(0, 200))
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', () => resolveCode(1))
    child.on('exit', (code) => resolveCode(code ?? 1))
  })
}
