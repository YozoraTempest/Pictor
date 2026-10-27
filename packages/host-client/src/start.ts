import { createStdioTransport } from '@vulonlok/racp'
import type { StdioTransport } from '@vulonlok/racp'

import { HostCoreClient } from './metadata-store.js'

export interface StartHostCoreOptions {
  command: string
  database: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  onStderr?: (line: string) => void
}

export interface RunningHostCore {
  readonly client: HostCoreClient
  readonly transport: StdioTransport
  dispose(): void
}

export function startHostCore(options: StartHostCoreOptions): RunningHostCore {
  const transport = createStdioTransport({
    command: options.command,
    args: ['--database', options.database],
    cwd: options.cwd,
    env: options.env,
    onStderr: options.onStderr,
  })

  const client = new HostCoreClient(transport, options.timeoutMs)

  return {
    client,
    transport,
    dispose(): void {
      client.dispose()
    },
  }
}
