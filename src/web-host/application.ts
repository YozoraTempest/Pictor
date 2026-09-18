import { join } from 'node:path'

import {
  ProfileFileLock,
  createNodeApplication,
  type ApplicationHostServices,
  type NodeApplicationServices,
} from '../application/index.js'
import { agentWorkspaceContract } from '../modules/agent-workspace/shared.js'
import { resolveFrontendIdentity } from '../node/frontend-identity.js'
import { webDeveloperPluginProfile, webPluginProfile } from '../plugin/default-profile.js'
import { appInfoSchema } from '../shared/app-info.js'
import type { ModuleEventEnvelope } from '../kernel/contract.js'
import { detectDesktopDistribution } from '../node/linux-distribution.js'
import { SecretStore } from '../node/persistence/secret-store.js'
import { EventHub } from './event-hub.js'

export interface WebApplicationOptions {
  readonly projectRoot: string
  readonly userDataDirectory: string
  readonly runtimeHostPath: string
  readonly safeMode?: boolean
  readonly profile?: 'default' | 'developer'
  readonly creationMode?: boolean
}

export interface WebApplicationServices {
  readonly applicationHost: NodeApplicationServices['applicationHost']
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
  const moduleEvents = new EventHub<ModuleEventEnvelope>()
  const application = await createNodeApplication({
    userDataDirectory: options.userDataDirectory,
    runtimeHostPath: options.runtimeHostPath,
    appInfo,
    bundledPluginsDirectory: identity.bundledPluginsDirectory,
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
    secretStore: new SecretStore(join(options.userDataDirectory, 'data-v1')),
  })

  return { ...application, moduleEvents }
}
