import { z } from 'zod'

import { pluginManifestSchema } from '../plugin/manifest.js'
import { pluginDesiredStateSchema } from '../plugin/registry.js'

export const pluginBootstrapEntrySchema = z
  .object({
    manifest: pluginManifestSchema,
    desiredState: pluginDesiredStateSchema,
    guiEntryUrl: z.string().min(1).nullable(),
  })
  .strict()

export const pluginBootstrapSchema = z.object({
  safeMode: z.boolean(),
  plugins: z.array(pluginBootstrapEntrySchema),
})

export type PluginBootstrap = z.infer<typeof pluginBootstrapSchema>

export const pluginEffectiveStateSchema = z.enum([
  'active',
  'disabled',
  'blocked',
  'failed',
  'pending-restart',
])

export const pluginManagerItemSchema = z.object({
  kind: z.enum(['pictor-plugin', 'pi-extension', 'pi-package']),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().nullable(),
  source: z.string().min(1),
  desiredState: pluginDesiredStateSchema,
  effectiveState: pluginEffectiveStateSchema,
  reason: z.string().nullable(),
  canRestore: z.boolean(),
})

export const pluginManagerSnapshotSchema = z.object({
  safeMode: z.boolean(),
  restartRequired: z.boolean(),
  items: z.array(pluginManagerItemSchema),
  issues: z.array(z.string()),
})

export type PluginManagerSnapshot = z.infer<typeof pluginManagerSnapshotSchema>

export const runtimePluginBootstrapSchema = z.object({
  safeMode: z.boolean(),
  pictorVersion: z.string().min(1),
  plugins: z.array(
    z.object({
      manifest: pluginManifestSchema,
      desiredState: pluginDesiredStateSchema,
      dataPath: z.string().min(1),
      runtimeEntryPath: z.string().min(1).nullable(),
    }),
  ),
  extensions: z.array(
    z.object({
      kind: z.enum(['pi-extension', 'pi-package']),
      id: z.string().min(1),
      // A file/directory/package root is resolved by Pi's own
      // DefaultPackageManager and ResourceLoader.
      path: z.string().min(1),
    }),
  ),
  skills: z.array(z.string().min(1)),
  prompts: z.array(z.string().min(1)),
})

export type RuntimePluginBootstrap = z.infer<typeof runtimePluginBootstrapSchema>
