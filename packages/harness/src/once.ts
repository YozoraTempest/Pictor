import type { WebSocketConstructor, WebSocketLike } from './follow.js'

/**
 * Read the first frame of a Remote stream and close it.
 *
 * The runtime has two shapes of stream: one that keeps reporting (`session/follow`)
 * and one that answers with the current set and then has nothing to say until
 * something changes (`job/list`). Pictor needs the second kind only as a snapshot, so
 * this opens the stream, takes the opening item — which the runtime documents as a
 * complete set, so a reconnect's first frame is already the truth — and hangs up.
 *
 * Failure is honest rather than silent: a stream that never answers resolves nothing
 * and rejects, because a roster that quietly came back empty would draw a conversation
 * with no background work while four jobs were running.
 */

/** Server frames on the mux, as the gateway sends them. */
type ServerFrame =
  | { type: 'item'; streamId?: string; value?: unknown }
  | { type: 'error'; streamId?: string; error?: { code?: string; message?: string } }
  | { type: 'end'; streamId?: string }

export interface OnceStreamOptions {
  /** Gateway mux route, e.g. `ws://127.0.0.1:42317/api/remote.mux`. */
  url: string
  /** Session cookie obtained from the boot token. */
  cookie: string
  /** Remote endpoint name, e.g. `job/list`. */
  endpoint: string
  /** The endpoint's one argument, sent as `{ args: { request } }`. */
  request: unknown
  /** Injected so tests do not need a real socket. */
  WebSocket: WebSocketConstructor
  /** Fails instead of waiting forever; a stuck runtime must surface. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 10_000

/** One stream, one value, then the socket is closed. */
export async function streamOnce(options: OnceStreamOptions): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const streamId = `once-${options.endpoint}-${String(Date.now())}`

  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let socket: WebSocketLike | null = null

    const settle = (outcome: { value: unknown } | { error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.close()
      if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.value)
    }

    const timer = setTimeout(() => {
      settle({
        error: new Error(`harness: ${options.endpoint} 在 ${String(timeoutMs)}ms 内没有回答`),
      })
    }, timeoutMs)
    ;(timer as { unref?: () => void }).unref?.()

    try {
      socket = options.WebSocket(options.url, { headers: { cookie: options.cookie } })
    } catch (error) {
      settle({ error: error instanceof Error ? error : new Error(String(error)) })
      return
    }

    socket.on('open', () => {
      socket?.send(
        JSON.stringify({
          type: 'open',
          streamId,
          endpoint: options.endpoint,
          payload: { args: { request: options.request } },
        }),
      )
    })

    socket.on('message', (data) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(String(data)) as ServerFrame
      } catch {
        settle({ error: new Error(`harness: ${options.endpoint} 收到非 JSON 帧`) })
        return
      }

      if (frame.type === 'error') {
        const code = frame.error?.code ?? 'unknown'
        const message = frame.error?.message ?? '未知错误'
        settle({ error: new Error(`harness: ${options.endpoint} 失败：${code}: ${message}`) })
        return
      }
      // An `end` before any item means the endpoint had nothing to say at all: that is
      // an empty answer, not a failure.
      if (frame.type === 'end') {
        settle({ value: null })
        return
      }
      if (frame.type !== 'item') return
      settle({ value: frame.value ?? null })
    })

    socket.on('error', (reason) => {
      settle({ error: reason instanceof Error ? reason : new Error(String(reason)) })
    })

    socket.on('close', () => {
      // A socket that closes before answering is a failed read, not an empty one.
      settle({ error: new Error(`harness: ${options.endpoint} 的流在回答前关闭`) })
    })
  })
}
