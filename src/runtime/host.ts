import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type RuntimePluginContext } from '../plugin/entry.js'
import { PluginHost, type PluginDefinition } from '../plugin/host.js'
import { runtimePluginBootstrapSchema } from '../shared/plugins.js'
import {
  runtimeCommandSchema,
  type RuntimeEvent,
  type RuntimeSessionReplacementRequest,
} from '../shared/runtime-protocol.js'
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

const pendingReplacementAcks = new Map<
  string,
  (result: { accepted: boolean; targetSessionId?: string; message?: string }) => void
>()

function requestSessionReplacement(
  request: RuntimeSessionReplacementRequest,
): Promise<{ accepted: boolean; targetSessionId?: string; message?: string }> {
  const key = `${request.operationId}:${request.phase}`
  return new Promise((resolve) => {
    pendingReplacementAcks.set(key, resolve)
    parentPort.postMessage(request)
  })
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
    requestSessionReplacement,
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
  if (command.type === 'session.replacement.ack') {
    const resolve = pendingReplacementAcks.get(`${command.operationId}:${command.phase}`)
    if (resolve) {
      pendingReplacementAcks.delete(`${command.operationId}:${command.phase}`)
      resolve({
        accepted: command.accepted,
        ...(command.targetSessionId ? { targetSessionId: command.targetSessionId } : {}),
        ...(command.message ? { message: command.message } : {}),
      })
    }
    return
  }

  if (command.type === 'reload-resources') {
    void statePromise
      .then((state) => requireRuntime(state).reloadResources(command.sessionId))
      .then(() =>
        parentPort.postMessage({
          type: 'host.reloadResult',
          sessionId: command.sessionId,
          outcome: 'completed',
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.reloadResult',
          sessionId: command.sessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi resource reload failed',
        }),
      )
    return
  }

  if (command.type === 'session.open' || command.type === 'session.close') {
    void statePromise
      .then((state) => {
        const runtime = requireRuntime(state)
        return command.type === 'session.open'
          ? runtime.openSession(command)
          : runtime.closeSession()
      })
      .then(() =>
        parentPort.postMessage({
          type: 'host.sessionResult',
          operationId: command.operationId,
          sessionId: command.sessionId,
          outcome: command.type === 'session.open' ? 'opened' : 'closed',
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.sessionResult',
          operationId: command.operationId,
          sessionId: command.sessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session operation failed',
        }),
      )
    return
  }

  if (command.type === 'controls.get') {
    void statePromise
      .then((state) => {
        const controls = requireRuntime(state).getRuntimeControls(command.sessionId)
        if (!controls) throw new Error('Pi Session is not open')
        parentPort.postMessage(controls)
      })
      .catch(reportFatal)
    return
  }

  if (command.type === 'controls.set') {
    void statePromise
      .then((state) =>
        requireRuntime(state).setRuntimeControls(command.sessionId, {
          modelId: command.modelId,
          thinkingLevel: command.thinkingLevel,
          activeTools: command.activeTools,
          steeringMode: command.steeringMode,
          followUpMode: command.followUpMode,
        }),
      )
      .then(() =>
        parentPort.postMessage({
          type: 'host.controlsSetResult',
          requestId: command.requestId,
          sessionId: command.sessionId,
          outcome: 'completed',
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.controlsSetResult',
          requestId: command.requestId,
          sessionId: command.sessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Session Controls update failed',
        }),
      )
    return
  }
  if (command.type === 'dispose') {
    void statePromise
      .then(({ host }) => host.stop())
      .catch(reportFatal)
      .finally(() => process.exit(0))
    return
  }

  if (command.type === 'abort-session-operation') {
    void statePromise
      .then((state) => requireRuntime(state).abortSessionOperation(command.operationId))
      .catch(reportFatal)
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

  if (command.type === 'navigate') {
    void statePromise
      .then((state) => requireRuntime(state).navigateSession(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.navigateResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.navigateResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Tree Navigation failed',
        }),
      )
    return
  }

  if (command.type === 'compact') {
    void statePromise
      .then((state) => requireRuntime(state).compactSession(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.compactResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.compactResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Compaction failed',
        }),
      )
    return
  }

  if (command.type === 'label') {
    void statePromise
      .then((state) => requireRuntime(state).labelSessionEntry(command))
      .then((result) =>
        parentPort.postMessage({
          type: 'host.labelResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          ...result,
        }),
      )
      .catch((error) =>
        parentPort.postMessage({
          type: 'host.labelResult',
          operationId: command.operationId,
          sourceSessionId: command.sourceSessionId,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Pi Session Label failed',
        }),
      )
    return
  }

  void statePromise
    .then((state) => {
      const runtime = requireRuntime(state)
      if (command.type === 'start') return runtime.start(command)
      if (command.type === 'extension.ui.respond') {
        runtime.respondToExtensionUi(command.requestId, command.value)
        return
      }
      if (command.type === 'extension.composer.update') {
        runtime.updateComposerText(command.sessionId, command.text)
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
