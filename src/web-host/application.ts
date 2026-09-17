import { join } from 'node:path'

import {
  ApplicationHost,
  ModelConnectionTester,
  ProfileFileLock,
  type ApplicationHostServices,
  type HostPluginDefinitionsFactory,
  type UserData,
} from '../application/index.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import type { UpdaterHostAdapter } from '../modules/updater/host.js'
import { resolveFrontendIdentity } from '../node/frontend-identity.js'
import { createHostPluginDefinitions } from '../plugin/loader.js'
import { webDeveloperPluginProfile, webPluginProfile } from '../plugin/default-profile.js'
import { RuntimeSupervisor } from '../runtime/supervisor.js'
import { appInfoSchema } from '../shared/app-info.js'
import type { ModuleEventEnvelope } from '../kernel/contract.js'
import { detectDesktopDistribution } from '../node/linux-distribution.js'
import { SecretStore } from '../node/persistence/secret-store.js'
import { EventHub } from './event-hub.js'
import { openExternalUrl } from './open-external.js'

export interface WebApplicationOptions {
  readonly projectRoot: string
  readonly userDataDirectory: string
  readonly runtimeHostPath: string
  readonly safeMode?: boolean
  readonly profile?: 'default' | 'developer'
  readonly creationMode?: boolean
}

export interface WebApplicationServices {
  readonly applicationHost: ApplicationHost
  readonly services: ApplicationHostServices
  readonly moduleEvents: EventHub<ModuleEventEnvelope>
}

export async function createWebApplication(
  options: WebApplicationOptions,
): Promise<WebApplicationServices> {
  const identity = resolveFrontendIdentity({ projectRoot: options.projectRoot })
  const distribution = await detectDesktopDistribution()
  const appInfo = appInfoSchema.parse({
    name: 'Pictor',
    version: identity.version,
    buildChannel: identity.buildChannel,
    sourceCommit: identity.sourceCommit,
    platform: process.platform,
    arch: process.arch,
    distribution,
  })
  const userData: UserData = {
    userDataDirectory: options.userDataDirectory,
    dataDirectory: join(options.userDataDirectory, 'data-v1'),
  }
  const moduleEvents = new EventHub<ModuleEventEnvelope>()
  const coordinatorReference: { current?: ApplicationHostServices['runtime'] } = {}
  const runtimeSupervisor = new RuntimeSupervisor(
    (event) => coordinatorReference.current?.handleEvent(event),
    undefined,
    (request) =>
      coordinatorReference.current?.handleSessionReplacementRequest(request) ??
      Promise.resolve({ accepted: false, message: 'Runtime Coordinator is unavailable' }),
    { runtimeHostPath: options.runtimeHostPath },
  )
  const applicationHost = new ApplicationHost({
    userData,
    appInfo,
    bundledPluginsDirectory: identity.bundledPluginsDirectory,
    runtimeHost: runtimeSupervisor,
    eventPublisher: {
      publish: (event) =>
        moduleEvents.publish({
          moduleId: agentWorkspaceContract.id,
          event: 'runtimeEvent',
          payload: event,
        }),
    },
    frontendLock: new ProfileFileLock(options.userDataDirectory, { frontend: 'web' }),
    profile: options.profile === 'developer' ? webDeveloperPluginProfile : webPluginProfile,
    safeMode: options.safeMode ?? false,
    creationMode: options.creationMode ?? false,
    secretStore: new SecretStore(userData.dataDirectory),
    createHostPluginDefinitions: createWebHostPluginDefinitions,
  })

  const services = await applicationHost.start()
  coordinatorReference.current = services.runtime
  return { applicationHost, services, moduleEvents }
}

const createWebHostPluginDefinitions: HostPluginDefinitionsFactory = (
  snapshot,
  appInfo,
  context,
) => {
  const agentWorkspaceHost = {
    repository: context.repository,
    runtime: context.runtime,
    connectionTester: new ModelConnectionTester(),
  }
  const updaterHost: UpdaterHostAdapter = {
    fetch: globalThis.fetch,
    openExternal: openExternalUrl,
  }
  return createHostPluginDefinitions(snapshot, appInfo, (pluginId) =>
    pluginId === agentWorkspaceContract.id
      ? agentWorkspaceHost
      : pluginId === 'pictor.updater'
        ? updaterHost
        : undefined,
  )
}
