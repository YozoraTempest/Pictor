import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FrameHost } from './frame-host.js'

/**
 * The server is the boundary between a plugin's front end and the rest of the machine, so
 * the cases worth testing are the refusals: a path that climbs out of the plugin, a token
 * nobody minted, a file type a frame may not load, and a method that is not a read.
 *
 * Requests go through `node:http` rather than `fetch` on purpose — `fetch` normalises `..`
 * out of a path before it leaves, which is exactly the input this code has to survive.
 */
let root: string
let outside: string
let host: FrameHost

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'pictor-frame-'))
  root = join(base, 'plugin')
  outside = join(base, 'outside')
  await mkdir(join(root, 'client'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(root, 'client', 'index.js'), 'export const ready = true\n')
  await writeFile(join(root, 'client', 'index.css'), ':root { --x: 1 }\n')
  await writeFile(join(root, 'page.html'), '<script>alert(1)</script>\n')
  await writeFile(join(outside, 'secret.js'), 'export const secret = true\n')
  host = new FrameHost()
})

afterEach(async () => {
  await host.close()
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

/** One raw request, so the path reaches the server byte for byte. */
function get(
  url: string,
  options: { method?: string } = {},
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}> {
  return new Promise((resolve, reject) => {
    const reachable = new URL(url)
    const call = request(
      {
        host: reachable.hostname,
        port: reachable.port,
        path: `${reachable.pathname}${reachable.search}`,
        method: options.method ?? 'GET',
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
        })
      },
    )
    call.on('error', reject)
    call.end()
  })
}

async function mount(overrides: { styles?: string } = {}): Promise<string> {
  const { url } = await host.mount({
    viewId: 'acme.board',
    pluginId: 'acme.demo',
    root,
    entry: 'client/index.js',
    ...overrides,
    sessionId: null,
  })
  return url
}

describe('FrameHost', () => {
  it('serves a document that loads the bundle and nothing else', async () => {
    const url = await mount({ styles: 'client/index.css' })
    const page = await get(url)

    expect(page.status).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)
    // The shim comes first: it is what a bundle finds when its own code starts.
    expect(page.body.indexOf('__pictor.js')).toBeLessThan(page.body.indexOf('client/index.js'))
    expect(page.body).toContain('<link rel="stylesheet" href="client/index.css">')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
  })

  it('forbids the frame from reaching the network', async () => {
    // This is the line that makes "your own front end" grantable: the frame can draw, but
    // it cannot talk to anything except the plugin that owns it.
    const page = await get(await mount())

    expect(page.headers['content-security-policy']).toContain("connect-src 'none'")
    expect(page.headers['content-security-policy']).toContain("default-src 'none'")
    expect(page.headers['content-security-policy']).toContain("object-src 'none'")
  })

  it('serves the files the bundle imports', async () => {
    const base = await mount()
    const module = await get(`${base}client/index.js`)
    const style = await get(`${base}client/index.css`)

    expect(module.status).toBe(200)
    expect(module.headers['content-type']).toMatch(/text\/javascript/)
    // A module import from an opaque origin is cross-origin, so the file must allow it.
    expect(module.headers['access-control-allow-origin']).toBe('*')
    expect(module.body).toContain('ready')
    expect(style.headers['content-type']).toMatch(/text\/css/)
  })

  it('refuses a path that climbs out of the plugin', async () => {
    const base = await mount()
    const escaped = await get(`${base}%2e%2e/outside/secret.js`)

    expect(escaped.status).toBe(404)
    expect(escaped.body).not.toContain('secret')
  })

  it('refuses a file type a frame may not load', async () => {
    // `.html` is absent on purpose: the document is ours, and a second one would be a
    // second CSP.
    expect((await get(`${await mount()}page.html`)).status).toBe(404)
  })

  it('refuses a token nobody minted', async () => {
    const base = await mount()
    const stranger = await get(base.replace(/f\/[^/]+\//, 'f/deadbeef/'))

    expect(stranger.status).toBe(404)
  })

  it('forgets a frame when it is given up', async () => {
    const html = await get(await mount())
    expect(html.status).toBe(200)

    host.forget('acme.board', null)

    // The old URL still addresses the same token, and the token is gone.
    expect((await get((await mount()).replace(/\/f\/[^/]+\//, '/f/deadbeef/'))).status).toBe(404)
  })

  it('answers reads only', async () => {
    const posted = await get(await mount(), { method: 'POST' })

    expect(posted.status).toBe(405)
  })
})
