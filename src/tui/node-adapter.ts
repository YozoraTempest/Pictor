import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ApplicationHost,
  ProfileFileLock,
  type ApplicationHostOptions,
  type EventPublisher,
  type FrontendLock,
  type UserData,
} from '../application/index.js'
import { ModelConnectionTester } from '../application/model-connection.js'
import { createHostPluginDefinitions } from '../plugin/loader.js'
import { defaultPluginProfile, developerPluginProfile } from '../plugin/default-profile.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import { PictorError } from '../shared/errors.js'
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
  const projectRoot = options.projectRoot ?? process.cwd()
  const version =
    options.version ?? environment.npm_package_version ?? readPackageVersion(projectRoot)
  const platform = options.platform ?? process.platform
  const homeDirectory = options.homeDirectory ?? homedir()

  return {
    io: { stdout: process.stdout, stderr: process.stderr },
    version,
    resolveUserDataDirectory: (explicitDirectory) =>
      resolveTuiUserDataDirectory(explicitDirectory, {
        platform,
        homeDirectory,
        environment,
      }),
    createProfileLock: createTuiProfileLock,
    createApplication: (hostOptions, context) =>
      createTuiNodeApplication(hostOptions, {
        ...options,
        version,
        projectRoot,
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
  const version =
    adapter.version ?? adapter.environment?.npm_package_version ?? readPackageVersion(projectRoot)
  const platform = adapter.platform ?? process.platform
  const configuredProfile =
    options.pluginProfile ??
    (adapter.environment?.PICTOR_PLUGIN_PROFILE === 'developer' ? 'developer' : 'default')
  const profile = configuredProfile === 'developer' ? developerPluginProfile : defaultPluginProfile
  const bundledPluginsDirectory =
    adapter.bundledPluginsDirectory ?? resolve(projectRoot, '.pictor', 'bundled-plugins')
  const appInfo = createTuiAppInfo(version, platform)
  const runtimeHost = new InProcessRuntimeHost({
    emit: adapter.emit,
    ...(adapter.requestSessionReplacement
      ? { requestSessionReplacement: adapter.requestSessionReplacement }
      : {}),
  })
  const useProfile = await hasCompleteBundledProfile(bundledPluginsDirectory, profile.plugins)
  const applicationOptions: ApplicationHostOptions = {
    userData: options.userData,
    appInfo,
    bundledPluginsDirectory,
    runtimeHost,
    eventPublisher: createHeadlessEventPublisher(),
    frontendLock: options.frontendLock,
    ...(useProfile ? { profile } : {}),
    pluginActivationMode: 'headless',
    safeMode: options.safeMode,
    createHostPluginDefinitions: (snapshot, currentAppInfo, context) => {
      const agentWorkspaceHost = {
        repository: context.repository,
        runtime: context.runtime,
        connectionTester: new ModelConnectionTester(),
      }
      return createHostPluginDefinitions(snapshot, currentAppInfo, (pluginId) =>
        pluginId === agentWorkspaceContract.id ? agentWorkspaceHost : undefined,
      )
    },
  }
  return { applicationHost: new ApplicationHost(applicationOptions), runtimeHost }
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

function createTuiAppInfo(version: string, platform: NodeJS.Platform): AppInfo {
  if (process.arch !== 'x64') {
    throw new Error(`TUI 仅支持 x64，当前架构为 ${process.arch}`)
  }
  return appInfoSchema.parse({
    name: 'Pictor',
    version,
    buildChannel: 'development',
    sourceCommit: null,
    platform: platform === 'win32' ? 'win32' : 'linux',
    arch: 'x64',
    distribution: platform === 'win32' ? 'windows' : 'unsupported-linux',
  })
}

function createHeadlessEventPublisher(): EventPublisher {
  return { publish: () => undefined }
}

function readPackageVersion(projectRoot: string): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
  )
  if (
    !packageJson ||
    typeof packageJson !== 'object' ||
    !('version' in packageJson) ||
    typeof packageJson.version !== 'string' ||
    !packageJson.version
  ) {
    throw new PictorError('internal', 'package.json 缺少有效 version')
  }
  return packageJson.version
}
