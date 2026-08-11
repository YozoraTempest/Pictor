import { runtimeCommandSchema } from './protocol.js'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Pictor runtime host requires an Electron utility-process parent')

const runtimePromise = import('./pi-adapter.js').then(
  ({ PiAgentRuntime }) => new PiAgentRuntime((event) => parentPort.postMessage(event)),
)

function reportFatal(error: unknown): void {
  parentPort.postMessage({
    type: 'host.fatal',
    message: error instanceof Error ? error.message : 'Agent Runtime 加载失败',
  })
}

parentPort.on('message', (messageEvent) => {
  const parsed = runtimeCommandSchema.safeParse(messageEvent.data)
  if (!parsed.success) {
    parentPort.postMessage({ type: 'host.fatal', message: 'Runtime command validation failed' })
    return
  }

  const command = parsed.data
  if (command.type === 'start') {
    void runtimePromise.then((runtime) => runtime.start(command)).catch(reportFatal)
    return
  }
  if (command.type === 'approve') {
    void runtimePromise
      .then((runtime) => runtime.resolveApproval(command.runId, command.callId, true))
      .catch(reportFatal)
    return
  }
  if (command.type === 'reject') {
    void runtimePromise
      .then((runtime) => runtime.resolveApproval(command.runId, command.callId, false))
      .catch(reportFatal)
    return
  }
  if (command.type === 'abort') {
    void runtimePromise.then((runtime) => runtime.abort(command.runId)).catch(reportFatal)
    return
  }
  void runtimePromise
    .then((runtime) => runtime.dispose())
    .catch(reportFatal)
    .finally(() => process.exit(0))
})

parentPort.postMessage({ type: 'host.ready' })
