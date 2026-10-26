/**
 * A kernel that only echoes, as a third-party kernel would be written.
 *
 * Two jobs. It documents the shape a kernel takes — one cordis plugin that provides
 * exactly one `kernel.<id>` service — and it is what the end-to-end test installs, to
 * prove that adding a kernel is a directory rather than a build.
 *
 * The driver is deliberately bare: it answers every method the contract requires and
 * declares no capability it cannot honour, which is what `provideKernel` checks.
 */
export const name = 'pictor-kernel-fake'

export function apply(ctx) {
  const listeners = new Set()
  const turns = new Map()
  // Nothing to boot: a kernel that answers from memory is ready the moment it is
  // mounted, which is why its composer works straight away.
  let state = 'ready'

  const emit = (sessionId, event) => {
    for (const listener of listeners) {
      listener({ method: 'session.event', params: { sessionId, event } })
    }
  }

  const status = () => ({
    state,
    // A kernel that needs no installation still has to name where it lives: the
    // window decides "available" from this being non-null.
    binary: 'fake-kernel',
    version: '0.0.0',
    expectedVersion: '0.0.0',
    home: '',
    provider: 'fake',
    model: 'echo',
    serverInfo: { name: 'fake', version: '0.0.0' },
    permissionMode: 'workspace-write',
    error: null,
  })

  const emptyPage = () => ({ messages: [], nextOffset: 0, hasMore: false })

  ctx.provide('kernel.fake', {
    id: 'fake',
    label: '回声（示例）',
    capabilities: {
      permission: false,
      approval: false,
      model: false,
      skills: false,
      fork: false,
      commands: false,
    },

    async start() {
      state = 'ready'
      return status()
    },
    async stop() {
      state = 'stopped'
      turns.clear()
      return status()
    },
    status,
    async install() {
      return status()
    },

    async prompt(sessionId, text) {
      const turn = (turns.get(sessionId) ?? 0) + 1
      turns.set(sessionId, turn)
      emit(sessionId, { type: 'turn/start', seq: 1, data: { turn } })
      emit(sessionId, {
        type: 'assistant/message',
        seq: 2,
        data: {
          message: { role: 'assistant', content: [{ type: 'text', text: `回声：${text}` }] },
        },
      })
      emit(sessionId, { type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } } })
    },
    async cancel() {
      return undefined
    },
    async fork() {
      throw new Error('这个内核不会分叉')
    },
    adopt() {
      return undefined
    },

    async openHistory() {
      return emptyPage()
    },
    async historyPage() {
      return emptyPage()
    },

    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async answerApproval() {
      return undefined
    },
    async answerQuestions() {
      return undefined
    },

    setPermissionMode() {
      return undefined
    },
    async applyPermission() {
      return undefined
    },
    async applySettings() {
      return undefined
    },
    async sessionPermission() {
      return null
    },
    async setSessionPermission() {
      return undefined
    },
    async projectRootFor() {
      return null
    },
    async listSkills() {
      return []
    },

    async probe(prompt) {
      return { ok: true, text: `回声：${prompt}`, events: [] }
    },
  })
}
