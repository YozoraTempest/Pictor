import type { JsonValue } from './index.js'

/**
 * A dsh plugin mounted into the kernel.
 *
 * Pictor's own plugins are described by `views` and `panels` and run in the main process.
 * This is the other side: a package the **kernel** loads, in the kernel's own tree, with
 * the kernel's services — the shape dsh ships and its ecosystem is written in. Such a
 * plugin can add tools, change how the agent behaves, or bring an MCP connection; what it
 * cannot do is draw in Pictor's window (see `KERNEL_PLUGIN_KINDS`).
 *
 * Mounting happens through the profile patch, which is written from settings on every
 * boot. So the list lives here rather than in a file of its own: one source, and a
 * restart is what applies a change — the same contract MCP servers already have.
 */
export interface KernelPluginSpec {
  /** Entry id in the profile patch, and the row's key. Stable across versions. */
  id: string
  /** Package name the runtime resolves, e.g. `@deepseek-ai/dsh-tool-terminal`. */
  name: string
  /** Config handed to the entry. JSON only: it is written into a patch file. */
  config: JsonValue | null
  /** A plugin that is listed but not mounted. */
  enabled: boolean
  /** How it arrived: `npm`, `file`, or `bundled` for what dsh already ships. */
  source: string
  /** Version at install time, when the installer could see one. */
  version: string | null
}

/**
 * Entry ids Pictor writes itself.
 *
 * Refused as a plugin id so a person cannot shadow the guard or an MCP connection with an
 * entry of their own; those are generated from settings and would collide on the next boot.
 */
const RESERVED = new Set(['pictor-guard'])

/** An id the profile patch accepts: no whitespace, no quoting needed. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** A package name npm would accept, including a scope. */
const PACKAGE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

export function isKernelPluginId(value: string): boolean {
  return ID.test(value) && !RESERVED.has(value)
}

export function isKernelPluginPackage(value: string): boolean {
  return PACKAGE.test(value)
}

/** The id an entry gets when nobody named one: the package name, flattened. */
export function kernelPluginIdOf(name: string): string {
  return name
    .replace(/^@/, '')
    .replaceAll('/', '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
}

function configOf(value: unknown): JsonValue | null {
  if (value === undefined || value === null) return null
  // A patch file is JSON, so only JSON can travel through it. Anything else is dropped
  // here rather than failing the whole boot with a patch the loader cannot parse.
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch {
    return null
  }
}

/**
 * Reads the stored list, dropping rows that cannot be mounted.
 *
 * Same rule as MCP servers: one bad row is dropped with the rest of the list intact, so a
 * typo cannot cost a person every kernel plugin they had.
 */
export function parseKernelPlugins(value: unknown): KernelPluginSpec[] {
  if (!Array.isArray(value)) return []

  const plugins: KernelPluginSpec[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record['name'] === 'string' ? record['name'].trim() : ''
    if (!isKernelPluginPackage(name)) continue
    const rawId = typeof record['id'] === 'string' ? record['id'].trim() : ''
    const id = rawId.length === 0 ? kernelPluginIdOf(name) : rawId
    if (!isKernelPluginId(id) || seen.has(id)) continue

    seen.add(id)
    plugins.push({
      id,
      name,
      config: configOf(record['config']),
      enabled: record['enabled'] !== false,
      source: typeof record['source'] === 'string' ? record['source'] : 'npm',
      version: typeof record['version'] === 'string' ? record['version'] : null,
    })
  }
  return plugins
}

/** The entries a kernel should actually mount. */
export function enabledKernelPlugins(plugins: readonly KernelPluginSpec[]): KernelPluginSpec[] {
  return plugins.filter((plugin) => plugin.enabled)
}
