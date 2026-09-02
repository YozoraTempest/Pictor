import semver from 'semver'
import { z } from 'zod'

export const pluginIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/,
    'Plugin ID must be a reverse-domain-style lowercase identifier',
  )

export const pluginVersionSchema = z
  .string()
  .refine((version) => semver.valid(version) !== null, 'Plugin version must be valid SemVer')

export const pluginVersionRangeSchema = z
  .string()
  .min(1)
  .refine((range) => semver.validRange(range) !== null, 'Plugin version range must be valid SemVer')

const packagePathSchema = z
  .string()
  .min(1)
  .refine((path) => {
    const segments = path.split(/[\\/]/)
    return path.startsWith('./') && !segments.includes('..')
  }, 'Plugin package paths must start with ./ and stay inside the package')

const pluginModulesSchema = z
  .object({
    host: packagePathSchema.optional(),
    gui: packagePathSchema.optional(),
    tui: packagePathSchema.optional(),
    runtime: packagePathSchema.optional(),
  })
  .strict()
  .default({})

const piResourcesSchema = z.object({
  extensions: z.array(packagePathSchema).optional(),
  skills: z.array(packagePathSchema).optional(),
  prompts: z.array(packagePathSchema).optional(),
})

export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(100),
  version: pluginVersionSchema,
  description: z.string().trim().min(1).optional(),
  engines: z.object({
    pictor: pluginVersionRangeSchema,
  }),
  dependencies: z.record(pluginIdSchema, pluginVersionRangeSchema).default({}),
  modules: pluginModulesSchema,
  pi: piResourcesSchema.optional(),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export function definePluginManifest<const TManifest extends PluginManifest>(
  manifest: TManifest,
): TManifest {
  return pluginManifestSchema.parse(manifest) as TManifest
}
