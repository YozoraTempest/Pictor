/**
 * The kernel-side half of Pictor's tool guards.
 *
 * Pictor's guards are JavaScript closures living in the app process, so they
 * cannot be serialised into this profile. This package is written into the
 * profile's `node_modules` at boot, mounted with an `insert` patch, and asks the
 * app about every tool call over a loopback socket.
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

/** One question per tool call, answered by the app over loopback. */
function ask(endpoint, tool, args) {
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
      socket.write(JSON.stringify({ token: endpoint.token, tool, args }) + '\\n')
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

export function apply(ctx, config) {
  const endpoint = config && typeof config.port === 'number' ? config : null
  if (endpoint === null) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    const verdict = await ask(endpoint, String((exec && exec.name) || ''), exec ? exec.arguments : null)
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
}
`
