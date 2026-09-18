import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import type { ViteDevServer } from 'vite'

import {
  commandCallResultSchema,
  commandCancelRequestSchema,
  commandCancelResultSchema,
  commandDescriptorSchema,
  commandEventSchema,
  commandExecuteRequestSchema,
  commandListFilterSchema,
  toCommandError,
} from '../commands/contract.js'
import { moduleInvocationSchema, type ModuleEventEnvelope } from '../kernel/contract.js'
import type { ApplicationHostServices } from '../application/index.js'
import { ipcResult } from '../shared/ipc-result.js'
import {
  appInfoResultSchema,
  pluginBootstrapResultSchema,
  voidResultSchema,
} from '../shared/desktop-bridge.js'
import {
  WEB_API_PREFIX,
  WEB_EVENT_PATH,
  webClientIdSchema,
  webClientMessageSchema,
  webServerMessageSchema,
} from '../shared/web-protocol.js'
import {
  webDirectoryListingResultSchema,
  webDirectoryCreateRequestSchema,
  webExportTicketRequestSchema,
  webExportTicketResultSchema,
  webImportUploadResultSchema,
  webTransferReleaseRequestSchema,
  webTransferTicketSchema,
} from '../shared/web-files.js'
import type { EventHub } from './event-hub.js'
import { WebSessionAuth } from './auth.js'
import type { WebFileTransferStore } from './file-transfers.js'

const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024

export interface WebHostServerOptions {
  readonly services: ApplicationHostServices
  readonly moduleEvents: EventHub<ModuleEventEnvelope>
  readonly staticDirectory: string
  readonly host?: '127.0.0.1'
  readonly port?: number
  readonly auth?: WebSessionAuth
  readonly fileTransfers?: WebFileTransferStore
  readonly development?: {
    readonly rendererRoot: string
  }
}

export interface WebHostAddress {
  readonly origin: string
  readonly launchUrl: string
}

export class WebHostServer {
  private readonly auth: WebSessionAuth
  private readonly generation = randomUUID()
  private server: Server | null = null
  private webSockets: WebSocketServer | null = null
  private vite: ViteDevServer | null = null
  private address: WebHostAddress | null = null
  private activeClient: { id: string; socket: WebSocket } | null = null

  constructor(private readonly options: WebHostServerOptions) {
    this.auth = options.auth ?? new WebSessionAuth()
  }

  async start(): Promise<WebHostAddress> {
    if (this.server) throw new Error('Web Host Server has already started')
    const host = this.options.host ?? '127.0.0.1'
    const server = createServer((request, response) => void this.handleRequest(request, response))
    const webSockets = new WebSocketServer({ noServer: true })
    this.server = server
    this.webSockets = webSockets
    server.on('upgrade', (request, socket, head) => {
      if (
        !this.address ||
        new URL(request.url ?? '/', this.address.origin).pathname !== WEB_EVENT_PATH
      ) {
        if (!this.vite) socket.destroy()
        return
      }
      if (!this.isTrustedHost(request) || request.headers.origin !== this.address.origin) {
        socket.destroy()
        return
      }
      if (!this.auth.authenticate(request.headers.cookie)) {
        socket.destroy()
        return
      }
      const requestUrl = new URL(request.url ?? '/', this.address.origin)
      const clientId = webClientIdSchema.safeParse(requestUrl.searchParams.get('clientId'))
      if (!clientId.success) {
        socket.destroy()
        return
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleWebSocket(webSocket, clientId.data)
      })
    })

