import { join } from 'node:path'

import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { createHostPluginDefinitions } from '../plugin/loader.js'
import type { PluginProfile } from '../plugin/profile.js'
import { RuntimeSupervisor } from '../runtime/supervisor.js'
import type { AppInfo } from '../shared/app-info.js'
import type { SecretStore } from '../node/persistence/secret-store.js'
import { ModelConnectionTester } from './model-connection.js'
import {
  ApplicationHost,
  type ApplicationHostServices,
  type HostPluginDefinitionsFactory,
} from './host.js'
import type { EventPublisher, FrontendLock, UserData } from './ports.js'

export interface NodeApplicationOptions {
  readonly userDataDirectory: string
  readonly runtimeHostPath: string
  readonly runtimeEnvironment?: Readonly<NodeJS.ProcessEnv>
  readonly appInfo: AppInfo
  readonly bundledPluginsDirectory: string
  readonly frontendLock: FrontendLock
  readonly profile: PluginProfile
  readonly eventPublisher: EventPublisher
  readonly secretStore?: SecretStore
  readonly updaterHost?: UpdaterHostAdapter
  readonly safeMode?: boolean
  readonly creationMode?: boolean
}

export interface NodeApplicationServices {
  readonly applicationHost: ApplicationHost
  readonly services: ApplicationHostServices
}

export async function createNodeApplication(
  options: NodeApplicationOptions,
): Promise<NodeApplicationServices> {
  const userData: UserData = {
    userDataDirectory: options.userDataDirectory,
    dataDirectory: join(options.userDataDirectory, 'data-v1'),
  }
  const coordinatorReference: { current?: ApplicationHostServices['runtime'] } = {}
  const runtimeSupervisor = new RuntimeSupervisor(
    (event) => coordinatorReference.current?.handleEvent(event),
    undefined,
    (request) =>
      coordinatorReference.current?.handleSessionReplacementRequest(request) ??
      Promise.resolve({ accepted: false, message: 'Runtime Coordinator is unavailable' }),
    {
      runtimeHostPath: options.runtimeHostPath,
      ...(options.runtimeEnvironment ? { environment: options.runtimeEnvironment } : {}),
    },
  )
  const applicationHost = new ApplicationHost({
    userData,
    appInfo: options.appInfo,
    bundledPluginsDirectory: options.bundledPluginsDirectory,
    runtimeHost: runtimeSupervisor,
    eventPublisher: options.eventPublisher,
    frontendLock: options.frontendLock,
    profile: options.profile,
    safeMode: options.safeMode ?? false,
    creationMode: options.creationMode ?? false,
    ...(options.secretStore ? { secretStore: options.secretStore } : {}),
    createHostPluginDefinitions: createNodeHostPluginDefinitions(options.updaterHost),
  })

  const services = await applicationHost.start()
  coordinatorReference.current = services.runtime
  return { applicationHost, services }
}

function createNodeHostPluginDefinitions(
  updaterHost: UpdaterHostAdapter | undefined,
): HostPluginDefinitionsFactory {
  return (snapshot, appInfo, context) => {
    const agentWorkspaceHost = {
      repository: context.repository,
      runtime: context.runtime,
      connectionTester: new ModelConnectionTester(),
    }
    return createHostPluginDefinitions(snapshot, appInfo, (pluginId) =>
      pluginId === agentWorkspaceContract.id
        ? agentWorkspaceHost
        : pluginId === 'pictor.updater'
          ? updaterHost
          : undefined,
    )
  }
}
