export interface PluginContribution {
  /** Contribution point id, e.g. `commands`. */
  point: string
  /** JSON-serialisable payload interpreted by the contribution point owner. */
  value: unknown
}

export interface PluginManifest {
  id: string
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
  engines: {
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
 * Validates a manifest at the boundary, before anything is imported.
 *
 * A malformed plugin must fail alone; it must never prevent the host or other
 * plugins from starting.
 */
export function parseManifest(value: unknown): PluginManifest {
  if (typeof value !== 'object' || value === null) {
    throw new ManifestError('manifest must be an object')
  }

  const record = value as Record<string, unknown>

  const id = requireString(record, 'id')
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(`invalid plugin id: ${id}`)
  }

  const name = requireString(record, 'name')
  const version = requireString(record, 'version')
  if (!SEMVER_PATTERN.test(version)) {
    throw new ManifestError(`invalid plugin version: ${version}`)
  }

  const main = requireString(record, 'main')
  const normalizedMain = main.replace(/\\/g, '/')
  if (normalizedMain.startsWith('/') || normalizedMain.split('/').includes('..')) {
    throw new ManifestError(`plugin main must stay inside the plugin root: ${main}`)
  }

  const engines = record.engines
  if (typeof engines !== 'object' || engines === null) {
    throw new ManifestError('manifest.engines is required')
  }
  const pictorRange = requireString(engines as Record<string, unknown>, 'pictor')

  const dependencies = parseDependencies(record.dependencies)
  const contributes = parseContributions(record.contributes)

  return {
    id,
    name,
    version,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    main: normalizedMain,
    engines: { pictor: pictorRange },
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(contributes === undefined ? {} : { contributes }),
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
 * `manifest.json` is still read by {@link parseManifest}, so plugins already on disk
 * keep working; this format simply wins when both are present.
 */
export function parsePackageManifest(value: unknown): PluginManifest {
  if (typeof value !== 'object' || value === null) {
    throw new ManifestError('package.json must be an object')
  }

  const record = value as Record<string, unknown>
  const meta = record.pictor
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new ManifestError('package.json.pictor is required')
  }
  const pictor = meta as Record<string, unknown>

  const id = requireString(pictor, 'id', 'pictor')
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(`invalid plugin id: ${id}`)
  }

  const name = requireString(record, 'name', 'package')
  const version = requireString(record, 'version', 'package')
  if (!SEMVER_PATTERN.test(version)) {
    throw new ManifestError(`invalid plugin version: ${version}`)
  }

  const engines = pictor.engines
  if (typeof engines !== 'object' || engines === null) {
    throw new ManifestError('pictor.engines is required')
  }
  const pictorRange = requireString(engines as Record<string, unknown>, 'pictor', 'pictor.engines')

  const dependencies = parseDependencies(pictor.dependencies)
  const contributes = parseContributions(pictor.contributes)

  return {
    id,
    name,
    version,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(record.main === undefined ? {} : { main: normalizeMain(record.main) }),
    engines: { pictor: pictorRange },
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

function requireString(record: Record<string, unknown>, key: string, prefix = 'manifest'): string {
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
