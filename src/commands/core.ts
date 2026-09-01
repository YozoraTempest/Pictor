import { z } from 'zod'

import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import { pluginManagerSnapshotSchema, type PluginManagerSnapshot } from '../shared/plugins.js'
import {
  commandInputSchemaSchema,
  type CommandDescriptor,
  type CommandInputSchema,
} from './contract.js'
import type { CommandDefinition } from './engine.js'

const emptyInputSchema = z.null()
export const pluginKindSchema = z.enum(['pictor-plugin', 'pi-extension', 'pi-package'])
export const pluginIdentitySchema = z.object({
  kind: pluginKindSchema,
  id: z.string().trim().min(1),
})

export const pluginInstallRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('local'), path: z.string().trim().min(1) }),
  z.object({ source: z.literal('development'), path: z.string().trim().min(1) }),
  z.object({ source: z.literal('pi-extension'), path: z.string().trim().min(1) }),
  z.object({ source: z.literal('pi-package'), path: z.string().trim().min(1) }),
  z.object({ source: z.literal('pi-package-spec'), spec: z.string().trim().min(1).max(2_000) }),
])

export const pluginRemoveRequestSchema = pluginIdentitySchema.extend({
  deleteData: z.boolean().default(false),
})

export const pluginRestoreRequestSchema = z.object({ id: z.string().trim().min(1) })

export const appDoctorCheckSchema = z.object({
  id: z.enum(['plugin-store', 'plugin-restart']),
  status: z.enum(['ok', 'warning']),
  message: z.string().min(1),
})

export const appDoctorResultSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.array(appDoctorCheckSchema),
})
export type AppDoctorResult = z.output<typeof appDoctorResultSchema>

type PluginIdentity = z.infer<typeof pluginIdentitySchema>
type PluginInstallRequest = z.infer<typeof pluginInstallRequestSchema>

export interface PluginManagerCommandPort {
  getSnapshot(): Promise<PluginManagerSnapshot>
  installLocal(path: string): Promise<PluginManagerSnapshot>
  installDevelopment(path: string): Promise<PluginManagerSnapshot>
  installPiExtension(path: string): Promise<PluginManagerSnapshot>
  installPiPackage(path: string): Promise<PluginManagerSnapshot>
  installPiPackageSpec(spec: string): Promise<PluginManagerSnapshot>
  setEnabled(
    kind: PluginIdentity['kind'],
    id: string,
    enabled: boolean,
  ): Promise<PluginManagerSnapshot>
  remove(
    kind: PluginIdentity['kind'],
    id: string,
    deleteData: boolean,
  ): Promise<PluginManagerSnapshot>
  restoreBundled(id: string): Promise<PluginManagerSnapshot>
}

export function createCoreCommandDefinitions(
  appInfo: AppInfo,
  pluginManager: PluginManagerCommandPort,
): readonly CommandDefinition[] {
  return [
    {
      descriptor: descriptor(
        'app.info',
        '应用信息',
        '读取当前 Pictor Application Host 的构建信息。',
        { type: 'null' },
      ),
      input: emptyInputSchema,
      output: appInfoSchema,
      handler: () => appInfo,
    },
    {
      descriptor: descriptor(
        'app.doctor',
        '应用诊断',
        '检查 Plugin Registry 是否存在问题或等待重启。',
        { type: 'null' },
      ),
      input: emptyInputSchema,
      output: appDoctorResultSchema,
      handler: async () => createDoctorResult(await pluginManager.getSnapshot()),
    },
    {
      descriptor: descriptor(
        'plugin.list',
        '列出 Plugin',
        '读取当前 Plugin Registry 与 Plugin Host 状态。',
        { type: 'null' },
      ),
      input: emptyInputSchema,
      output: pluginManagerSnapshotSchema,
      handler: () => pluginManager.getSnapshot(),
    },
    {
      descriptor: descriptor(
        'plugin.install',
        '安装 Plugin',
        '安装本地 Pictor Plugin、Pi Extension 或 Pi Package。',
        pluginInstallInputSchema,
      ),
      input: pluginInstallRequestSchema,
      output: pluginManagerSnapshotSchema,
      handler: (request) => installPlugin(pluginManager, pluginInstallRequestSchema.parse(request)),
    },
    {
      descriptor: descriptor(
        'plugin.enable',
        '启用 Plugin',
        '记录 Plugin 的启用意图，重启后生效。',
        pluginIdentityInputSchema,
      ),
      input: pluginIdentitySchema,
      output: pluginManagerSnapshotSchema,
      handler: (request) => {
        const parsed = pluginIdentitySchema.parse(request)
        return pluginManager.setEnabled(parsed.kind, parsed.id, true)
      },
    },
    {
      descriptor: descriptor(
        'plugin.disable',
        '禁用 Plugin',
        '记录 Plugin 的禁用意图，重启后生效。',
        pluginIdentityInputSchema,
      ),
      input: pluginIdentitySchema,
      output: pluginManagerSnapshotSchema,
      handler: (request) => {
        const parsed = pluginIdentitySchema.parse(request)
        return pluginManager.setEnabled(parsed.kind, parsed.id, false)
      },
    },
    {
      descriptor: descriptor(
        'plugin.remove',
        '移除 Plugin',
        '移除 Plugin，并按请求决定是否删除其数据。',
        pluginRemoveInputSchema,
      ),
      input: pluginRemoveRequestSchema,
      output: pluginManagerSnapshotSchema,
      handler: (request) => {
        const parsed = pluginRemoveRequestSchema.parse(request)
        return pluginManager.remove(parsed.kind, parsed.id, parsed.deleteData)
      },
    },
    {
      descriptor: descriptor(
        'plugin.restore',
        '恢复 Bundled Plugin',
        '从当前安装包的 Bundled Plugin 恢复源重新安装指定 Plugin。',
        pluginRestoreInputSchema,
      ),
      input: pluginRestoreRequestSchema,
      output: pluginManagerSnapshotSchema,
      handler: (request) => {
        const parsed = pluginRestoreRequestSchema.parse(request)
        return pluginManager.restoreBundled(parsed.id)
      },
    },
  ]
}

