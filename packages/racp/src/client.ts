import type { JsonValue } from '@pictor/shared'

import { RpcError, encodeRequest, parseResponse } from './frame.js'

/**
 * The transport abstraction exists so the protocol is not welded to stdio.
 * A future remote host can supply a WebSocket transport without touching the
 * client or any caller.
 */
export interface RpcTransport {
  send(line: string): void
  onLine(listener: (line: string) => void): () => void
  onClose(listener: (error: Error) => void): () => void
  close(): void
}

interface PendingRequest {
  resolve: (value: JsonValue) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RequestOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export class RpcClient {
  readonly #transport: RpcTransport
  readonly #defaultTimeoutMs: number
  readonly #pending = new Map<number, PendingRequest>()
  readonly #unsubscribeLine: () => void
  readonly #unsubscribeClose: () => void

  #nextId = 1
  #disposed = false

  constructor(transport: RpcTransport, defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#transport = transport
    this.#defaultTimeoutMs = defaultTimeoutMs
    this.#unsubscribeLine = transport.onLine((line) => this.#handleLine(line))
    this.#unsubscribeClose = transport.onClose((error) => this.#failAll(error))
  }

  request<T = JsonValue>(method: string, params?: JsonValue, options?: RequestOptions): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(new Error('RPC client is disposed'))
    }

    const id = this.#nextId++
    const timeoutMs = options?.timeoutMs ?? this.#defaultTimeoutMs

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`RPC request timed out after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      timer.unref?.()

      this.#pending.set(id, {
        resolve: resolve as (value: JsonValue) => void,
        reject,
        timer,
      })

      try {
        const frame =
          params === undefined
            ? { jsonrpc: '2.0' as const, id, method }
            : { jsonrpc: '2.0' as const, id, method, params }
        this.#transport.send(encodeRequest(frame))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribeLine()
    this.#unsubscribeClose()
    this.#failAll(new Error('RPC client disposed'))
    this.#transport.close()
  }

  #handleLine(line: string): void {
    let frame
    try {
      frame = parseResponse(line)
    } catch (error) {
      this.#failAll(error as Error)
      return
    }

    if (frame.id === null) {
      // Server-side parse failures carry no id; nothing can be correlated.
      return
    }

    const pending = this.#pending.get(frame.id)
    if (pending === undefined) return

    this.#pending.delete(frame.id)
    clearTimeout(pending.timer)

    if (frame.error !== undefined) {
      pending.reject(new RpcError(frame.error))
      return
    }

    pending.resolve(frame.result ?? null)
  }

  #failAll(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.#pending.delete(id)
    }
  }
}
