import type { WebSocketConstructor, WebSocketLike } from './follow.js'

/** How long the stream may take to prove itself before the caller moves on. */
const READY_TIMEOUT = 5_000

/**
 * One waterfall event forwarded to this client.
 *
 * The runtime asks a question and waits for the answer; `eventId` is the handle
 * the answer has to quote, and `request` is whatever the asking plugin projected
 * for a client to read.
 */
export interface RemoteWaterfallFrame {
  type: 'waterfall'
  /** Event name, for example `approval/request`. */
  event: string
  eventId: string
  agentId?: string
  request?: unknown
}

/** Host frames the gateway sends back for one logical stream. */
type ServerFrame =
  | { type: 'item'; streamId: string; value?: unknown }
  | { type: 'error'; streamId: string; error?: { code?: string; message?: string } }
  | { type: 'end'; streamId: string }

export interface EventStreamOptions {
  /** Gateway mux route, e.g. `ws://127.0.0.1:42317/api/remote.mux`. */
  url: string
  /** Session cookie obtained from the boot token. */
  cookie: string
  onWaterfall: (frame: RemoteWaterfallFrame) => void
  /** Fires once with the client id every answer must quote. */
  onReady?: (clientId: string) => void
  onError?: (error: Error) => void
  onClose?: () => void
  /** Injected so tests do not need a real socket. */
  WebSocket: WebSocketConstructor
}

/**
 * The runtime's application-wide event stream.
 *
 * Separate from a session stream on purpose: a session subscription reports what
 * happens in one conversation, while this one carries the questions the runtime
 * needs a client to answer. Only an owner client may answer, so a connection that
 * never reads this stream leaves every request unavailable.
 */
export class EventStream {
  readonly #options: EventStreamOptions
  readonly #streamId = '$events'
  #socket: WebSocketLike | null = null
  #closed = false
  #clientId: string | null = null

  constructor(options: EventStreamOptions) {
    this.#options = options
  }

  get active(): boolean {
    return this.#socket !== null && !this.#closed
  }

  /** Id this client must quote when it answers; null until the runtime greets. */
  get clientId(): string | null {
    return this.#clientId
  }

  /** Subscribe and resolve once the runtime has proved the stream is live. */
  open(): Promise<void> {
    if (this.#socket !== null) throw new Error('harness: event stream already open')

    const socket = this.#options.WebSocket(this.#options.url, {
      headers: { cookie: this.#options.cookie },
    })
    this.#socket = socket

    return new Promise<void>((resolve) => {
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const timeout = setTimeout(settle, READY_TIMEOUT) as { unref?: () => void }
      timeout.unref?.()

      socket.on('open', () => {
        // `$events` is a gateway-owned stream: its arguments must be an empty
        // object, and it takes no session address.
        socket.send(
          JSON.stringify({
            type: 'open',
            streamId: this.#streamId,
            endpoint: '$events',
            payload: { args: {} },
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
      this.#fail(new Error(`harness: $events 收到非 JSON 帧：${text.slice(0, 200)}`))
      return
    }

    if (frame.type === 'error') {
      const code = frame.error?.code ?? 'unknown'
      const message = frame.error?.message ?? '未知错误'
      this.#fail(new Error(`harness: $events 流失败：${code}: ${message}`))
      return
    }
    if (frame.type === 'end') {
      this.close()
      return
    }
    if (frame.type !== 'item') return
    if (frame.streamId !== this.#streamId) return
    if (frame.value === undefined || frame.value === null) return

    const value = frame.value as { type?: unknown; clientId?: unknown }
    if (value.type === 'ready') {
      if (typeof value.clientId === 'string') {
        this.#clientId = value.clientId
        this.#options.onReady?.(value.clientId)
      }
      return
    }
    if (value.type !== 'waterfall') return

    const waterfall = frame.value as RemoteWaterfallFrame
    if (typeof waterfall.event !== 'string' || typeof waterfall.eventId !== 'string') return
    this.#options.onWaterfall(waterfall)
  }

  #fail(error: Error): void {
    if (this.#closed) return
    this.#options.onError?.(error)
    this.close()
  }
}
