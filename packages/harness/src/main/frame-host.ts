import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

/**
 * Where a frame view's files come from.
 *
 * A frame is the second payload a `views` contribution can have: instead of a description
 * the window draws, the plugin ships a bundle and the window runs it — inside an iframe
 * with no same-origin, no Node, and no network. This class is the smallest thing that makes
 * that possible: an HTTP server on the loopback interface that serves files out of one
 * plugin's directory, behind a token that names one view of one conversation.
 *
 * Why a server rather than `srcdoc`: a bundle is more than one file. An entry module may
 * import siblings, a stylesheet, an image — all of which need addressing, and inlining them
 * into one string would turn "ship a front end" into "ship one file, concat everything".
 *
 * What the boundary is made of:
 *
 * - **The token is the directory.** A frame can read its own plugin's files and nothing
 *   else: the path is resolved and then checked against the root it was mounted with, so
 *   `..` cannot climb out, and a token cannot name another plugin.
 * - **The document gets a CSP with `connect-src 'none'`.** Module imports are `script-src`,
 *   not `connect-src`, so a bundle still loads its own files while `fetch`, `XHR` and
 *   `sendBeacon` are refused by the browser. A plugin that wants the network asks its main
 *   process through `respond`.
 * - **The answer is a document we wrote.** The HTML is generated here — charset, theme,
 *   shim, one module tag — so a plugin cannot relax its own CSP by shipping one.
 */
export interface FrameMountRequest {
  /** The `views` id this frame belongs to; part of the token's identity. */
  viewId: string
  /** Who contributed it, for messages a reader has to act on. */
  pluginId: string
  /** The plugin's own directory. Everything served comes from here. */
  root: string
  /** Entry module, relative to `root`, already validated by the SDK. */
  entry: string
  /** Optional stylesheet, relative to `root`. */
  styles?: string
  sessionId: string | null
}

/** What the renderer needs to draw one frame. */
export interface FrameMount {
  url: string
}

/** One mounted frame: the token, the URL it answers on, and the directory behind it. */
interface Mounted extends FrameMountRequest, FrameMount {
  token: string
  mountedAt: number
}

/**
 * Files a frame may load.
 *
 * An allowlist rather than "everything except", because the interesting mistake here is a
 * plugin shipping something the browser will execute in a way this code never considered.
 * `.html` is absent on purpose: the frame's document is ours, and a second one would be a
 * second CSP.
 */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/** One file may not be larger than this; a frame is a panel, not a download. */
const MAX_FILE = 8 * 1024 * 1024

/**
 * The frame's palette before `init` arrives.
 *
 * Mirrors `styles/tokens.css`, so a frame does not flash white before it is told the real
 * colours. The renderer sends the live values with `init`; this is only the first paint.
 */
const BASELINE = {
  bg: '#0a0c11',
  surface: '#101319',
  border: '#232a38',
  text: '#e9ecf3',
  muted: '#9aa3b8',
  accent: '#6ea8fe',
}

/**
 * The frame-side half of the channel.
 *
 * Served as a file rather than inlined so the document needs no `'unsafe-inline'` script.
 * It is the whole API a bundle gets: ask the plugin something, hear what the host says
 * about the conversation. Everything else — DOM, canvas, event handlers — is the bundle's
 * own business, which is the point of shipping one.
 */
const SHIM = `// Pictor frame shim: the only way out of a sandboxed frame.
const waiting = new Map()
let nextId = 1
const listeners = []
let context = null
let announced = null

const say = (message) => window.parent.postMessage({ __pictor: true, ...message }, '*')

window.pictorFrame = {
  /** Ask the plugin a question; resolves its answer, rejects with its own words. */
  request(action, value) {
    const id = nextId++
    const answer = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
    say({ type: 'request', id, action: String(action), ...(value === undefined ? {} : { value: String(value) }) })
    return answer
  },
  /**
   * Called with { sessionId, theme } once the host has connected.
   *
   * A handler registered after the context already arrived is called straight away: the two
   * halves are loaded in order but not in lockstep, and the bundle is the slower one.
   */
  onInit(handler) {
    listeners.push(handler)
    if (context !== null) handler(context)
    return () => listeners.splice(listeners.indexOf(handler), 1)
  },
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const message = event.data
  if (!message || message.__pictor !== true) return
  if (message.type === 'init') {
    context = message.context
    if (announced !== null) clearInterval(announced)
    announced = null
    for (const handler of listeners) handler(context)
    return
  }
  if (message.type !== 'answer') return
  const pending = waiting.get(message.id)
  if (!pending) return
  waiting.delete(message.id)
  if (message.ok) pending.resolve(message.data)
  else pending.reject(new Error(message.error))
})

// Announce until the host answers. The host may not be listening yet when this module runs,
// and a message nobody heard is not a handshake.
let tries = 0
announced = setInterval(() => {
  if (context !== null || tries >= 20) {
    clearInterval(announced)
    return
  }
  tries += 1
  say({ type: 'ready' })
}, 250)
say({ type: 'ready' })
`

