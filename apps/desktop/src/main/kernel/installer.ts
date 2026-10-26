import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { PACKAGE_LIST } from './host.js'
import { resolveNodeBinary, resolveNpmCli } from './node-runtime.js'

/** A kernel that has just been put on disk, named the way the host mounts it. */
export interface InstalledKernel {
  /** Pass to `KernelHost.mountInstalled`. */
  name: string
  /** How it arrived; the confirmation the window shows depends on it. */
  kind: 'folder' | 'package'
}

/**
 * Installs and removes kernels under the profile.
 *
 * Two shapes, matching how the host discovers them: a folder copied in whole, and a
 * package installed into `kernels/node_modules` and named in `kernels.json`. The
 * second is the only one that can bring its own dependencies, which is why both
 * exist — a folder has to be self-contained.
 *
 * Nothing here mounts or unmounts: that is the host's job, and keeping the two apart
 * means a failed copy cannot leave a half-mounted kernel behind.
 */
export class KernelInstaller {
  readonly #directory: string

  constructor(options: { userData: string }) {
    this.#directory = join(options.userData, 'kernels')
  }

  /** Where kernels are installed, for the page that explains it. */
  get directory(): string {
    return this.#directory
  }

  /**
   * Copy a directory in as a kernel.
   *
   * The directory has to be a self-contained package: its `main` entry and everything
   * that entry imports have to be inside it, because nothing will resolve its
   * dependencies afterwards.
   */
  installFolder(source: string): InstalledKernel {
    const root = resolve(source)
    const manifest = join(root, 'package.json')
    if (!existsSync(manifest)) throw new Error('这个目录不是 npm 包：没有 package.json')

    const name = basename(root)
    if (!isKernelName(name)) throw new Error(`目录名不能当内核名：${name}`)
    const entry = entryPointOf(root)
    if (entry === null) throw new Error('package.json 的 main 指向的文件不存在')

    mkdirSync(this.#directory, { recursive: true })
    const destination = join(this.#directory, name)
    if (existsSync(destination) || this.#packageInstalled(name)) {
      throw new Error(`已经装过同名内核：${name}`)
    }
    cpSync(root, destination, { recursive: true })
    return { name, kind: 'folder' }
  }

  /**
   * Install a package as a kernel.
   *
   * The package manager runs in the kernels directory, so a kernel can depend on
   * whatever it likes; the list of what a person actually chose is kept separately,
   * because `node_modules` also holds the dependencies those choices dragged in.
   */
  async installPackage(
    spec: string,
    onLine: (line: string) => void = () => undefined,
  ): Promise<InstalledKernel> {
    const name = packageNameOf(spec)
    if (name === null) throw new Error('这不是一个包名；例子：@acme/pictor-kernel-codex@1.0.0')
    if (existsSync(join(this.#directory, name))) {
      throw new Error(`已经装过同名内核：${name}`)
    }

    mkdirSync(this.#directory, { recursive: true })
    const manifest = join(this.#directory, 'package.json')
    if (!existsSync(manifest)) {
      writeFileSync(
        manifest,
        `${JSON.stringify({ name: 'pictor-kernels', private: true }, null, 2)}\n`,
        'utf8',
      )
    }

    const npm = npmCommand()
    const code = await runCommand(
      npm,
      ['install', spec, '--no-audit', '--no-fund', '--loglevel=error'],
      this.#directory,
      onLine,
    )
    if (code !== 0) throw new Error(`安装 ${spec} 失败`)

    if (!this.#packageInstalled(name)) {
      throw new Error(`${spec} 装好了，但没有可用的包目录`)
    }
    this.#writePackages([...this.#packages(), name])
    return { name, kind: 'package' }
  }

  /**
   * Remove a kernel.
   *
   * A package goes through the package manager so its dependencies are cleaned up; a
   * folder is simply a folder. Either way the host is what decides whether it is
   * still mounted — this only owns the disk.
   */
  async remove(name: string, onLine: (line: string) => void = () => undefined): Promise<void> {
    if (!isKernelName(name)) throw new Error(`内核名不合法：${name}`)

    const folder = join(this.#directory, name)
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true })
      return
    }

    if (this.#packageInstalled(name)) {
      const npm = npmCommand()
      const code = await runCommand(
        npm,
        ['uninstall', name, '--no-audit', '--no-fund', '--loglevel=error'],
        this.#directory,
        onLine,
      )
      if (code !== 0) throw new Error(`卸载 ${name} 失败`)
      this.#writePackages(this.#packages().filter((entry) => entry !== name))
      return
    }

    throw new Error(`没有这个内核：${name}`)
  }

  #packageInstalled(name: string): boolean {
    return existsSync(join(this.#directory, 'node_modules', name, 'package.json'))
  }

  #packages(): string[] {
    try {
      const parsed = JSON.parse(readFileSync(join(this.#directory, PACKAGE_LIST), 'utf8')) as {
        packages?: unknown
      }
      if (!Array.isArray(parsed.packages)) return []
      return parsed.packages.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      return []
    }
  }

  #writePackages(packages: readonly string[]): void {
    writeFileSync(
      join(this.#directory, PACKAGE_LIST),
      `${JSON.stringify({ packages }, null, 2)}\n`,
      'utf8',
    )
  }
}

/** A name that is safe as a directory under `kernels/`. */
function isKernelName(value: string): boolean {
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

/** The file `package.json` names, when it exists. */
function entryPointOf(root: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      main?: unknown
    }
    const main =
      typeof parsed.main === 'string' && parsed.main.length > 0 ? parsed.main : 'index.js'
    const entry = join(root, main)
    return existsSync(entry) ? entry : null
  } catch {
    return null
  }
}

function npmCommand(): { node: string; cli: string } {
  const node = resolveNodeBinary()
  if (node === null) throw new Error('没有找到可用的 Node；安装 Node 22+ 或设置 PICTOR_NODE_BIN')
  const cli = resolveNpmCli(node)
  if (cli === null) throw new Error('没有找到 npm，无法安装内核包')
  return { node, cli }
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
