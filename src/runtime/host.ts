import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type RuntimePluginContext } from '../plugin/entry.js'
import { PluginHost, type PluginDefinition } from '../plugin/host.js'
import { runtimePluginBootstrapSchema } from '../shared/plugins.js'
import { runtimeCommandSchema, type RuntimeEvent } from '../shared/runtime-protocol.js'
import {
  agentRuntimeContributions,
  modelRuntimeProviderContributions,
  piExtensionPathContributions,
  type AgentRuntimeProvider,
} from './plugin-interface.js'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Pictor runtime host requires an Electron utility-process parent')

interface RuntimeHostState {
  host: PluginHost
  runtime: AgentRuntimeProvider | null
}

function reportFatal(error: unknown): void {
  parentPort.postMessage({
    type: 'host.fatal',
    message: error instanceof Error ? error.message : 'Agent Runtime 加载失败',
  })
}

const statePromise = (async (): Promise<RuntimeHostState> => {
  const bootstrapSource = process.env.PICTOR_RUNTIME_PLUGIN_BOOTSTRAP
  if (!bootstrapSource) throw new Error('Missing Runtime Plugin bootstrap')
  const bootstrap = runtimePluginBootstrapSchema.parse(JSON.parse(bootstrapSource))
  const emit = (event: RuntimeEvent) => parentPort.postMessage(event)
  const definitions: PluginDefinition[] = bootstrap.plugins.map(
    ({ manifest, desiredState, dataPath, runtimeEntryPath }) => ({
      manifest,
      desiredState,
      async createModules() {
        if (!runtimeEntryPath) return []
        const namespace: unknown = await import(pathToFileURL(runtimeEntryPath).toString())
        if (!namespace || typeof namespace !== 'object') {
          throw new Error(`Invalid Runtime Plugin entry: ${manifest.id}`)
        }
        const entrypoint = readPluginEntrypoint<RuntimePluginContext>(
          namespace as Record<string, unknown>,
        )
        return entrypoint({ process: 'runtime', dataPath, emit, extensions: bootstrap.extensions })
      },
    }),
  )
  const host = new PluginHost({
    pictorVersion: bootstrap.pictorVersion,
    safeMode: bootstrap.safeMode,
  })
  await host.start(definitions)
  const runtimes = host.getContributions(agentRuntimeContributions)
  if (runtimes.length > 1) throw new Error('Multiple Agent Runtime Providers are active')
  runtimes[0]?.configure({
    extensionPaths: host.getContributions(piExtensionPathContributions),
    skillPaths: bootstrap.skills,
    promptPaths: bootstrap.prompts,
    modelProviders: host.getContributions(modelRuntimeProviderContributions),
  })
  parentPort.postMessage({ type: 'host.ready' })
  return { host, runtime: runtimes[0] ?? null }
})().catch((error) => {
  reportFatal(error)
  throw error
})

function requireRuntime(state: RuntimeHostState): AgentRuntimeProvider {
  if (!state.runtime) {
    const failures = state.host
      .getStatuses()
      .filter(({ effectiveState }) => effectiveState === 'failed' || effectiveState === 'blocked')
      .map(({ id, reason }) => `${id}: ${reason ?? 'unavailable'}`)
    throw new Error(
      failures.length > 0
        ? `Agent Runtime Provider is unavailable (${failures.join('; ')})`
        : 'Agent Runtime Provider is not installed or enabled',
    )
  }
  return state.runtime
}

parentPort.on('message', (messageEvent) => {
  const parsed = runtimeCommandSchema.safeParse(messageEvent.data)
  if (!parsed.success) {
    parentPort.postMessage({ type: 'host.fatal', message: 'Runtime command validation failed' })
    return
  }

  const command = parsed.data
  if (command.type === 'dispose') {
    void statePromise
      .then(({ host }) => host.stop())
      .catch(reportFatal)
      .finally(() => process.exit(0))
    return
  }

  if (command.type === 'fork') {
    void statePromise
      .then((state) => requireRuntime(state).fork(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.forkResult',
          operationId: command.operationId,
          targetSessionId: command.targetSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.forkResult',
          operationId: command.operationId,
          targetSessionId: command.targetSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Fork failed',
        }),
      )
    return
  }

  if (command.type === 'import') {
    void statePromise
      .then((state) => requireRuntime(state).importSession(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.importResult',
          operationId: command.operationId,
          targetSessionId: command.targetSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.importResult',
          operationId: command.operationId,
          targetSessionId: command.targetSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Import failed',
        }),
      )
    return
  }

  if (command.type === 'export') {
    void statePromise
      .then((state) => requireRuntime(state).exportSession(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.exportResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.exportResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Export failed',
        }),
      )
    return
  }

  void statePromise
    .then((state) => {
      const runtime = requireRuntime(state)
      if (command.type === 'start') return runtime.start(command)
      if (command.type === 'approve') {
        runtime.resolveApproval(command.runId, command.callId, true)
        return
      }
      if (command.type === 'reject') {
        runtime.resolveApproval(command.runId, command.callId, false)
        return
      }
      if (command.type === 'extension.ui.respond') {
        runtime.respondToExtensionUi(command.requestId, command.value)
        return
      }
      if (command.type === 'steer' || command.type === 'follow-up') {
        return runtime.queueMessage(command.runId, command.type, command.message)
      }
      if (command.type === 'clear-queue') {
        runtime.clearQueue(command.runId)
        return
      }
      return runtime.abort(command.runId)
    })
    .catch(reportFatal)
})
