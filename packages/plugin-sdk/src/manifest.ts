export interface PluginContribution {
  /** Contribution point id, e.g. `commands`. */
  point: string
  /** JSON-serialisable payload interpreted by the contribution point owner. */
  value: unknown
}

/**
 * Where a plugin's metadata came from.
 *
 * `pictor` declared a `pictor` block and gets the full contract (engines, dependencies,
 * declared contributions). `cordis` is a plain cordis plugin — the shape dsh ships —
 * which declares its needs in code (`inject`, `apply`) instead of in JSON. Both can be
 * installed; what differs is how much this app can promise before starting one.
 */
export type PluginKind = 'pictor' | 'cordis'

export interface PluginManifest {
  /**
   * Stable id: `pictor.id` when declared, otherwise the package name.
   *
   * A cordis plugin has no place to put an id, and inventing one would make the same
   * package appear twice. The package name is what npm already guarantees unique.
   */
  id: string
  kind: PluginKind
  name: string
  version: string
  description?: string
  /**
   * UI entry module relative to the plugin root.
   *
   * Absent for a plugin that only contributes a kernel: there is nothing for the main
   * process to import and activate, and pretending otherwise would fail at load.
   */
  main?: string
  /** Absent for a cordis plugin: it never claimed a Pictor version range. */
  engines?: {
    pictor: string
  }
  /** Plugin ids this plugin depends on, mapped to a SemVer range. */
  dependencies?: Record<string, string>
  contributes?: PluginContribution[]
}

export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface PluginContext {
  readonly pluginId: string
  readonly pluginRoot: string
  readonly dataDirectory: string
  readonly logger: PluginLogger
  /** Registers a contribution and returns its disposer. */
  contribute(point: string, value: unknown): () => void
}

export interface PluginModule {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/**
 * Reads a plugin out of a `package.json`'s `pictor` field.
 *
 * A plugin is an npm package, and that is the whole point: `npm install` becomes the
 * only install step, the version a person sees is the version npm installed, and a
 * plugin can bring its own dependencies. The metadata therefore lives beside `name`
 * and `version` instead of in a second file that could disagree with them.
 *
 */
export function parsePackageManifest(value: unknown): PluginManifest {
  if (typeof value !== 'object' || value === null) {
    throw new ManifestError('package.json must be an object')
  }

  const record = value as Record<string, unknown>
  const name = requireString(record, 'name', 'package')
  const version = requireString(record, 'version', 'package')
  if (!SEMVER_PATTERN.test(version)) {
    throw new ManifestError(`invalid plugin version: ${version}`)
  }

  const meta = record.pictor
  if (meta === undefined) {
    // A cordis plugin: no `pictor` block, nothing declared in JSON. Its needs travel in
    // code (`inject`), which is exactly what makes one package installable by both this
    // app and dsh — and why this is not an error.
    if (record.main === undefined) {
      throw new ManifestError('package.json declares neither pictor metadata nor a main entry')
    }
    return {
      id: name,
      kind: 'cordis',
      name,
      version,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      main: normalizeMain(record.main),
    }
  }

  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new ManifestError('package.json.pictor must be an object')
  }
  const pictor = meta as Record<string, unknown>

  const id = requireString(pictor, 'id', 'pictor')
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(`invalid plugin id: ${id}`)
  }

  const engines = pictor.engines
  let pictorRange: string | undefined
  if (engines !== undefined) {
    if (typeof engines !== 'object' || engines === null) {
      throw new ManifestError('pictor.engines must be an object')
    }
    pictorRange = requireString(engines as Record<string, unknown>, 'pictor', 'pictor.engines')
  }

  const dependencies = parseDependencies(pictor.dependencies)
  const contributes = parseContributions(pictor.contributes)

  return {
    id,
    kind: 'pictor',
    name,
    version,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(record.main === undefined ? {} : { main: normalizeMain(record.main) }),
    ...(pictorRange === undefined ? {} : { engines: { pictor: pictorRange } }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(contributes === undefined ? {} : { contributes }),
  }
}

/** A main entry, refused unless it stays inside the plugin root. */
function normalizeMain(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ManifestError('package.main must be a non-empty string')
  }
  const main = value.trim().replace(/\\/g, '/')
  if (main.startsWith('/') || main.split('/').includes('..')) {
    throw new ManifestError(`plugin main must stay inside the plugin root: ${main}`)
  }
  return main
}

function requireString(record: Record<string, unknown>, key: string, prefix: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ManifestError(`${prefix}.${key} must be a non-empty string`)
  }
  return value.trim()
}

function parseDependencies(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ManifestError('manifest.dependencies must be an object')
  }

  const dependencies: Record<string, string> = {}
  for (const [id, range] of Object.entries(value)) {
    if (!ID_PATTERN.test(id)) {
      throw new ManifestError(`invalid dependency id: ${id}`)
    }
    if (typeof range !== 'string' || range.trim().length === 0) {
      throw new ManifestError(`dependency ${id} needs a SemVer range`)
    }
    dependencies[id] = range.trim()
  }

  return dependencies
}

function parseContributions(value: unknown): PluginContribution[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ManifestError('manifest.contributes must be an array')
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ManifestError(`manifest.contributes[${index}] must be an object`)
    }
    const record = entry as Record<string, unknown>
    const point = record.point
    if (typeof point !== 'string' || point.trim().length === 0) {
      throw new ManifestError(`manifest.contributes[${index}].point is required`)
    }
    return { point: point.trim(), value: record.value }
  })
}
