import { PiAgentRuntime } from './pi-adapter.js'
import { runtimeCommandSchema } from './protocol.js'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Pictor runtime host requires an Electron utility-process parent')

const runtime = new PiAgentRuntime((event) => parentPort.postMessage(event))

parentPort.on('message', (messageEvent) => {
  const parsed = runtimeCommandSchema.safeParse(messageEvent.data)
  if (!parsed.success) {
    parentPort.postMessage({ type: 'host.fatal', message: 'Runtime command validation failed' })
    return
  }

  const command = parsed.data
  if (command.type === 'start') {
    void runtime.start(command)
    return
  }
  if (command.type === 'approve') {
    runtime.resolveApproval(command.runId, command.callId, true)
    return
  }
  if (command.type === 'reject') {
    runtime.resolveApproval(command.runId, command.callId, false)
    return
  }
  if (command.type === 'abort') {
    void runtime.abort(command.runId)
    return
  }
  void runtime.dispose().finally(() => process.exit(0))
})

parentPort.postMessage({ type: 'host.ready' })
