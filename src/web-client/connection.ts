import {
  WEB_EVENT_PATH,
  webClientIdSchema,
  webClientMessageSchema,
  webServerMessageSchema,
  type WebClientMessage,
  type WebServerMessage,
} from '../shared/web-protocol.js'

const CLIENT_ID_KEY = 'pictor.web.client-id'
const MAX_RECONNECT_DELAY_MS = 2_000

export type WebConnectionState =
  'connecting' | 'ready' | 'reconnecting' | 'lease-conflict' | 'stopped'

export class WebEventConnection {
  private readonly listeners = new Set<(message: WebServerMessage) => void>()
  private readonly stateListeners = new Set<(state: WebConnectionState) => void>()
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 250
  private stopped = false
  private startPromise: Promise<void> | null = null
  private startResolve: (() => void) | null = null
  private startReject: ((error: Error) => void) | null = null
  private state: WebConnectionState = 'connecting'

  readonly clientId = loadClientId()

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve
      this.startReject = reject
    })
    this.connect()
    return this.startPromise
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.close(1000, 'Web GUI stopped')
    this.socket = null
    this.setState('stopped')
  }

  send(message: WebClientMessage): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(webClientMessageSchema.parse(message)))
  }

  onMessage(listener: (message: WebServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onState(listener: (state: WebConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  private connect(): void {
    if (this.stopped) return
    const url = new URL(WEB_EVENT_PATH, window.location.href)
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('clientId', this.clientId)
    const socket = new WebSocket(url)
    this.socket = socket

    socket.addEventListener('message', (event) => {
      let source: unknown
      try {
        source = JSON.parse(String(event.data))
      } catch {
        return
      }
      const parsed = webServerMessageSchema.safeParse(source)
      if (!parsed.success) return
      if (parsed.data.type === 'connection.ready') {
        this.reconnectDelay = 250
        this.setState('ready')
        this.startResolve?.()
        this.startResolve = null
        this.startReject = null
      } else if (parsed.data.type === 'connection.error' && parsed.data.code === 'lease-conflict') {
        this.stopped = true
        this.setState('lease-conflict')
        this.startReject?.(new Error(parsed.data.message))
        this.startResolve = null
        this.startReject = null
      }
      for (const listener of [...this.listeners]) {
        try {
          listener(parsed.data)
        } catch {
          // A GUI listener must not affect connection delivery.
        }
      }
    })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      if (!this.stopped) {
        this.setState('reconnecting')
        this.scheduleReconnect()
      }
    })
    socket.addEventListener('error', () => {
      socket.close()
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, this.reconnectDelay * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private setState(state: WebConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const listener of [...this.stateListeners]) {
      try {
        listener(state)
      } catch {
        // Connection diagnostics must not affect transport recovery.
      }
    }
  }
}

function loadClientId(): string {
  try {
    const existing = webClientIdSchema.safeParse(sessionStorage.getItem(CLIENT_ID_KEY))
    if (existing.success) return existing.data
    const created = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}
