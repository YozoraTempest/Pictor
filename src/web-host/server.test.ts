// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationHostServices } from '../application/index.js'
import type { CommandClient } from '../commands/contract.js'
import type { ModuleEventEnvelope } from '../kernel/contract.js'
import { EventHub } from './event-hub.js'
import { WebSessionAuth } from './auth.js'
import { WebFileTransferStore } from './file-transfers.js'
import { WebHostServer, type WebHostAddress } from './server.js'

const firstClientId = '11111111-1111-4111-8111-111111111111'
const secondClientId = '22222222-2222-4222-8222-222222222222'

describe('WebHostServer', () => {
  let directory: string
  let server: WebHostServer
  let address: WebHostAddress
  let cookie: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pictor-web-host-'))
    await writeFile(join(directory, 'index.html'), '<main>Pictor Web</main>')
    const tokens = ['launch-token', 'session-token']
    server = new WebHostServer({
      services: createServices(),
      moduleEvents: new EventHub<ModuleEventEnvelope>(),
      staticDirectory: directory,
      fileTransfers: new WebFileTransferStore(join(directory, 'transfers')),
      auth: new WebSessionAuth({ createToken: () => tokens.shift()! }),
    })
    address = await server.start()
    const exchange = await fetch(address.launchUrl, { redirect: 'manual' })
    cookie = exchange.headers.get('set-cookie')!.split(';', 1)[0]!
  })

  afterEach(async () => {
    await server.stop()
    await rm(directory, { recursive: true, force: true })
  })

  it('exchanges a launch token and protects static and API routes', async () => {
    const unauthorized = await fetch(address.origin)
    expect(unauthorized.status).toBe(401)

    const index = await fetch(address.origin, { headers: { Cookie: cookie } })
    expect(index.status).toBe(200)
    await expect(index.text()).resolves.toContain('Pictor Web')

    const appInfo = await fetch(`${address.origin}/api/v1/app-info`, {
      headers: { Cookie: cookie },
    })
    expect(appInfo.status).toBe(200)
    await expect(appInfo.json()).resolves.toMatchObject({
      ok: true,
      value: { name: 'Pictor', version: '0.4.0' },
    })
  })

  it('rejects cross-origin API mutations', async () => {
    const response = await fetch(`${address.origin}/api/v1/commands/list`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://attacker.invalid',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('allows one active GUI client lease', async () => {
    const first = await connectWebSocket(address, cookie, firstClientId)
    const ready = await first.firstMessage
    expect(ready).toMatchObject({ type: 'connection.ready' })

    const second = await connectWebSocket(address, cookie, secondClientId)
    const closed = nextClose(second.socket)
    await expect(second.firstMessage).resolves.toMatchObject({
      type: 'connection.error',
      code: 'lease-conflict',
    })
    await expect(closed).resolves.toBe(4009)
    first.socket.close()
  })

  it('uploads imports and serves one-time export downloads', async () => {
    const upload = await fetch(`${address.origin}/api/v1/files/import-session?name=history.jsonl`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: address.origin },
      body: '{"type":"session"}\n',
    })
    expect(upload.status).toBe(200)
    const uploaded = (await upload.json()) as {
      ok: true
      value: { ticket: string; path: string }
    }
    await expect(readFile(uploaded.value.path, 'utf8')).resolves.toBe('{"type":"session"}\n')

    const reservation = await fetch(`${address.origin}/api/v1/files/export-ticket`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: address.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ format: 'html', defaultFileName: 'Session' }),
    })
    const reserved = (await reservation.json()) as {
      ok: true
      value: { ticket: string; path: string; name: string }
    }
    expect(reserved.value.name).toBe('Session.html')
    await writeFile(reserved.value.path, '<main>exported</main>')

    const download = await fetch(
      `${address.origin}/api/v1/files/download/${reserved.value.ticket}`,
      { headers: { Cookie: cookie } },
    )
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain("filename*=UTF-8''Session.html")
    await expect(download.text()).resolves.toBe('<main>exported</main>')
    const repeatedDownload = await fetch(
      `${address.origin}/api/v1/files/download/${reserved.value.ticket}`,
      { headers: { Cookie: cookie } },
    )
    expect(repeatedDownload.status).toBe(404)

    const release = await fetch(`${address.origin}/api/v1/files/release`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: address.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ticket: uploaded.value.ticket }),
    })
    expect(release.status).toBe(200)
  })
})

function createServices(): ApplicationHostServices {
  const commandClient: CommandClient = {
    list: async () => [],
    execute: vi.fn(),
    cancel: vi.fn(),
    subscribe: () => () => undefined,
  }
  return {
    appInfo: {
      name: 'Pictor',
      version: '0.4.0',
      buildChannel: 'development',
      sourceCommit: null,
      platform: 'linux',
      arch: 'x64',
      distribution: 'unsupported-linux',
    },
    commandClient,
    moduleRouter: { invoke: vi.fn() },
    pluginStore: { getSnapshot: async () => ({ plugins: [] }) },
    restoreSelectedContext: vi.fn(),
    getPluginBootstrap: async () => ({ safeMode: false, plugins: [] }),
  } as unknown as ApplicationHostServices
}

async function connectWebSocket(
  address: WebHostAddress,
  cookie: string,
  clientId: string,
): Promise<{ socket: WebSocket; firstMessage: Promise<unknown> }> {
  const socket = new WebSocket(
    `${address.origin.replace('http:', 'ws:')}/api/v1/events?clientId=${clientId}`,
    { headers: { Cookie: cookie }, origin: address.origin },
  )
  const firstMessage = nextMessage(socket)
  await new Promise<void>((resolvePromise, reject) => {
    socket.once('open', resolvePromise)
    socket.once('error', reject)
  })
  return { socket, firstMessage }
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    socket.once('message', (data) => resolvePromise(JSON.parse(data.toString())))
    socket.once('error', reject)
  })
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolvePromise) => {
    socket.once('close', (code) => resolvePromise(code))
  })
}
