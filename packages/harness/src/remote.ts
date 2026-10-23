/**
 * Unary Typert Remote calls against a running web runtime.
 *
 * The runtime authenticates one origin with a token: `GET /?token=…` answers a
 * redirect and sets a session cookie, and every later call carries that cookie.
 * A unary call is a single JSON request/response on `POST /api/<endpoint>`, so
 * this class owns the cookie, the envelope shape, and nothing else.
 */

export interface HarnessRemoteOptions {
  /** Origin of the running runtime, e.g. `http://127.0.0.1:42317`. */
  baseUrl: string
  /** Token the runtime printed when it booted. */
  token: string
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch
  /** Fails a call instead of waiting forever; a stuck runtime must surface. */
  timeoutMs?: number
}

interface RpcEnvelope {
  type?: unknown
  rpcId?: unknown
  result?: {
    ok?: unknown
    value?: unknown
    error?: { code?: unknown; message?: unknown; details?: unknown }
  }
}

/** One unary Remote call, already authenticated. */
export class HarnessRemote {
  readonly #options: HarnessRemoteOptions
  readonly #fetch: typeof globalThis.fetch
  #cookie: string | null = null
  #sequence = 0

  constructor(options: HarnessRemoteOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  get baseUrl(): string {
    return this.#options.baseUrl
  }

  /** Cookie value every later call and stream must carry. */
  get cookie(): string | null {
    return this.#cookie
  }

  get connected(): boolean {
    return this.#cookie !== null
  }

  /**
   * Exchange the boot token for a session cookie.
   *
   * The runtime answers the token exchange with a redirect; the cookie rides on
   * that response, so the redirect itself is never followed.
   */
  async connect(): Promise<void> {
    if (this.#cookie !== null) return
    const url = `${this.#options.baseUrl}/?token=${encodeURIComponent(this.#options.token)}`
    const response = await this.#call(() => this.#fetch(url, { redirect: 'manual' }))
    const cookie = (response.headers.getSetCookie?.() ?? [])
      .map((entry) => entry.split(';')[0]?.trim() ?? '')
      .filter((entry) => entry.length > 0)
      .join('; ')
    if (cookie.length === 0) {
      throw new Error(
        `harness: 运行时没有接受启动令牌（HTTP ${String(response.status)}）；请重启运行时`,
      )
    }
    this.#cookie = cookie
  }

  /** One unary call; `args` is the descriptor's named-argument object. */
  async call<T>(endpoint: string, args: unknown): Promise<T> {
    const cookie = this.#cookie
    if (cookie === null) throw new Error('harness: 尚未完成认证')

    const rpcId = `pictor-${String(++this.#sequence)}`
    const response = await this.#call(() =>
      this.#fetch(`${this.#options.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload: { args },
        }),
      }),
    )

    const text = await response.text()
    let body: RpcEnvelope
    try {
      body = JSON.parse(text) as RpcEnvelope
    } catch {
      throw new Error(
        `harness: ${endpoint} 返回了非 JSON 响应（HTTP ${String(response.status)}）：${text.slice(0, 200)}`,
      )
    }

    const result = body.result
    if (result === undefined) {
      throw new Error(`harness: ${endpoint} 的响应缺少 result 信封`)
    }
    if (result.ok !== true) {
      const message = typeof result.error?.message === 'string' ? result.error.message : '未知错误'
      const code = typeof result.error?.code === 'string' ? `${result.error.code}: ` : ''
      throw new Error(`harness: ${endpoint} 失败：${code}${message}`)
    }
    return result.value as T
  }

  async #call(run: () => Promise<Response>): Promise<Response> {
    const limit = this.#options.timeoutMs ?? 30_000
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, limit)
    try {
      return await run()
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`harness: 请求在 ${String(limit)}ms 后超时`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
