import { DSH } from './wire.js'
import type { SessionFollowFrame, SessionFollowRequest } from './session.js'

/** How long a subscription may take to prove itself before the prompt proceeds. */
const READY_TIMEOUT = 5_000

/**
 * The narrow WebSocket surface this client needs.
 *
 * The runtime mux authenticates with the session cookie, and the browser-style
 * `WebSocket` cannot send headers, so the implementation is injected: the app
 * passes `ws`, the tests pass a recorder. Keeping the dependency out of this
 * package means it stays buildable without a native or optional-dependency tree.
 */
export interface WebSocketLike {
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void
  send(data: string): void
  close(): void
}

export type WebSocketConstructor = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocketLike

export interface FollowStreamOptions {
  /** Gateway mux route, e.g. `ws://127.0.0.1:42317/api/remote.mux`. */
  url: string
  /** Session cookie obtained from the boot token. */
  cookie: string
  onFrame: (frame: SessionFollowFrame) => void
  onError?: (error: Error) => void
  onClose?: () => void
  /** Injected so tests do not need a real socket. */
  WebSocket: WebSocketConstructor
}

/** Host frames the gateway sends back for one logical stream. */
type ServerFrame =
  | { type: 'item'; streamId: string; value?: unknown }
  | { type: 'error'; streamId: string; error: { code?: string; message?: string } }
  | { type: 'end'; streamId: string }

/**
 * One live session subscription.
 *
 * The first item is a complete snapshot, after which durable events arrive in
 * order. Reconnecting is therefore "open a new stream", not "resume a cursor":
 * the runtime replays the opening window itself.
 */
export class FollowStream {
  readonly #options: FollowStreamOptions
  readonly #streamId: string
  #socket: WebSocketLike | null = null
  #closed = false

  constructor(options: FollowStreamOptions, streamId = 'follow') {
    this.#options = options
    this.#streamId = streamId
  }

  get active(): boolean {
    return this.#socket !== null && !this.#closed
  }

  /** Open the stream and subscribe to one session address. */
  open(request: SessionFollowRequest): Promise<void> {
    if (this.#socket !== null) throw new Error('harness: follow stream already open')

    const socket = this.#options.WebSocket(this.#options.url, {
      headers: { cookie: this.#options.cookie },
    })
    this.#socket = socket

    return new Promise<void>((resolve) => {
      // The caller must not send a prompt before the runtime has registered this
      // subscription: frames produced in between arrive as one backlog instead of
      // as a stream, which is exactly what streaming must not look like.
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      // A stream that never answers still must not block the prompt forever; the
      // subscription keeps working and simply resolves late.
      const timeout = setTimeout(settle, READY_TIMEOUT) as { unref?: () => void }
      timeout.unref?.()

      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            type: 'open',
            streamId: this.#streamId,
            endpoint: DSH.session.follow,
            payload: { args: { request } },
          }),
        )
      })

      socket.on('message', (data) => {
        this.#handle(String(data))
        settle()
      })

      socket.on('error', (reason) => {
        this.#fail(reason instanceof Error ? reason : new Error(String(reason)))
        settle()
      })

      socket.on('close', () => {
        if (!this.#closed) {
          this.#closed = true
          this.#socket = null
          this.#options.onClose?.()
        }
        settle()
      })
    })
  }

  /** Drop the stream; the runtime keeps the session, only this view goes away. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    const socket = this.#socket
    this.#socket = null
    socket?.close()
  }

  #handle(text: string): void {
    let frame: ServerFrame
    try {
      frame = JSON.parse(text) as ServerFrame
    } catch {
      this.#fail(new Error(`harness: follow 收到非 JSON 帧：${text.slice(0, 200)}`))
      return
    }

    if (frame.type === 'error') {
      const code = frame.error.code ?? 'unknown'
      const message = frame.error.message ?? '未知错误'
      this.#fail(new Error(`harness: follow 流失败：${code}: ${message}`))
      return
    }
    if (frame.type === 'end') {
      this.close()
      return
    }
    if (frame.type !== 'item') return
    if (frame.streamId !== this.#streamId) return
    if (frame.value === undefined || frame.value === null) return
    this.#options.onFrame(frame.value as SessionFollowFrame)
  }

  #fail(error: Error): void {
    if (this.#closed) return
    this.#options.onError?.(error)
    this.close()
  }
}
