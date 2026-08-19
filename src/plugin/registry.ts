import { z } from 'zod'

import { pluginIdSchema, pluginVersionSchema } from './manifest.js'

export const pluginDesiredStateSchema = z.enum(['enabled', 'disabled', 'removed'])
export type PluginDesiredState = z.infer<typeof pluginDesiredStateSchema>

const extensionIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

const installedSourceSchema = z.object({
  kind: z.enum(['bundled', 'local', 'npm', 'git']),
  reference: z.string().min(1),
})

const pictorPluginEntrySchema = z.object({
  kind: z.literal('pictor-plugin'),
  id: pluginIdSchema,
  version: pluginVersionSchema,
  source: installedSourceSchema,
  desiredState: pluginDesiredStateSchema,
})

const piExtensionEntrySchema = z.object({
  kind: z.literal('pi-extension'),
  id: extensionIdSchema,
  source: z.string().min(1),
  desiredState: pluginDesiredStateSchema,
})

const piPackageEntrySchema = z.object({
  kind: z.literal('pi-package'),
  id: extensionIdSchema,
  source: z.string().min(1),
  version: pluginVersionSchema.nullable(),
  desiredState: pluginDesiredStateSchema,
})

export const installedExtensionSchema = z.discriminatedUnion('kind', [
  pictorPluginEntrySchema,
  piExtensionEntrySchema,
  piPackageEntrySchema,
])

export type InstalledExtension = z.infer<typeof installedExtensionSchema>
export type InstalledPictorPlugin = Extract<InstalledExtension, { kind: 'pictor-plugin' }>

export const pluginRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(installedExtensionSchema),
  })
  .superRefine((registry, context) => {
    const keys = new Set<string>()
    registry.entries.forEach((entry, index) => {
      const key = `${entry.kind}:${entry.id}`
      if (keys.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate registry entry: ${key}`,
          path: ['entries', index],
        })
      }
      keys.add(key)
    })
  })

export type PluginRegistry = z.infer<typeof pluginRegistrySchema>

export function createEmptyPluginRegistry(): PluginRegistry {
  return { schemaVersion: 1, entries: [] }
}
