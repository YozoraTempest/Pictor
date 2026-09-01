import { join } from 'node:path'

import { createCoreCommandDefinitions } from '../commands/core.js'
import { CommandEngine } from '../commands/engine.js'
import { commandContributions } from '../commands/registry.js'
import type { CommandClient } from '../commands/index.js'
import { ModuleRouter, moduleHandlerContributions } from '../kernel/contract.js'
import type { AppInfo } from '../shared/app-info.js'
import { pluginBootstrapSchema, type PluginBootstrap } from '../shared/plugins.js'
import type {
  EventPublisher,
  FrontendLock,
  FrontendLockLease,
  RuntimeHost,
  UserData,
} from './ports.js'
import { RuntimeCoordinator } from '../main/runtime/coordinator.js'
import { AppRepository } from '../main/persistence/app-repository.js'
import { SecretStore } from '../main/persistence/secret-store.js'
import { createRuntimePluginBootstrap } from '../main/plugins/plugin-loader.js'
import { PluginManager } from '../main/plugins/plugin-manager.js'
import { PluginStore, type PluginStoreSnapshot } from '../main/plugins/plugin-store.js'
import { PluginHost, type PluginDefinition } from '../plugin/host.js'
import type { PluginProfile } from '../plugin/profile.js'

export interface ApplicationHostPluginContext {
  readonly repository: AppRepository
  readonly runtime: RuntimeCoordinator
}

export type MainPluginDefinitionsFactory = (
  snapshot: PluginStoreSnapshot,
  appInfo: AppInfo,
  context: ApplicationHostPluginContext,
) => readonly PluginDefinition[] | Promise<readonly PluginDefinition[]>

export type RendererPluginUrlResolver = (
  rootPath: string,
  id: string,
  version: string,
  entry: string,
) => string | null

export interface ApplicationHostOptions {
  readonly userData: UserData
  readonly appInfo: AppInfo
  readonly bundledPluginsDirectory?: string
  readonly runtimeHost: RuntimeHost
  readonly eventPublisher: EventPublisher
  readonly frontendLock: FrontendLock
  readonly profile?: PluginProfile
  readonly pluginActivationMode?: 'full' | 'headless'
  readonly safeMode?: boolean
  readonly secretStore?: SecretStore
  readonly createMainPluginDefinitions?: MainPluginDefinitionsFactory
}

export interface ApplicationHostServices {
  readonly appInfo: AppInfo
  readonly commandClient: CommandClient
  readonly repository: AppRepository
  readonly pluginStore: PluginStore
  readonly pluginHost: PluginHost
  readonly pluginManager: PluginManager
  readonly runtime: RuntimeCoordinator
  readonly moduleRouter: ModuleRouter
  getPluginBootstrap(resolveRendererEntryUrl?: RendererPluginUrlResolver): Promise<PluginBootstrap>
  restoreSelectedContext(): Promise<void>
}

type HostState = 'new' | 'starting' | 'started' | 'stopping' | 'stopped' | 'failed'

export class ApplicationHost {
  private state: HostState = 'new'
  private startPromise: Promise<ApplicationHostServices> | null = null
  private stopPromise: Promise<void> | null = null
  private services: ApplicationHostServices | null = null
  private lockLease: FrontendLockLease | null = null
  private pluginHost: PluginHost | null = null
  private commandEngine: CommandEngine | null = null

  constructor(private readonly options: ApplicationHostOptions) {}

