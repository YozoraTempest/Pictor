import type { WebSocketConstructor } from './follow.js'

/**
 * Read a stream until it ends, or until a budget says enough.
 *
 * `streamOnce` answers "give me the current set"; this answers "give me what this stream
 * says until it stops". That is the shape of `job/follow`: an opening anchor, a run of
 * output frames, then one terminal frame — except for a job that is still running, whose
 * stream stays open by design. Waiting for such a stream to end would hang the window on
 * a healthy job, so the budget is the ordinary way out and `ended` says which happened.
 */

type ServerFrame =
  | { type: 'item'; streamId?: string; value?: unknown }
  | { type: 'error'; streamId?: string; error?: { code?: string; message?: string } }
  | { type: 'end'; streamId?: string }

export interface CollectStreamOptions {
  /** Gateway mux route, e.g. `ws://127.0.0.1:42317/api/remote.mux`. */
  url: string
  /** Session cookie obtained from the boot token. */
  cookie: string
  /** Remote endpoint name, e.g. `job/follow`. */
  endpoint: string
  /** The endpoint's one argument, sent as `{ args: { request } }`. */
  request: unknown
  /** Injected so tests do not need a real socket. */
  WebSocket: WebSocketConstructor
  /**
   * How long to keep listening for more.
   *
   * Not a failure: a stream that is still open when the budget runs out resolves with
   * what arrived (`ended: false`). A live job is not an error.
   */
  budgetMs?: number
}

export interface CollectedStream {
  /** Item values, in arrival order. */
  items: unknown[]
  /** True when the stream closed by itself instead of hitting the budget. */
  ended: boolean
}

const DEFAULT_BUDGET = 4_000

/** Collects one stream's items until it ends or the budget runs out. */
export async function streamCollect(options: CollectStreamOptions): Promise<CollectedStream> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET
  const streamId = `collect-${options.endpoint}-${String(Date.now())}`

  return new Promise<CollectedStream>((resolve, reject) => {
    const items: unknown[] = []
    let settled = false
    let socket: ReturnType<WebSocketConstructor> | null = null

    const settle = (outcome: { value: CollectedStream } | { error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.close()
      if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.value)
    }

    const finish = (): void => settle({ value: { items, ended: true } })

    // The budget expiring keeps what arrived: for a running job that *is* the answer.
    const timer = setTimeout(() => settle({ value: { items, ended: false } }), budgetMs)
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
      if (frame.type === 'end') {
        finish()
        return
      }
      if (frame.type !== 'item') return
      items.push(frame.value ?? null)
    })

    socket.on('error', (reason) => {
      // Nothing arrived: this is a failed read, not an empty one.
      if (items.length === 0)
        settle({ error: reason instanceof Error ? reason : new Error(String(reason)) })
      else finish()
    })

    socket.on('close', () => {
      // A closed stream after items is the terminal frame's doing; before any item it is
      // a read that produced nothing.
      if (items.length === 0) {
        settle({ error: new Error(`harness: ${options.endpoint} 的流在回答前关闭`) })
        return
      }
      finish()
    })
  })
}
