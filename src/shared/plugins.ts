import { z } from 'zod'

import { pluginManifestSchema } from '../plugin/manifest.js'
import { pluginDesiredStateSchema } from '../plugin/registry.js'

export const pluginBootstrapEntrySchema = z.object({
  manifest: pluginManifestSchema,
  desiredState: pluginDesiredStateSchema,
  rendererEntryUrl: z.string().min(1).nullable(),
})

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

export const pluginIdRequestSchema = z.object({ id: z.string().min(1) })
export const setPluginEnabledRequestSchema = pluginIdRequestSchema.extend({
  enabled: z.boolean(),
})
export const removePluginRequestSchema = pluginIdRequestSchema.extend({
  deleteData: z.boolean().default(false),
})

export type PluginManagerSnapshot = z.infer<typeof pluginManagerSnapshotSchema>
