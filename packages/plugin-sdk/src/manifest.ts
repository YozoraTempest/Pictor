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
  /** Entry module relative to the plugin root. */
  main: string
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

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ManifestError(`manifest.${key} must be a non-empty string`)
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