export class FrameHost {
  readonly #warn: (message: string) => void
  /** Mounted frames, by `viewId` and conversation: a refresh reuses its own token. */
  readonly #mounted = new Map<string, Mounted>()
  #server: Server | null = null
  #starting: Promise<number> | null = null
  #port = 0
  /** How many frames may be mounted at once before the oldest is dropped. */
  readonly #limit: number

  constructor(options: { warn?: (message: string) => void; limit?: number } = {}) {
    this.#warn = options.warn ?? ((): void => undefined)
    this.#limit = options.limit ?? 24
  }

  /**
   * The URL one frame loads.
   *
   * Reused per view and conversation, so reopening a panel or refreshing it does not mint
   * a second token — and a stale token from a closed panel cannot be used to read files
   * after the fact.
   */
  async mount(request: FrameMountRequest): Promise<FrameMount> {
    const key = `${request.viewId}\u0000${request.sessionId ?? ''}`
    const known = this.#mounted.get(key)
    if (known !== undefined) return { url: known.url }

    const port = await this.#ensureServer()
    const token = randomBytes(16).toString('hex')
    const mounted: Mounted = {
      ...request,
      token,
      mountedAt: Date.now(),
      url: `http://127.0.0.1:${String(port)}/f/${token}/`,
    }
    this.#mounted.set(key, mounted)
    this.#prune()
    return { url: mounted.url }
  }

  /** Gives up a frame's token. Called when the panel or the conversation goes away. */
  forget(viewId: string, sessionId: string | null): void {
    this.#mounted.delete(`${viewId}\u0000${sessionId ?? ''}`)
  }

  /** The port the server is on, for messages about where a frame loaded from. */
  get port(): number {
    return this.#port
  }

  async close(): Promise<void> {
    const server = this.#server
    this.#server = null
    this.#starting = null
    this.#mounted.clear()
    if (server === null) return
    await new Promise<void>((done) => server.close(() => done()))
  }

