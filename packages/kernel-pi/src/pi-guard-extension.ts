import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { GuardEndpoint } from '@vulonlok/kernel-sdk'

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
 * It also registers the one tool Pi does not ship: a way for the model to ask. dsh
 * has `ask_user_question`; without the same tool here, a Pi conversation could be
 * asked things by extensions but never by the model that is doing the work. The tool
 * asks through `ctx.ui.select` / `ctx.ui.input`, so the window sees the same card
 * either way.
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

/**
 * Asks the app for the services Pictor knows and registers each one with Pi.
 *
 * One shared configuration: the address, key and model list a person typed in Pictor
 * are the ones Pi uses, instead of a second copy in Pi's own config drifting away from
 * this one. Keys arrive over the socket for the same reason they are not written here:
 * this file lives on disk with the profile.
 */
async function loadProviders(pi) {
  if (endpoint === null) return
  const answer = await askRaw({ token: endpoint.token, kind: 'providers' })
  const providers = Array.isArray(answer && answer.providers) ? answer.providers : []
  for (const spec of providers) {
    if (!spec || typeof spec.name !== 'string' || !Array.isArray(spec.models)) continue
    try {
      pi.registerProvider(spec.name, { apiKey: spec.apiKey, baseUrl: spec.baseUrl, models: spec.models })
    } catch (error) {
      // One bad service must not take the others down with it; Pi reports nothing, so
      // the failure is left to the app's own diagnostics rather than swallowed silently
      // into a half-registered list.
      console.warn('pictor: 注册服务失败 ' + String(error))
    }
  }
}

/** A question on the same socket, in whatever shape the caller needs. */
function askRaw(payload) {
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
      socket.write(JSON.stringify(payload) + String.fromCharCode(10))
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

/** The tool the model asks through, named as dsh names it so one habit covers both. */
const ASK_TOOL = 'ask_user_question'

/**
 * The model-facing tool.
 *
 * Registered from inside the extension function, because that is where Pi hands over
 * its API — the file is a module, and the API arrives as the default export's argument.
 * the file is a module, and Pi hands the API to the default export.
 */
const askTool = {
  name: ASK_TOOL,
  label: 'Ask the person',
  description:
    'Ask the person a question and wait for the answer. Use it when a choice cannot be inferred from the code, the request or the conversation — an ambiguity that guessing would turn into wrong work. Pass options when the answer is one of a few choices, draft when they should edit text you wrote, and nothing for free text.',
  // Read-only on purpose: asking is not doing, and a session that asks before every
  // mutating call must not have to approve the question first.
  annotations: { readOnlyHint: true },
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'What you need to know.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Answer choices, if the answer is one of them. Omit for free text.',
      },
      detail: {
        type: 'string',
        description: 'Context shown with the question: paths, snippets, what you tried.',
      },
      draft: {
        type: 'string',
        description:
          'Text for the person to edit rather than write from scratch, such as a commit message or a config block. The answer is the edited text.',
      },
    },
    required: ['question'],
  },
  async execute(_id, params, _signal, _update, ctx) {
    const question = String(params && params.question ? params.question : '').trim()
    if (question.length === 0) throw new Error('question must not be empty')
    const detail = params && typeof params.detail === 'string' ? params.detail : ''
    const text = detail.length === 0 ? question : question + String.fromCharCode(10, 10) + detail
    const offered = Array.isArray(params && params.options)
      ? params.options.filter((option) => typeof option === 'string' && option.trim().length > 0)
      : []
    const draft = params && typeof params.draft === 'string' ? params.draft : null
    // A draft wins over options: it is the more specific request, and asking someone
    // to pick from a list while holding text they should change is incoherent.
    const answer =
      draft !== null
        ? await ctx.ui.editor(text, draft)
        : offered.length > 0
          ? await ctx.ui.select(text, offered)
          : await ctx.ui.input(text)
    // Trailing whitespace is noise in a one-line answer and part of the content in an
    // edited draft, so only the one-line case is trimmed.
    const declined = answer === undefined || answer === null
    const raw = declined ? '' : String(answer)
    const value = draft === null ? raw.trim() : raw
    // A declined question is an answer too: the model has to decide what to do next
    // instead of treating silence as permission. A draft edited down to nothing is
    // not a refusal — it is the person deleting what you wrote.
    const said = declined
      ? 'The person did not answer. Do not assume an answer; say what you need and stop.'
      : draft !== null
        ? 'The person edited the draft to: ' + String.fromCharCode(10) + value
        : value.length === 0
          ? 'The person did not answer. Do not assume an answer; say what you need and stop.'
          : 'The person answered: ' + value
    return {
      content: [{ type: 'text', text: said }],
      details: undefined,
    }
  },
}

export default async function pictorGuard(pi) {
  pi.registerTool(askTool)
  // Pi waits for asynchronous factories before startup continues, so the services are
  // in place before the first model selection.
  await loadProviders(pi)

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

  /**
   * The second half: Pictor's hooks, after the call settled.
   *
   * Pi composes tool_result handlers, so appending here is additive — but a failure has
   * to replace content, and Pi drops structuredContent when content is replaced without
   * it, so it is passed back through. A bridge that cannot be reached leaves the result
   * alone: a hook cannot grant or deny anything, so there is nothing to fail closed
   * about.
   */
  pi.on('tool_result', async (event) => {
    if (endpoint === null) return undefined
    const tool = String(event.toolName || 'tool')
    const content = Array.isArray(event.content) ? event.content : []
    const output = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\\n')
    const answer = await askRaw({
      token: endpoint.token,
      kind: 'after',
      tool: tool,
      args: event.input ?? null,
      ok: event.isError !== true,
      output: output,
    })
    if (answer === null) return undefined

    if (typeof answer.fail === 'string' && answer.fail.length > 0) {
      // The output follows the hook's words on purpose: the call happened, and a model
      // told only what not to do, without what it did, would have to ask again.
      const said =
        output.length === 0
          ? answer.fail
          : answer.fail + '\\n\\n---\\n\\nThe call already ran; its output was:\\n' + output
      return { content: [{ type: 'text', text: said }], isError: true }
    }

    if (typeof answer.note === 'string' && answer.note.length > 0) {
      return {
        content: [...content, { type: 'text', text: answer.note }],
        ...(event.structuredContent === undefined
          ? {}
          : { structuredContent: event.structuredContent }),
      }
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
