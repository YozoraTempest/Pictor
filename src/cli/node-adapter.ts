import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { ApplicationHost, ProfileFileLock, type EventPublisher } from '../application/index.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import { defaultPluginProfile, developerPluginProfile } from '../main/plugins/default-profile.js'
import { detectDesktopDistribution } from '../main/linux-distribution.js'

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
  const projectRoot = options.projectRoot ?? process.cwd()
  const version =
    options.version ?? environment.npm_package_version ?? readPackageVersion(projectRoot)
  const platform = options.platform ?? process.platform
  const homeDirectory = options.homeDirectory ?? homedir()

  return {
    io: { stdout: process.stdout, stderr: process.stderr },
    version,
    resolveUserDataDirectory: (explicitDirectory) =>
      resolveCliUserDataDirectory(explicitDirectory, {
        platform,
        homeDirectory,
        environment,
      }),
    createProfileLock: (profilePath) => new ProfileFileLock(profilePath, { frontend: 'cli' }),
    createApplicationHost: (hostOptions) =>
      createNodeApplicationHost(hostOptions, {
        version,
        platform,
        projectRoot,
        bundledPluginsDirectory: options.bundledPluginsDirectory,
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
    platform: NodeJS.Platform
    projectRoot: string
    bundledPluginsDirectory: string | undefined
    environment: NodeJS.ProcessEnv
  },
): Promise<ApplicationHost> {
  const appInfo = await createNodeAppInfo(adapter.version, adapter.platform)
  const configuredProfile =
    options.pluginProfile ??
    (adapter.environment.PICTOR_PLUGIN_PROFILE === 'developer' ? 'developer' : 'default')
  const profile = configuredProfile === 'developer' ? developerPluginProfile : defaultPluginProfile
  const bundledPluginsDirectory =
    adapter.bundledPluginsDirectory ?? resolve(adapter.projectRoot, '.pictor', 'bundled-plugins')
  const useProfile = await hasCompleteBundledProfile(bundledPluginsDirectory, profile.plugins)

  return new ApplicationHost({
    userData: options.userData,
    appInfo,
    bundledPluginsDirectory,
    runtimeHost: new HeadlessRuntimeHost(),
    eventPublisher: createHeadlessEventPublisher(),
    frontendLock: options.frontendLock,
    ...(useProfile ? { profile } : {}),
    pluginActivationMode: 'headless',
    safeMode: options.safeMode,
    // A CLI must never evaluate a GUI/Electron Plugin entrypoint. Core
    // command definitions are assembled by ApplicationHost itself.
    createMainPluginDefinitions: () => [],
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

async function createNodeAppInfo(version: string, platform: NodeJS.Platform): Promise<AppInfo> {
  if (process.arch !== 'x64') {
    throw new Error(`CLI 仅支持 x64，当前架构为 ${process.arch}`)
  }
  const appPlatform = platform === 'win32' ? 'win32' : 'linux'
  const distribution = await detectDesktopDistribution(appPlatform)
  return appInfoSchema.parse({
    name: 'Pictor',
    version,
    buildChannel: 'development',
    sourceCommit: null,
    platform: appPlatform,
    arch: 'x64',
    distribution,
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
    throw new Error('package.json 缺少有效 version')
  }
  return packageJson.version
}
