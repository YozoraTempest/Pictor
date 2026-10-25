import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { GuardEndpoint } from './tool-guard-server.js'

/**
 * The kernel-side half of Pictor's tool guards, for Pi.
 *
 * Pictor's guards are JavaScript closures in the app process, so they cannot be
 * handed to Pi as configuration. Pi does have the seam this needs: an extension's
 * `tool_call` handler can block a call before it runs. So Pictor writes this
 * extension, launches Pi with it, and answers one question per call over the same
 * loopback socket dsh uses — which is what makes a user's tool rules mean the same
 * thing on both kernels.
 *
 * A guard that cannot be consulted fails closed: the bridge exists precisely
 * because someone decided these calls need watching.
 */
export function guardExtensionSource(endpoint: GuardEndpoint | null): string {
  return `import net from 'node:net'

const endpoint = ${JSON.stringify(endpoint)}

/** One question per tool call, answered by the app over loopback. */
function ask(tool, args) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: endpoint.port })
    let buffer = ''
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(5000, () => done(null))
    socket.on('error', () => done(null))
    socket.on('connect', () => {
      socket.write(JSON.stringify({ token: endpoint.token, tool, args }) + String.fromCharCode(10))
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf(String.fromCharCode(10))
      if (end === -1) return
      try {
        done(JSON.parse(buffer.slice(0, end)))
      } catch {
        done(null)
      }
    })
  })
}

export default function pictorGuard(pi) {
  pi.on('tool_call', async (event) => {
    // No endpoint means Pictor started this child before the bridge was listening.
    // Blocking is the safe reading: the guard exists to watch these calls.
    if (endpoint === null) {
      return { block: true, reason: 'Pictor 的工具守卫还没就绪，按默认拒绝处理' }
    }
    const verdict = await ask(String(event.toolName || 'tool'), event.input ?? null)
    if (verdict === null) {
      return { block: true, reason: '工具守卫无法连接 Pictor，按默认拒绝处理' }
    }
    if (verdict.block === true) {
      return { block: true, reason: String(verdict.reason || '被工具守卫拦截') }
    }
    return undefined
  })
}
`
}

/**
 * Writes the guard extension into the profile and returns its path.
 *
 * The file is rewritten on every boot because it carries the bridge's port and
 * token, and a stale token would make every call fail closed.
 */
export function writeGuardExtension(userData: string, endpoint: GuardEndpoint | null): string {
  const directory = join(userData, 'pi-ext')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'pictor-guard.mjs')
  writeFileSync(file, guardExtensionSource(endpoint), 'utf8')
  return file
}