  /** Drops the oldest mounts; a window with a hundred frames open is a bug, not a use. */
  #prune(): void {
    while (this.#mounted.size > this.#limit) {
      const oldest = [...this.#mounted.entries()].sort(
        ([, left], [, right]) => left.mountedAt - right.mountedAt,
      )[0]
      if (oldest === undefined) return
      this.#mounted.delete(oldest[0])
    }
  }

  #ensureServer(): Promise<number> {
    if (this.#server !== null) return Promise.resolve(this.#port)
    this.#starting ??= new Promise<number>((ready, fail) => {
      const server = createServer((request, response) => {
        void this.#handle(request, response)
      })
      server.once('error', (error) => {
        this.#starting = null
        fail(error instanceof Error ? error : new Error(String(error)))
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          fail(new Error('帧服务器没有拿到端口'))
          return
        }
        this.#server = server
        this.#port = address.port
        ready(address.port)
      })
    })
    return this.#starting
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Local-only is the assumption, and it is also checked: a proxy in front of the app
    // would be the one way a remote page could name these URLs.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.#plain(response, 405)
      return
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter((part) => part.length > 0)
    // `/f/<token>/…`; anything else is not this server's business.
    if (parts[0] !== 'f' || parts[1] === undefined) {
      this.#plain(response, 404)
      return
    }
    const token = parts[1]
    const mounted = [...this.#mounted.values()].find((entry) => entry.token === token)
    if (mounted === undefined) {
      this.#plain(response, 404)
      return
    }

    const rest = parts.slice(2)
    if (rest.length === 0) {
      this.#document(response, mounted)
      return
    }
    if (rest.length === 1 && rest[0] === '__pictor.js') {
      this.#send(response, 200, 'text/javascript; charset=utf-8', SHIM)
      return
    }

    let path: string
    try {
      path = rest.map((part) => decodeURIComponent(part)).join('/')
    } catch {
      this.#plain(response, 400)
      return
    }
    await this.#file(response, mounted, path)
  }

  /** One file, if it is inside the plugin and of a type a frame may load. */
  async #file(response: ServerResponse, mounted: Mounted, path: string): Promise<void> {
    const root = resolve(mounted.root)
    const target = resolve(root, path)
    // The containment check, in the one place a path becomes a file read. `sep` keeps a
    // sibling directory whose name starts with the root's from passing.
    if (target !== root && !target.startsWith(root + sep)) {
      this.#plain(response, 404)
      return
    }

    const type = TYPES[extname(target).toLowerCase()]
    if (type === undefined) {
      this.#plain(response, 404)
      return
    }

    let size: number
    try {
      const info = await stat(target)
      if (!info.isFile()) {
        this.#plain(response, 404)
        return
      }
      size = info.size
    } catch {
      this.#plain(response, 404)
      return
    }
    if (size > MAX_FILE) {
      this.#plain(response, 413)
      return
    }

    response.writeHead(200, {
      ...BASE_HEADERS,
      'content-type': type,
      'content-length': String(size),
    })
    // A file that vanishes between the stat and the read is not the reader's fault; it is
    // worth one line in the log, and the frame sees a truncated load either way.
    createReadStream(target)
      .on('error', (error: unknown) => {
        this.#warn(
          `帧文件读取失败：${target}（${error instanceof Error ? error.message : String(error)}）`,
        )
        response.destroy()
      })
      .pipe(response)
  }

  /** The frame's document: ours, not the plugin's, so the CSP is ours too. */
  #document(response: ServerResponse, mounted: Mounted): void {
    const origin = `http://127.0.0.1:${String(this.#port)}`
    const html = [
      '<!doctype html>',
      '<html lang="zh">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="color-scheme" content="dark">',
      '<title>Pictor</title>',
      `<style>${baselineStyle()}</style>`,
      ...(mounted.styles === undefined
        ? []
        : [`<link rel="stylesheet" href="${escapeAttribute(mounted.styles)}">`]),
      // The shim first: both are modules, so they run in this order and the bundle can use
      // `window.pictorFrame` the moment its own code starts.
      '<script type="module" src="__pictor.js"></script>',
      `<script type="module" src="${escapeAttribute(mounted.entry)}"></script>`,
      '</head>',
      '<body>',
      '<div id="root"></div>',
      '</body>',
      '</html>',
    ].join('\n')

    response.writeHead(200, {
      ...BASE_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html)),
      'content-security-policy': [
        "default-src 'none'",
        `script-src ${origin}`,
        `style-src ${origin} 'unsafe-inline'`,
        `img-src ${origin} data: blob:`,
        `font-src ${origin}`,
        `media-src ${origin}`,
        // No network. A frame that needs data asks the plugin, which is the process that
        // may have it. This is the line that makes "your own front end" safe to grant.
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
        "object-src 'none'",
      ].join('; '),
    })
    response.end(html)
  }

  #send(response: ServerResponse, status: number, type: string, body: string): void {
    response.writeHead(status, {
      ...BASE_HEADERS,
      'content-type': type,
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  }

  #plain(response: ServerResponse, status: number): void {
    const body = `${String(status)}\n`
    response.writeHead(status, {
      ...BASE_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  }
}

/**
 * Headers every frame response carries.
 *
 * `access-control-allow-origin` is here rather than on files alone because the frame is a
 * sandboxed document: its origin is opaque, so *every* subresource it loads — the shim, the
 * bundle, its stylesheet — is a cross-origin request, and a module script without this
 * header is refused before it runs.
 */
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
} as const

function baselineStyle(): string {
  return [
    `:root{--pictor-bg:${BASELINE.bg};--pictor-surface:${BASELINE.surface};--pictor-border:${BASELINE.border};--pictor-text:${BASELINE.text};--pictor-muted:${BASELINE.muted};--pictor-accent:${BASELINE.accent}}`,
    'html,body{margin:0;padding:0;background:var(--pictor-bg);color:var(--pictor-text)}',
    'body{font:12px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#root{min-height:100%}',
  ].join('')
}

/** One attribute value from data that came out of a plugin's package.json. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
