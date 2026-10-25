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
 * The same handler is where a call can be *held* rather than blocked: the app may
 * answer "ask a person", and Pi's own dialog (`ctx.ui.confirm`) then suspends the
 * call until the window answers. That dialog is the reason this extension says it
 * can `hold` a call — a caller that cannot wait is never told to ask.
 *
 * A guard that cannot be consulted fails closed: the bridge exists precisely
 * because someone decided these calls need watching.
 */
export function guardExtensionSource(endpoint: GuardEndpoint | null): string {
  return `import net from 'node:net'

const endpoint = ${JSON.stringify(endpoint)}
/** Which Pictor conversation this child belongs to; read by the app, not here. */
const session = process.env.PICTOR_SESSION ?? null

/**
 * Whether a call can change something, from the tool's own annotations.
 *
 * Pi's annotations are MCP's hints, and a tool without hints is treated as able to
 * change something: asking once too often is recoverable, the other mistake is not.
 */
function mutating(pi, name) {
  const tool = pi.getAllTools().find((candidate) => candidate.name === name)
  const hints = tool?.annotations ?? {}
  if (hints.destructiveHint === true) return true
  if (hints.readOnlyHint === true) return false
  if (hints.openWorldHint === true) return true
  return true
}

/** One question per tool call, answered by the app over loopback. */
function ask(tool, args, changes) {
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
      // Saying it can hold a call is what makes an ask answer usable: the app does
      // not offer one to a caller that would ignore it.
      const question = { token: endpoint.token, tool, args, session: session, hold: true }
      question.mutating = changes
      socket.write(JSON.stringify(question) + String.fromCharCode(10))
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
  pi.on('tool_call', async (event, ctx) => {
    const tool = String(event.toolName || 'tool')
    // No endpoint means Pictor started this child before the bridge was listening.
    // Blocking is the safe reading: the guard exists to watch these calls.
    if (endpoint === null) {
      return { block: true, reason: 'Pictor 的工具守卫还没就绪，按默认拒绝处理' }
    }
    const verdict = await ask(tool, event.input ?? null, mutating(pi, tool))
    if (verdict === null) {
      return { block: true, reason: '工具守卫无法连接 Pictor，按默认拒绝处理' }
    }
    if (verdict.block === true) {
      return { block: true, reason: String(verdict.reason || '被工具守卫拦截') }
    }
    // Pictor answered "ask a person": Pi's own dialog holds the call until the
    // window sends a decision, and a cancelled dialog lands here as "not allowed".
    if (verdict.ask !== undefined && verdict.ask !== null) {
      const allowed = await ctx.ui.confirm(
        String(verdict.ask.tool || tool),
        String(verdict.ask.reason || '允许这次调用吗？'),
      )
      if (allowed !== true) return { block: true, reason: '你拒绝了这次调用' }
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
