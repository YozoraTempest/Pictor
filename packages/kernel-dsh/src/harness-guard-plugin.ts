/**
 * The kernel-side half of Pictor's tool bridge.
 *
 * Pictor's guards and hooks are JavaScript closures living in the app process, so they
 * cannot be serialised into this profile. This package is written into the profile's
 * `node_modules` at boot, mounted with an `insert` patch, and asks the app over a
 * loopback socket: once before a call (may it run?) and once after it (what should the
 * model read next?).
 */
export const GUARD_PLUGIN_NAME = 'pictor-guard'

/** Minimal package manifest: enough for Node to load `index.js` as ESM. */
export const GUARD_PLUGIN_PACKAGE = `${JSON.stringify(
  {
    name: GUARD_PLUGIN_NAME,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: 'index.js',
  },
  null,
  2,
)}\n`

export const GUARD_PLUGIN_SOURCE = `import net from 'node:net'

export const name = 'pictor-guard'

/**
 * One question on the bridge, answered by the app over loopback.
 *
 * Returns null when the app cannot be reached: each caller decides what that means,
 * and they decide differently on purpose — a guard fails closed, a hook fails open.
 */
function askQuestion(endpoint, question) {
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
      socket.write(JSON.stringify({ token: endpoint.token, ...question }) + '\\n')
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf('\\n')
      if (end === -1) return
      try {
        done(JSON.parse(buffer.slice(0, end)))
      } catch {
        done(null)
      }
    })
  })
}

/** The text of a result, which is what a hook is shown. */
function outputOf(result) {
  const content = result && Array.isArray(result.content) ? result.content : []
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\\n')
}

export function apply(ctx, config) {
  const endpoint = config && typeof config.port === 'number' ? config : null
  if (endpoint === null) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    const verdict = await askQuestion(endpoint, {
      tool: String((exec && exec.name) || ''),
      args: exec ? exec.arguments : null,
    })
    // A guard that cannot be consulted fails closed: the bridge exists exactly
    // because someone decided these calls need watching.
    if (verdict === null) {
      return { kind: 'deny', reason: '工具守卫无法连接 Pictor，按默认拒绝处理' }
    }
    if (verdict.block === true) {
      return { kind: 'deny', reason: String(verdict.reason || '被工具守卫拦截') }
    }
    return next()
  })

  /**
   * The second half: Pictor's hooks, after the call settled.
   *
   * They may append a line to what the model reads, or replace the whole outcome with a
   * failure of their own. Neither is a refusal — the call already ran — so a bridge that
   * cannot be reached leaves the result exactly as the tool left it. That is the
   * difference between this and the guard above, and it is the kernel's own seam: dsh
   * excludes input rewriting from its pre-execute decision on purpose, and lets this
   * waterfall accept, replace or block what came back.
   */
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decided = await next()
    const output = outputOf(result)
    const answer = await askQuestion(endpoint, {
      kind: 'after',
      tool: String((exec && exec.name) || ''),
      args: exec ? exec.arguments : null,
      ok: !(result && result.isError === true),
      output: output,
    })
    if (answer === null) return decided

    if (typeof answer.fail === 'string' && answer.fail.length > 0) {
      // The output follows the hook's words on purpose: the call happened, and a model
      // told only what not to do, without what it did, would have to ask again.
      const said =
        output.length === 0
          ? answer.fail
          : answer.fail + '\\n\\n---\\n\\nThe call already ran; its output was:\\n' + output
      return { kind: 'block', feedback: [{ type: 'text', text: said }] }
    }

    if (typeof answer.note === 'string' && answer.note.length > 0) {
      // The note is appended to whatever the model was going to read: the decision's own
      // content when it replaced any, otherwise the result the tool produced. next() may
      // accept a result without restating its content, and dropping the note in that case
      // would make a hook look like it ran when it did not.
      const content = Array.isArray(decided.content)
        ? decided.content
        : Array.isArray(result && result.content)
          ? result.content
          : null
      if (content !== null) {
        return { kind: 'accept', content: [...content, { type: 'text', text: answer.note }] }
      }
    }

    return decided
  })
}
`
