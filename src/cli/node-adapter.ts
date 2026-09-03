import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  ApplicationHost,
  ModelConnectionTester,
  ProfileFileLock,
  type EventPublisher,
} from '../application/index.js'
import { createHostPluginDefinitions } from '../main/plugins/plugin-loader.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { AgentWorkspaceHost } from '../modules/agent-workspace/host.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import { PictorError } from '../shared/errors.js'
import { defaultPluginProfile, developerPluginProfile } from '../main/plugins/default-profile.js'
import { detectDesktopDistribution } from '../main/linux-distribution.js'
import { resolveFrontendIdentity } from '../node/frontend-identity.js'

import { HeadlessRuntimeHost } from './headless-runtime.js'
import { resolveCliUserDataDirectory } from './profile.js'

import type { CliDependencies, CliApplicationHostOptions } from './contract.js'

export interface NodeCliAdapterOptions {
  readonly version?: string
  readonly projectRoot?: string
  readonly bundledPluginsDirectory?: string
  readonly platform?: NodeJS.Platform
  readonly homeDirectory?: string
  readonly environment?: NodeJS.ProcessEnv
}

export function createNodeCliDependencies(options: NodeCliAdapterOptions = {}): CliDependencies {
  const environment = options.environment ?? process.env
  const identity = resolveFrontendIdentity({
    environment,
    ...(options.version ? { version: options.version } : {}),
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    ...(options.bundledPluginsDirectory
      ? { bundledPluginsDirectory: options.bundledPluginsDirectory }
      : {}),
  })
  const platform = options.platform ?? process.platform
  const homeDirectory = options.homeDirectory ?? homedir()

  return {
    io: { stdout: process.stdout, stderr: process.stderr },
    version: identity.version,
    resolveUserDataDirectory: (explicitDirectory) =>
      resolveCliUserDataDirectory(explicitDirectory, {
        platform,
        homeDirectory,
        environment,
        ...(identity.packaged ? { applicationName: 'pictor' } : {}),
      }),
    createProfileLock: (profilePath) => new ProfileFileLock(profilePath, { frontend: 'cli' }),
    createApplicationHost: (hostOptions) =>
      createNodeApplicationHost(hostOptions, {
        version: identity.version,
        buildChannel: identity.buildChannel,
        sourceCommit: identity.sourceCommit,
        platform,
        bundledPluginsDirectory: identity.bundledPluginsDirectory,
        packaged: identity.packaged,
        environment,
      }),
    signals: {
      on: (signal, listener) => process.on(signal, listener),
      off: (signal, listener) => process.off(signal, listener),
    },
  }
}

async function createNodeApplicationHost(
  options: CliApplicationHostOptions,
  adapter: {
    version: string
    buildChannel: AppInfo['buildChannel']
    sourceCommit: AppInfo['sourceCommit']
    platform: NodeJS.Platform
    bundledPluginsDirectory: string
    packaged: boolean
    environment: NodeJS.ProcessEnv
  },
): Promise<ApplicationHost> {
  const appInfo = await createNodeAppInfo(
    adapter.version,
    adapter.platform,
    adapter.buildChannel,
    adapter.sourceCommit,
  )
  const configuredProfile =
    options.pluginProfile ??
    (adapter.environment.PICTOR_PLUGIN_PROFILE === 'developer' ? 'developer' : 'default')
  const profile = configuredProfile === 'developer' ? developerPluginProfile : defaultPluginProfile
  const useProfile = await hasCompleteBundledProfile(
    adapter.bundledPluginsDirectory,
    profile.plugins,
  )
  if (adapter.packaged && !useProfile) {
    throw new PictorError(
      'internal',
      `Packaged Bundled Plugin profile is incomplete: ${adapter.bundledPluginsDirectory}`,
    )
  }

  return new ApplicationHost({
    userData: options.userData,
    appInfo,
    bundledPluginsDirectory: adapter.bundledPluginsDirectory,
    runtimeHost: new HeadlessRuntimeHost(),
    eventPublisher: createHeadlessEventPublisher(),
    frontendLock: options.frontendLock,
    ...(useProfile ? { profile } : {}),
    pluginActivationMode: 'headless',
    safeMode: options.safeMode,
    createHostPluginDefinitions: (snapshot, appInfo, context) => {
      const agentWorkspaceHost: AgentWorkspaceHost = {
        repository: context.repository,
        runtime: context.runtime,
        connectionTester: new ModelConnectionTester(),
      }
      const updaterHost: UpdaterHostAdapter = {
        fetch: globalThis.fetch,
        openExternal: async () => {
          throw new PictorError('internal', 'CLI 不支持打开外部更新链接，请在 GUI 中操作')
        },
      }
      return createHostPluginDefinitions(snapshot, appInfo, (pluginId) =>
        pluginId === agentWorkspaceContract.id
          ? agentWorkspaceHost
          : pluginId === 'pictor.updater'
            ? updaterHost
            : undefined,
      )
    },
  })
}

async function hasCompleteBundledProfile(
  bundledPluginsDirectory: string,
  plugins: Readonly<Record<string, string>>,
): Promise<boolean> {
  const manifests = await Promise.all(
    Object.keys(plugins).map(async (id) => {
      const manifest = await stat(join(bundledPluginsDirectory, id, 'manifest.json')).catch(
        () => null,
      )
      return manifest?.isFile() ?? false
    }),
  )
  return manifests.every(Boolean)
}

async function createNodeAppInfo(
  version: string,
  platform: NodeJS.Platform,
  buildChannel: AppInfo['buildChannel'],
  sourceCommit: AppInfo['sourceCommit'],
): Promise<AppInfo> {
  if (process.arch !== 'x64') {
    throw new Error(`CLI 仅支持 x64，当前架构为 ${process.arch}`)
  }
  const appPlatform = platform === 'win32' ? 'win32' : 'linux'
  const distribution = await detectDesktopDistribution(appPlatform)
  return appInfoSchema.parse({
    name: 'Pictor',
    version,
    buildChannel,
    sourceCommit,
    platform: appPlatform,
    arch: 'x64',
    distribution,
  })
}

function createHeadlessEventPublisher(): EventPublisher {
  return { publish: () => undefined }
}
