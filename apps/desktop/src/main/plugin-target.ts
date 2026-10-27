import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'

/**
 * Where a plugin package runs.
 *
 * Both sides of Pictor are cordis: a plugin is `name` / `inject` / `apply` either way. What
 * differs is the tree it lands in, which is decided by one fact — the services it declares
 * it needs. `pictor` exists in the window's tree; `tools`, `sessions`, `llm` exist in the
 * kernel's. So "which kind of plugin is this" is not a taxonomy anyone should have to learn:
 * it is a property of the package, read from its manifest.
 *
 * A package may be both. The README has said so since the two trees existed; until now the
 * page forced a choice between two lists, which turned an implementation detail into a
 * decision.
 */
export type PluginTarget = 'window' | 'kernel'

/** What a manifest declares about where it can run. */
export interface PluginDeclaration {
  /** `pictor` block: the window's contribution surface. */
  window: boolean
  /** `dsh.bundle` (its own patch) or `dsh.client` (a web-client half): the kernel's. */
  kernel: boolean
}

/**
 * Reads the two fields that decide the target.
 *
 * Deliberately about declarations, not guesses: a package with neither field is a plain
 * cordis plugin, and the window tree already accepts those — it mounts them and reports
 * them as waiting when they inject something this host does not provide. Turning that into
 * a refusal here would break plugins that work today.
 */
export interface DeclarationOptions {
  /** The kernel installation already ships this package: it belongs to the kernel. */
  shipped?: boolean
}

export function declarationOf(
  manifest: unknown,
  options: DeclarationOptions = {},
): PluginDeclaration {
  if (typeof manifest !== 'object' || manifest === null) return { window: false, kernel: false }
  const record = manifest as Record<string, unknown>

  const pictor = record['pictor']
  const window = isObject(pictor)

  const dsh = record['dsh']
  const kernel =
    options.shipped === true ||
    (isObject(dsh) &&
      (isObject((dsh as Record<string, unknown>)['bundle']) ||
        isObject((dsh as Record<string, unknown>)['client']))) ||
    // Most dsh plugins are plain cordis plugins with no `dsh` block — only *bundles* and
    // web-client halves carry one. What they all share is a dependency on the kernel's own
    // packages, and a package that imports `@deepseek-ai/dsh-*` cannot run in the window.
    dependsOnKernel(record)

  return { window, kernel }
}

/** Whether a manifest names any of the kernel's packages as a dependency. */
function dependsOnKernel(manifest: Record<string, unknown>): boolean {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = manifest[field]
    if (!isObject(block)) continue
    for (const name of Object.keys(block as Record<string, unknown>)) {
      if (name.startsWith('@deepseek-ai/dsh-') || name === '@deepseek-ai/cordis') return true
    }
  }
  return false
}

/** The targets a declaration allows, in the order the page lists them. */
export function targetsOf(declaration: PluginDeclaration): PluginTarget[] {
  const targets: PluginTarget[] = []
  if (declaration.window) targets.push('window')
  if (declaration.kernel) targets.push('kernel')
  // A plain cordis plugin belongs where the contribution surface is: the window tree mounts
  // it, reports it as waiting if it needs something else, and can switch it off.
  return targets.length === 0 ? ['window'] : targets
}

/** Whether a package built for one side should also be mounted on the other. */
export function isBoth(declaration: PluginDeclaration): boolean {
  return declaration.window && declaration.kernel
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What a spec would install, before installing it.
 *
 * Three answers, and the third is the honest one: a git or tarball URL has no manifest to
 * read until it is fetched, so the caller installs it into the kernel tree (the only tree
 * that resolves arbitrary specs) and looks at what arrived.
 */
export type DeclarationLookup = PluginDeclaration | 'unknown' | null

/** Reads a package's manifest from a directory, or nothing when there is none. */
export function manifestAt(directory: string): unknown | null {
  const path = join(resolve(directory), 'package.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

/**
 * Works out what a spec is, without installing it.
 *
 * A local path is read. A registry name is asked of npm — one metadata request rather than
 * a download — because installing into the wrong tree first and moving it afterwards is how
 * a profile ends up with packages nobody mounts.
 */
export interface DeclarationLookupOptions {
  npm?: () => { node: string; cli: string }
  /** The kernel installation, whose own packages are the kernel's by definition. */
  installation?: string
}

export async function declarationFor(
  spec: string,
  options: DeclarationLookupOptions = {},
): Promise<DeclarationLookup> {
  const value = spec.trim()
  if (value.length === 0) return null

  const local = /^(?:file|link):(.+)$/.exec(value)
  if (local !== null) return fromManifest(manifestAt(local[1] ?? ''), options)
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return fromManifest(manifestAt(value), options)
  }
  if (/^(?:git\+|github:|https?:)/.test(value)) return 'unknown'

  if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[^\s]+)?$/.test(value)) return null
  if (options.npm === undefined) return 'unknown'

  const manifest = await viewManifest(value, options.npm)
  // A name npm cannot answer for is not a wrong name: it may be unpublished, private, or
  // reachable only through a registry this machine lacks. The caller installs it and reads
  // what arrived, which is the only honest way to find out.
  return manifest === null ? 'unknown' : fromManifest(manifest, options)
}

/** Reads a manifest into a declaration, using the installation as a second signal. */
function fromManifest(
  manifest: unknown,
  options: DeclarationLookupOptions,
): DeclarationLookup | null {
  if (manifest === null) return null
  const record = typeof manifest === 'object' ? (manifest as Record<string, unknown>) : {}
  const name = typeof record['name'] === 'string' ? record['name'] : ''
  const shipped =
    options.installation !== undefined &&
    name.length > 0 &&
    existsSync(join(options.installation, 'node_modules', name, 'package.json'))
  return declarationOf(manifest, { shipped })
}

/** One registry query. `null` means npm could not answer, which is not a refusal. */
function viewManifest(
  spec: string,
  npm: () => { node: string; cli: string },
): Promise<unknown | null> {
  return new Promise((settle) => {
    let locator: { node: string; cli: string }
    try {
      locator = npm()
    } catch {
      settle(null)
      return
    }
    execFile(
      locator.node,
      [locator.cli, 'view', spec, '--json'],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          settle(null)
          return
        }
        try {
          settle(JSON.parse(stdout) as unknown)
        } catch {
          settle(null)
        }
      },
    )
  })
}
