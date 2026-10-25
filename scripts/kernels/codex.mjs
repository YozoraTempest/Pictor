/**
 * Codex CLI as a kernel, driven through `codex exec --json`.
 *
 * The turn is one process: Codex starts its own sandbox, runs the tools it wants
 * inside it, and narrates the whole thing as JSONL. That means the adapter owns
 * no protocol — and also that an approval prompt has nowhere to go, so the
 * sandbox mode is fixed here rather than negotiated per call.
 *
 * Verified against: `codex exec --json` emitting `thread.started`, `turn.started`,
 * `item.completed` (`agent_message`, `error`, …) and `turn.completed`.
 */

/** @typedef {import('./types.mjs').KernelAdapter} KernelAdapter */

import { readUsage, runJsonLines } from './jsonl.mjs'

/** Kept narrow on purpose: a research probe must not be able to edit the tree. */
const SANDBOX = 'read-only'

/** Codex names its work by what it did; the transcript names it by what ran. */
const TOOL_NAMES = {
  command_execution: 'bash',
  file_change: 'apply_patch',
  mcp_tool_call: 'mcp',
}

/** @type {KernelAdapter} */
export const codexKernel = {
  id: 'codex',
  label: 'Codex CLI',
  capabilities: {
    streaming: true,
    thinking: false,
    usage: true,
    approvals: false,
    questions: false,
    resume: true,
    history: true,
    fork: true,
  },

  async run({ prompt, cwd, signal, onEvent, sessionId, model }) {
    const args = sessionId === null ? ['exec'] : ['exec', 'resume', sessionId]
    args.push('--json', '--skip-git-repo-check', '--sandbox', SANDBOX, '-C', cwd)
    if (model !== null) args.push('-m', model)
    args.push(prompt)

    let thread = sessionId
    let failure = null

    const result = await runJsonLines({
      command: 'codex',
      args,
      cwd,
      signal,
      onEvent,
      handle: (line) => {
        const type = typeof line.type === 'string' ? line.type : ''

        if (type === 'thread.started') {
          thread = typeof line.thread_id === 'string' ? line.thread_id : thread
          onEvent({ type: 'run.started', sessionId: thread })
          return
        }
        if (type === 'turn.started') {
          if (thread === sessionId) onEvent({ type: 'run.started', sessionId: thread })
          return
        }
        if (type === 'turn.completed') {
          const usage = readUsage(line.usage)
          onEvent({ type: 'usage', ...usage })
          return
        }
        if (type === 'turn.failed') {
          failure = JSON.stringify(line.error ?? line).slice(0, 400)
          return
        }
        if (type !== 'item.completed' && type !== 'item.started' && type !== 'item.updated') {
          return
        }

        const item = typeof line.item === 'object' && line.item !== null ? line.item : {}
        const kind = typeof item.type === 'string' ? item.type : ''
        const id = typeof item.id === 'string' ? item.id : null

        if (kind === 'agent_message' && typeof item.text === 'string') {
          onEvent({ type: 'text.delta', text: item.text })
          return
        }
        if (kind === 'reasoning' && typeof item.text === 'string') {
          onEvent({ type: 'thinking.delta', text: item.text })
          return
        }
        if (kind === 'error' && typeof item.message === 'string') {
          // Codex reports configuration warnings this way; they are worth seeing
          // once, but they are not the turn's failure.
          onEvent({ type: 'notice', message: item.message.split('\n')[0].slice(0, 200) })
          return
        }

        // Everything else Codex reports is work it did: `command_execution`,
        // `file_change`, `mcp_tool_call` and whatever it adds next. Rather than
        // enumerate them, an unrecognised item that carries a status is treated
        // as a tool, so a new kind shows up in the transcript instead of vanishing.
        if (!('status' in item)) return

        const running = item.status !== 'completed' && item.status !== 'failed'
        if (running) {
          onEvent({
            type: 'tool.start',
            callId: id,
            tool: TOOL_NAMES[kind] ?? kind,
            input: kind === 'command_execution' ? { command: item.command } : item,
          })
          return
        }

        const output =
          typeof item.aggregated_output === 'string'
            ? item.aggregated_output
            : typeof item.output === 'string'
              ? item.output
              : ''
        onEvent({
          type: 'tool.finished',
          callId: id,
          output,
          isError:
            item.status === 'failed' ||
            (typeof item.exit_code === 'number' && item.exit_code !== 0),
        })
      },
    })

    const ok = failure === null && result.code === 0
    onEvent({
      type: 'run.finished',
      ok,
      ...(ok
        ? {}
        : {
            error: failure ?? `codex 退出码 ${String(result.code)}：${result.stderr.slice(-300)}`,
          }),
    })
    return { ok, sessionId: thread, error: ok ? null : (failure ?? 'codex 运行失败') }
  },
}