  start(): Promise<ApplicationHostServices> {
    if (this.state === 'started') return Promise.resolve(this.services!)
    if (this.state === 'starting') return this.startPromise!
    if (this.state !== 'new')
      throw new Error(`Application Host cannot start from ${this.state} state`)

    this.state = 'starting'
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  stop(): Promise<void> {
    if (this.state === 'starting') {
      return (this.stopPromise ??= this.startPromise!.then(
        () => this.stop(),
        () => undefined,
      ))
    }
    if (this.state === 'new' || this.state === 'stopped' || this.state === 'failed') {
      return Promise.resolve()
    }
    if (this.state === 'stopping') return this.stopPromise!

    this.state = 'stopping'
    this.stopPromise = this.stopInternal().finally(() => {
      this.state = 'stopped'
    })
    return this.stopPromise
  }

  private async startInternal(): Promise<ApplicationHostServices> {
    let pluginHost: PluginHost | null = null

    try {
      const lease = await this.options.frontendLock.acquire()
      if (!lease) throw new Error('当前 Profile 已被另一个 Frontend 使用')
      this.lockLease = lease

      const secretStore =
        this.options.secretStore ?? new SecretStore(this.options.userData.dataDirectory)
      const repository = new AppRepository(this.options.userData.dataDirectory, secretStore)
      const pluginStoreOptions = {
        userDataDirectory: this.options.userData.userDataDirectory,
        bundledPluginsDirectory:
          this.options.bundledPluginsDirectory ??
          join(this.options.userData.userDataDirectory, 'bundled-plugins'),
        ...(this.options.profile ? { profile: this.options.profile } : {}),
      }
      const pluginStore = new PluginStore(pluginStoreOptions)

      const initialization = await Promise.allSettled([
        repository.initialize(),
        pluginStore.initialize(),
      ])
      const initializationFailure = initialization.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (initializationFailure) throw initializationFailure.reason

      const pluginStoreSnapshot = await pluginStore.getSnapshot()
      this.options.runtimeHost.configurePluginBootstrap?.(
        createRuntimePluginBootstrap(
          pluginStoreSnapshot,
          this.options.appInfo.version,
          this.options.safeMode ?? false,
        ),
      )

      const runtime = new RuntimeCoordinator(repository, this.options.runtimeHost, (event) =>
        this.options.eventPublisher.publish(event),
      )
      const context: ApplicationHostPluginContext = { repository, runtime }
      pluginHost = new PluginHost({
        pictorVersion: this.options.appInfo.version,
        safeMode: this.options.safeMode ?? false,
      })
      this.pluginHost = pluginHost

      const createDefinitions = this.options.createMainPluginDefinitions ?? emptyPluginDefinitions
      const definitions = await createDefinitions(
        pluginStoreSnapshot,
        this.options.appInfo,
        context,
      )
      const statuses = await pluginHost.start(definitions)
      const pluginManager = new PluginManager(
        pluginStore,
        statuses,
        this.options.safeMode ?? false,
        pluginStoreSnapshot.registry.entries,
        this.options.pluginActivationMode ?? 'full',
      )
      const commandEngine = new CommandEngine(
        createCoreCommandDefinitions(this.options.appInfo, pluginManager),
      )
      this.commandEngine = commandEngine
      for (const contribution of pluginHost.getContributions(commandContributions)) {
        commandEngine.registerPluginCommands(contribution.owner, contribution.commands)
      }
      const moduleRouter = new ModuleRouter(pluginHost.getContributions(moduleHandlerContributions))
      const persistedSnapshot = await repository.getSnapshot()
      let restoreSelectedContextPromise: Promise<void> | null = null
      const restoreSelectedContext = (): Promise<void> => {
        if (restoreSelectedContextPromise) return restoreSelectedContextPromise
        restoreSelectedContextPromise = (async () => {
          if (!persistedSnapshot.selectedProjectId || !persistedSnapshot.selectedSessionId) return
          await runtime.selectContext(
            persistedSnapshot.selectedProjectId,
            persistedSnapshot.selectedSessionId,
          )
        })().catch((error: unknown) => {
          console.error('Failed to restore the selected Pi Session', error)
        })
        return restoreSelectedContextPromise
      }
      const getPluginBootstrap = async (
        resolveRendererEntryUrl: RendererPluginUrlResolver = () => null,
      ): Promise<PluginBootstrap> => {
        const snapshot = await pluginStore.getSnapshot()
        return pluginBootstrapSchema.parse({
          safeMode: this.options.safeMode ?? false,
          plugins: snapshot.plugins.map(({ entry, manifest, rootPath }) => ({
            manifest,
            desiredState: entry.desiredState,
            rendererEntryUrl: manifest.modules.renderer
              ? resolveRendererEntryUrl(
                  rootPath,
                  manifest.id,
                  manifest.version,
                  manifest.modules.renderer,
                )
              : null,
          })),
        })
      }

      const services: ApplicationHostServices = {
        appInfo: this.options.appInfo,
        commandClient: commandEngine.getClient(),
        repository,
        pluginStore,
        pluginHost,
        pluginManager,
        runtime,
        moduleRouter,
        getPluginBootstrap,
        restoreSelectedContext,
      }
      this.services = services
      this.state = 'started'
      return services
    } catch (error) {
      const cleanupError = await this.cleanup(pluginHost)
      this.state = 'failed'
      if (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Application Host 启动和清理均失败', {
          cause: error,
        })
      }
      throw error
    }
  }

  private async stopInternal(): Promise<void> {
    const cleanupError = await this.cleanup(this.pluginHost)
    if (cleanupError) throw cleanupError
  }

  private async cleanup(pluginHost: PluginHost | null): Promise<Error | null> {
    let firstError: Error | null = null
    const runCleanup = async (cleanupStep: () => void | Promise<void>): Promise<void> => {
      try {
        await cleanupStep()
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error(String(error))
      }
    }

    await runCleanup(async () => this.options.runtimeHost.dispose?.())
    await runCleanup(async () => this.commandEngine?.dispose())
    await runCleanup(async () => pluginHost?.stop())
    await runCleanup(async () => this.lockLease?.release())

    this.services = null
    this.pluginHost = null
    this.commandEngine = null
    this.lockLease = null
    return firstError
  }
}

function emptyPluginDefinitions(): readonly PluginDefinition[] {
  return []
}
