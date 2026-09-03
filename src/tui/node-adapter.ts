import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  ApplicationHost,
  ModelConnectionTester,
  ProfileFileLock,
  type ApplicationHostOptions,
  type EventPublisher,
  type FrontendLock,
  type UserData,
} from '../application/index.js'
import type { AgentWorkspaceHost } from '../modules/agent-workspace/host.js'
import { createHostPluginDefinitions } from '../plugin/loader.js'
import { defaultPluginProfile, developerPluginProfile } from '../plugin/default-profile.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import { PictorError } from '../shared/errors.js'
import { resolveFrontendIdentity } from '../node/frontend-identity.js'
import { InProcessRuntimeHost } from './runtime-host.js'
import { resolveUserDataDirectory } from '../application/user-data.js'
import type { TuiDependencies } from './run.js'

export interface TuiNodeAdapterOptions {
  readonly version?: string
  readonly projectRoot?: string
  readonly bundledPluginsDirectory?: string
  readonly platform?: NodeJS.Platform
  readonly homeDirectory?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly emit: NonNullable<ConstructorParameters<typeof InProcessRuntimeHost>[0]>['emit']
  readonly requestSessionReplacement?: NonNullable<
    ConstructorParameters<typeof InProcessRuntimeHost>[0]
  >['requestSessionReplacement']
}

export interface TuiApplicationHostOptions {
  readonly userData: UserData
  readonly frontendLock: FrontendLock
  readonly safeMode: boolean
  readonly pluginProfile?: 'default' | 'developer'
}

export function createNodeTuiDependencies(
  options: Omit<TuiNodeAdapterOptions, 'emit' | 'requestSessionReplacement'> = {},
): TuiDependencies {
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
      resolveTuiUserDataDirectory(explicitDirectory, {
        platform,
        homeDirectory,
        environment,
        ...(identity.packaged ? { applicationName: 'pictor' } : {}),
      }),
    createProfileLock: createTuiProfileLock,
    createApplication: (hostOptions, context) =>
      createTuiNodeApplication(hostOptions, {
        ...options,
        version: identity.version,
        projectRoot: identity.packageRoot,
        bundledPluginsDirectory: identity.bundledPluginsDirectory,
        environment,
        emit: context.emit,
        requestSessionReplacement: context.requestSessionReplacement,
      }),
    signals: {
      on: (signal, listener) => process.on(signal, listener),
      off: (signal, listener) => process.off(signal, listener),
    },
  }
}

export interface TuiNodeApplication {
  readonly applicationHost: ApplicationHost
  readonly runtimeHost: InProcessRuntimeHost
}

export function createTuiNodeApplication(
  options: TuiApplicationHostOptions,
  adapterOptions: TuiNodeAdapterOptions,
): Promise<TuiNodeApplication> {
  return createApplication(options, adapterOptions)
}

export function createTuiProfileLock(profilePath: string): ProfileFileLock {
  return new ProfileFileLock(profilePath, { frontend: 'tui' })
}

export function resolveTuiUserDataDirectory(
  explicitDirectory: string | null,
  options: Pick<TuiNodeAdapterOptions, 'platform' | 'homeDirectory' | 'environment'> = {},
): string {
  return resolveUserDataDirectory(explicitDirectory, options)
}

async function createApplication(
  options: TuiApplicationHostOptions,
  adapter: TuiNodeAdapterOptions,
): Promise<TuiNodeApplication> {
  const projectRoot = adapter.projectRoot ?? process.cwd()
  const identity = resolveFrontendIdentity({
    ...(adapter.version ? { version: adapter.version } : {}),
    projectRoot,
    ...(adapter.bundledPluginsDirectory
      ? { bundledPluginsDirectory: adapter.bundledPluginsDirectory }
      : {}),
    ...(adapter.environment ? { environment: adapter.environment } : {}),
  })
  const platform = adapter.platform ?? process.platform
  const configuredProfile =
    options.pluginProfile ??
    (adapter.environment?.PICTOR_PLUGIN_PROFILE === 'developer' ? 'developer' : 'default')
  const profile = configuredProfile === 'developer' ? developerPluginProfile : defaultPluginProfile
  const appInfo = createTuiAppInfo(
    identity.version,
    platform,
    identity.buildChannel,
    identity.sourceCommit,
  )
  const runtimeHost = new InProcessRuntimeHost({
    emit: adapter.emit,
    ...(adapter.requestSessionReplacement
      ? { requestSessionReplacement: adapter.requestSessionReplacement }
      : {}),
  })
  const useProfile = await hasCompleteBundledProfile(
    identity.bundledPluginsDirectory,
    profile.plugins,
  )
  if (identity.packaged && !useProfile) {
    throw new PictorError(
      'internal',
      `Packaged Bundled Plugin profile is incomplete: ${identity.bundledPluginsDirectory}`,
    )
  }
  const applicationOptions: ApplicationHostOptions = {
    userData: options.userData,
    appInfo,
    bundledPluginsDirectory: identity.bundledPluginsDirectory,
    runtimeHost,
    eventPublisher: createHeadlessEventPublisher(),
    frontendLock: options.frontendLock,
    ...(useProfile ? { profile } : {}),
    pluginActivationMode: 'headless',
    safeMode: options.safeMode,
    createHostPluginDefinitions: (snapshot, currentAppInfo, context) => {
      const agentWorkspaceHost: AgentWorkspaceHost = {
        repository: context.repository,
        runtime: context.runtime,
        connectionTester: new ModelConnectionTester(),
      }
      const updaterHost = createTuiUpdaterHostAdapter()
      return createHostPluginDefinitions(snapshot, currentAppInfo, (pluginId) =>
        pluginId === agentWorkspaceContract.id
          ? agentWorkspaceHost
          : pluginId === 'pictor.updater'
            ? updaterHost
            : undefined,
      )
    },
  }
  return { applicationHost: new ApplicationHost(applicationOptions), runtimeHost }
}

export function createTuiUpdaterHostAdapter(): UpdaterHostAdapter {
  return {
    fetch: globalThis.fetch,
    openExternal: async () => {
      throw new PictorError('internal', 'TUI 不支持打开外部更新链接，请在 GUI 中操作')
    },
  }
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

function createTuiAppInfo(
  version: string,
  platform: NodeJS.Platform,
  buildChannel: AppInfo['buildChannel'],
  sourceCommit: AppInfo['sourceCommit'],
): AppInfo {
  if (process.arch !== 'x64') {
    throw new Error(`TUI 仅支持 x64，当前架构为 ${process.arch}`)
  }
  return appInfoSchema.parse({
    name: 'Pictor',
    version,
    buildChannel,
    sourceCommit,
    platform: platform === 'win32' ? 'win32' : 'linux',
    arch: 'x64',
    distribution: platform === 'win32' ? 'windows' : 'unsupported-linux',
  })
}

function createHeadlessEventPublisher(): EventPublisher {
  return { publish: () => undefined }
}