    if (this.options.development) {
      const [{ createServer: createViteServer }, { default: react }] = await Promise.all([
        import('vite'),
        import('@vitejs/plugin-react'),
      ])
      this.vite = await createViteServer({
        configFile: false,
        root: this.options.development.rendererRoot,
        appType: 'spa',
        plugins: [
          {
            name: 'pictor-web-development-csp',
            transformIndexHtml: {
              order: 'pre',
              handler: (html) =>
                html.replace(
                  /\s*<meta\s+http-equiv=["']Content-Security-Policy["'][\s\S]*?\/>/i,
                  '',
                ),
            },
          },
          react(),
        ],
        server: { middlewareMode: true, hmr: { server } },
      })
    }

    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(this.options.port ?? 0, host, () => {
        server.off('error', reject)
        resolvePromise()
      })
    })

    const serverAddress = server.address()
    if (!serverAddress || typeof serverAddress === 'string') {
      await this.stop()
      throw new Error('Web Host Server did not expose a TCP address')
    }
    const origin = `http://${host}:${serverAddress.port}`
    this.address = {
      origin,
      launchUrl: `${origin}/?token=${encodeURIComponent(this.auth.launchToken)}`,
    }
    return this.address
  }

  async stop(): Promise<void> {
    const server = this.server
    const webSockets = this.webSockets
    const vite = this.vite
    this.server = null
    this.webSockets = null
    this.vite = null
    this.address = null
    this.activeClient?.socket.close(1001, 'Web Host is stopping')
    this.activeClient = null
    for (const client of webSockets?.clients ?? []) client.terminate()
    webSockets?.close()
    await vite?.close()
    if (server) {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()))
      })
    }
    await this.options.fileTransfers?.dispose()
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applySecurityHeaders(response)
    try {
      if (!this.address || !this.isTrustedHost(request)) {
        this.sendText(response, 421, 'Misdirected request')
        return
      }
      const requestUrl = new URL(request.url ?? '/', this.address.origin)
      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/' &&
        requestUrl.searchParams.has('token')
      ) {
        if (
          !this.auth.authenticate(request.headers.cookie) &&
          !this.auth.consumeLaunchToken(requestUrl.searchParams.get('token'))
        ) {
          this.sendText(response, 403, 'Invalid or expired launch token')
          return
        }
        response.writeHead(303, {
          Location: '/',
          'Set-Cookie': this.auth.sessionCookie(),
        })
        response.end()
        return
      }
      if (!this.auth.authenticate(request.headers.cookie)) {
        this.sendText(response, 401, 'Authentication required')
        return
      }
      if (!this.isTrustedFetchSite(request)) {
        this.sendText(response, 403, 'Cross-site request rejected')
        return
      }
      if (requestUrl.pathname.startsWith(WEB_API_PREFIX)) {
        if (!this.isTrustedApiOrigin(request)) {
          this.sendText(response, 403, 'Untrusted request origin')
          return
        }
        await this.handleApiRequest(request, response, requestUrl)
        return
      }
      if (requestUrl.pathname.startsWith('/plugins/')) {
        await this.servePluginAsset(response, requestUrl.pathname)
        return
      }
      if (this.vite) {
        this.serveDevelopmentAsset(request, response)
        return
      }
      await this.serveStaticAsset(response, requestUrl.pathname)
    } catch (error) {
      console.error('Web Host request failed', error)
      if (!response.headersSent) this.sendText(response, 500, 'Internal server error')
      else response.destroy()
    }
  }

  private async handleApiRequest(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    const { services } = this.options
    if (request.method === 'GET' && requestUrl.pathname === `${WEB_API_PREFIX}/app-info`) {
      this.sendJson(response, 200, appInfoResultSchema.parse({ ok: true, value: services.appInfo }))
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === `${WEB_API_PREFIX}/plugin-bootstrap`) {
      const result = await ipcResult(() => services.getPluginBootstrap(this.guiPluginUrl))
      this.sendJson(response, 200, pluginBootstrapResultSchema.parse(result))
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/gui-ready`) {
      const result = await ipcResult(async () => {
        await services.restoreSelectedContext()
        return null
      })
      this.sendJson(response, 200, voidResultSchema.parse(result))
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/commands/list`) {
      const input = commandListFilterSchema.parse(await this.readJson(request))
      const result = await commandCallResult(
        () => services.commandClient.list(input),
        z.array(commandDescriptorSchema),
      )
      this.sendJson(response, 200, result)
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/commands/execute`) {
      const input = commandExecuteRequestSchema.parse(await this.readJson(request))
      const result = await commandCallResult(
        () => services.commandClient.execute(input.commandId, input.input, input.context),
        z.object({ executionId: z.uuid(), commandId: z.string().min(1) }),
      )
      this.sendJson(response, 200, result)
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/commands/cancel`) {
      const input = commandCancelRequestSchema.parse(await this.readJson(request))
      const result = await commandCallResult(
        () => services.commandClient.cancel(input.executionId),
        commandCancelResultSchema,
      )
      this.sendJson(response, 200, result)
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/modules/invoke`) {
      const invocation = moduleInvocationSchema.parse(await this.readJson(request))
      this.sendJson(
        response,
        200,
        await ipcResult(() =>
          services.moduleRouter.invoke(invocation.moduleId, invocation.method, invocation.input),
        ),
      )
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === `${WEB_API_PREFIX}/files/directories`) {
      const transfers = this.requireFileTransfers()
      const path = requestUrl.searchParams.get('path')
      const result = await ipcResult(() => transfers.listDirectory(path))
      this.sendJson(response, 200, webDirectoryListingResultSchema.parse(result))
      return
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === `${WEB_API_PREFIX}/files/directories`
    ) {
      const transfers = this.requireFileTransfers()
      const input = webDirectoryCreateRequestSchema.parse(await this.readJson(request))
      const result = await ipcResult(() => transfers.createDirectory(input.parentPath, input.name))
      this.sendJson(response, 200, webDirectoryListingResultSchema.parse(result))
      return
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === `${WEB_API_PREFIX}/files/import-session`
    ) {
      const transfers = this.requireFileTransfers()
      const name = z.string().trim().min(1).max(200).parse(requestUrl.searchParams.get('name'))
      const result = await ipcResult(() => transfers.createImport(name, request))
      this.sendJson(response, 200, webImportUploadResultSchema.parse(result))
      return
    }
    if (
      request.method === 'POST' &&
      requestUrl.pathname === `${WEB_API_PREFIX}/files/export-ticket`
    ) {
      const transfers = this.requireFileTransfers()
      const input = webExportTicketRequestSchema.parse(await this.readJson(request))
      const result = await ipcResult(() =>
        transfers.reserveExport(input.format, input.defaultFileName),
      )
      this.sendJson(response, 200, webExportTicketResultSchema.parse(result))
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === `${WEB_API_PREFIX}/files/release`) {
      const transfers = this.requireFileTransfers()
      const input = webTransferReleaseRequestSchema.parse(await this.readJson(request))
      await transfers.release(input.ticket)
      this.sendJson(response, 200, { ok: true, value: null })
      return
    }
    if (
      request.method === 'GET' &&
      requestUrl.pathname.startsWith(`${WEB_API_PREFIX}/files/download/`)
    ) {
      const ticket = webTransferTicketSchema.parse(
        requestUrl.pathname.slice(`${WEB_API_PREFIX}/files/download/`.length),
      )
      await this.sendDownload(response, ticket)
      return
    }
    this.sendText(response, 404, 'Not found')
  }

  private handleWebSocket(socket: WebSocket, clientId: string): void {
    const active = this.activeClient
    if (active && active.id !== clientId && active.socket.readyState === WebSocket.OPEN) {
      this.sendWebSocket(socket, {
        type: 'connection.error',
        code: 'lease-conflict',
        message: '另一个 Web GUI 已经连接到当前 Profile',
      })
      socket.close(4009, 'Active GUI lease conflict')
      return
    }
    if (active && active.socket !== socket) active.socket.close(1012, 'Client reconnected')
    this.activeClient = { id: clientId, socket }

    const releaseCommands = this.options.services.commandClient.subscribe(undefined, (event) => {
      this.sendWebSocket(socket, { type: 'command.event', event: commandEventSchema.parse(event) })
    })
    const releaseModules = this.options.moduleEvents.subscribe((event) => {
      this.sendWebSocket(socket, { type: 'module.event', event })
    })
    this.sendWebSocket(socket, { type: 'connection.ready', generation: this.generation })

    socket.on('message', (data) => {
      const parsedJson = parseJson(data.toString())
      const message = webClientMessageSchema.safeParse(parsedJson)
      if (!message.success) {
        this.sendWebSocket(socket, {
          type: 'connection.error',
          code: 'invalid-message',
          message: 'WebSocket message validation failed',
        })
        return
      }
      const releaseReplay = this.options.services.commandClient.subscribe(
        message.data.executionId,
        (event) => this.sendWebSocket(socket, { type: 'command.event', event }),
      )
      releaseReplay()
    })
    socket.once('close', () => {
      releaseCommands()
      releaseModules()
      if (this.activeClient?.socket === socket) this.activeClient = null
    })
  }

  private readonly guiPluginUrl = (
    _rootPath: string,
    id: string,
    version: string,
    entry: string,
  ): string => {
    const path = entry
      .replace(/^\.\//, '')
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `/plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}/${path}`
  }

  private async servePluginAsset(response: ServerResponse, pathname: string): Promise<void> {
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (segments.length < 4 || segments[0] !== 'plugins') {
      this.sendText(response, 404, 'Not found')
      return
    }
    const [, pluginId, version, ...assetSegments] = segments
    const plugin = (await this.options.services.pluginStore.getSnapshot()).plugins.find(
      ({ manifest }) => manifest.id === pluginId && manifest.version === version,
    )
    if (!plugin) {
      this.sendText(response, 404, 'Not found')
      return
    }
    const assetPath = resolve(plugin.rootPath, assetSegments.join('/'))
    if (!isPathWithin(plugin.rootPath, assetPath)) {
      this.sendText(response, 404, 'Not found')
      return
    }
    await this.sendFile(response, assetPath)
  }

  private async serveStaticAsset(response: ServerResponse, pathname: string): Promise<void> {
    const requestedPath =
      pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    let assetPath = resolve(this.options.staticDirectory, requestedPath)
    if (!isPathWithin(this.options.staticDirectory, assetPath)) {
      this.sendText(response, 404, 'Not found')
      return
    }
    const assetStat = await stat(assetPath).catch(() => null)
    if (!assetStat?.isFile() && extname(requestedPath) === '') {
      assetPath = resolve(this.options.staticDirectory, 'index.html')
    }
    await this.sendFile(response, assetPath)
  }

  private serveDevelopmentAsset(request: IncomingMessage, response: ServerResponse): void {
    this.vite!.middlewares(request, response, (error?: unknown) => {
      if (error) {
        console.error('Vite middleware failed', error)
        if (!response.headersSent) this.sendText(response, 500, 'Development server failed')
        else response.destroy()
        return
      }
      if (!response.writableEnded) this.sendText(response, 404, 'Not found')
    })
  }

  private async sendFile(response: ServerResponse, path: string): Promise<void> {
    const fileStat = await stat(path).catch(() => null)
    if (!fileStat?.isFile()) {
      this.sendText(response, 404, 'Not found')
      return
    }
    response.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': contentType(path),
    })
    createReadStream(path).pipe(response)
  }

  private async sendDownload(response: ServerResponse, ticket: string): Promise<void> {
    const transfers = this.requireFileTransfers()
    const download = await transfers.claimDownload(ticket)
    if (!download) {
      this.sendText(response, 404, 'Download not found')
      return
    }
    const fileStat = await stat(download.path).catch(() => null)
    if (!fileStat?.isFile()) {
      await transfers.completeDownload(download)
      this.sendText(response, 404, 'Download not found')
      return
    }
    response.writeHead(200, {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.name)}`,
      'Content-Length': fileStat.size,
      'Content-Type': contentType(download.path),
    })
    const stream = createReadStream(download.path)
    stream.once('close', () => void transfers.completeDownload(download))
    stream.once('error', () => response.destroy())
    stream.pipe(response)
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += buffer.length
      if (length > MAX_JSON_BODY_BYTES) throw new Error('Request body is too large')
      chunks.push(buffer)
    }
    const source = Buffer.concat(chunks).toString('utf8')
    return source ? JSON.parse(source) : null
  }

  private isTrustedHost(request: IncomingMessage): boolean {
    return request.headers.host === this.address?.origin.replace(/^https?:\/\//, '')
  }

  private requireFileTransfers(): WebFileTransferStore {
    if (!this.options.fileTransfers) throw new Error('Web file transfers are unavailable')
    return this.options.fileTransfers
  }

  private isTrustedApiOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin
    return request.method === 'GET'
      ? origin === undefined || origin === this.address?.origin
      : origin === this.address?.origin
  }

  private isTrustedFetchSite(request: IncomingMessage): boolean {
    const site = request.headers['sec-fetch-site']
    return site === undefined || site === 'same-origin' || site === 'none'
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store')
    const scripts = this.options.development
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'"
    const webSocketOrigin = this.address?.origin.replace(/^http/, 'ws')
    const connectSources = webSocketOrigin ? `'self' ${webSocketOrigin}` : "'self'"
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connectSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    )
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
  }

  private sendWebSocket(socket: WebSocket, message: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(webServerMessageSchema.parse(message)))
  }

  private sendJson(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(value))
  }

  private sendText(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(message)
  }
}

async function commandCallResult<TSchema extends z.ZodType>(
  operation: () => Promise<unknown>,
  valueSchema: TSchema,
): Promise<unknown> {
  try {
    const value = valueSchema.parse(await operation())
    return commandCallResultSchema(valueSchema).parse({ ok: true, value })
  } catch (error) {
    return commandCallResultSchema(valueSchema).parse({
      ok: false,
      error: toCommandError(error, {
        code: 'handler-failed',
        message: '命令请求失败',
      }),
    })
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}