const pluginIdentityInputSchema = objectInputSchema(
  {
    kind: { type: 'string', description: 'Plugin 类型' },
    id: { type: 'string', description: 'Plugin 标识' },
  },
  ['kind', 'id'],
)

const pluginInstallInputSchema = objectInputSchema(
  {
    source: { type: 'string', description: '安装来源类型' },
    path: { type: 'string', description: '本地文件或目录路径' },
    spec: { type: 'string', description: 'Pi Package spec' },
  },
  ['source'],
)

const pluginRemoveInputSchema = objectInputSchema(
  {
    kind: { type: 'string', description: 'Plugin 类型' },
    id: { type: 'string', description: 'Plugin 标识' },
    deleteData: { type: 'boolean', description: '是否删除 Plugin 数据' },
  },
  ['kind', 'id'],
)

const pluginRestoreInputSchema = objectInputSchema(
  {
    id: { type: 'string', description: 'Bundled Plugin 标识' },
  },
  ['id'],
)

function descriptor(
  id: string,
  title: string,
  description: string,
  inputSchema: CommandInputSchema,
): CommandDescriptor {
  return {
    id,
    title,
    description,
    inputSchema: commandInputSchemaSchema.parse(inputSchema),
    execution: {
      cancellable: false,
      recoverySafe: true,
    },
  }
}

function objectInputSchema(
  properties: Record<
    string,
    { type: 'string' | 'boolean' | 'number' | 'object' | 'array' | 'null'; description?: string }
  >,
  required: readonly string[] = [],
): CommandInputSchema {
  return commandInputSchemaSchema.parse({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  })
}

async function installPlugin(
  pluginManager: PluginManagerCommandPort,
  request: PluginInstallRequest,
): Promise<PluginManagerSnapshot> {
  switch (request.source) {
    case 'local':
      return pluginManager.installLocal(request.path)
    case 'development':
      return pluginManager.installDevelopment(request.path)
    case 'pi-extension':
      return pluginManager.installPiExtension(request.path)
    case 'pi-package':
      return pluginManager.installPiPackage(request.path)
    case 'pi-package-spec':
      return pluginManager.installPiPackageSpec(request.spec)
  }
}

function createDoctorResult(
  snapshot: PluginManagerSnapshot,
): z.output<typeof appDoctorResultSchema> {
  const registryHealthy = snapshot.issues.length === 0
  const restartHealthy = !snapshot.restartRequired
  return appDoctorResultSchema.parse({
    status: registryHealthy && restartHealthy ? 'ok' : 'degraded',
    checks: [
      {
        id: 'plugin-store',
        status: registryHealthy ? 'ok' : 'warning',
        message: registryHealthy ? 'Plugin Registry 可用' : 'Plugin Registry 存在诊断项',
      },
      {
        id: 'plugin-restart',
        status: restartHealthy ? 'ok' : 'warning',
        message: restartHealthy ? '没有等待重启的 Plugin 变更' : '存在等待重启的 Plugin 变更',
      },
    ],
  })
}
