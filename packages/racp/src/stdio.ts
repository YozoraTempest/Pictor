import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { RpcTransport } from './client.js'

export interface StdioTransportOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  onStderr?: (line: string) => void
}

export interface StdioTransport extends RpcTransport {
  readonly child: ChildProcessWithoutNullStreams
}

/**
 * Spawns a long-lived child process and speaks NDJSON over its stdio.
 *
 * stderr is forwarded to `onStderr` only; it never pollutes the framed stream.
 */
export function createStdioTransport(options: StdioTransportOptions): StdioTransport {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const lineListeners = new Set<(line: string) => void>()
  const closeListeners = new Set<(error: Error) => void>()
  let closed = false

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const forward = (): void => {
      child.kill(signal)
    }
    process.once(signal, forward)
    child.once('exit', () => process.off(signal, forward))
  }

  const stdout = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  stdout.on('line', (line) => {
    if (line.trim().length === 0) return
    for (const listener of lineListeners) listener(line)
  })

  if (options.onStderr !== undefined) {
    const stderr = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY })
    stderr.on('line', options.onStderr)
  }

  const notifyClose = (error: Error): void => {
    if (closed) return
    closed = true
    for (const listener of closeListeners) listener(error)
  }

  child.on('error', (error) => notifyClose(error))

  child.on('exit', (code, signal) => {
    notifyClose(new Error(`host core exited (code=${String(code)}, signal=${String(signal)})`))
  })

  return {
    child,
    send(line: string): void {
      if (child.stdin.destroyed) {
        throw new Error('host core stdin is closed')
      }
      child.stdin.write(`${line}\n`)
    },
    onLine(listener): () => void {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onClose(listener): () => void {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close(): void {
      stdout.close()
      if (!child.killed) child.kill()
    },
  }
}
