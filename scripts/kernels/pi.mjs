/**
 * Pi coding agent as a kernel, driven through `pi -p --mode json`.
 *
 * Pi's JSON mode is the most explicit of the three: it opens with a `session`
 * line carrying the id and cwd, narrates `message_update` objects whose
 * `assistantMessageEvent.type` says whether a delta is text, thinking or a tool
 * call, and closes with `turn_end` plus token counts. That makes it a good
 * reference for what a well-shaped kernel stream looks like.
 *
 * Verified against: `pi -p --mode json` emitting `session`, `turn_start`,
 * `message_update` (`text_start`/`text_delta`/`text_end`), `turn_end`, `agent_end`.
 */

/** @typedef {import('./types.mjs').KernelAdapter} KernelAdapter */

import { readUsage, runJsonLines } from './jsonl.mjs'

/** @type {KernelAdapter} */
export const piKernel = {
  id: 'pi',
  label: 'Pi',
  capabilities: {
    streaming: true,
    thinking: true,
    usage: true,
    approvals: false,
    questions: false,
    resume: true,
    history: true,
    fork: true,
  },

  async run({ prompt, cwd, signal, onEvent, sessionId, model }) {
    const args = ['-p', '--mode', 'json']
    if (sessionId !== null) args.push('--session-id', sessionId)
    if (model !== null) args.push('--model', model)
    args.push(prompt)

    let session = sessionId
    let failure = null

    const result = await runJsonLines({
      command: 'pi',
      args,
      cwd,
      signal,
      onEvent,
      handle: (line) => {
        const type = typeof line.type === 'string' ? line.type : ''

        if (type === 'session') {
          session = typeof line.id === 'string' ? line.id : session
          onEvent({ type: 'run.started', sessionId: session })
          return
        }
        if (type === 'turn_start') {
          // A first turn already opened at `session`; a resumed one opens here.
          if (session === sessionId) onEvent({ type: 'run.started', sessionId: session })
          return
        }
        if (type === 'message_update') {
          const inner =
            typeof line.assistantMessageEvent === 'object' && line.assistantMessageEvent !== null
              ? line.assistantMessageEvent
              : {}
          const kind = typeof inner.type === 'string' ? inner.type : ''

          if (kind === 'text_delta' && typeof inner.delta === 'string') {
            onEvent({ type: 'text.delta', text: inner.delta })
          } else if (kind === 'thinking_delta' && typeof inner.delta === 'string') {
            onEvent({ type: 'thinking.delta', text: inner.delta })
          } else if (
            kind === 'toolcall_start' ||
            kind === 'toolcall_delta' ||
            kind === 'toolcall_end'
          ) {
            // The model writing the call, not the call running: its execution is
            // reported at the top level once the arguments are complete.
          } else if (kind === 'error') {
            failure = typeof inner.message === 'string' ? inner.message : 'pi 报告了一个错误'
          }

          // Counts ride on every update and start at zero; the turn's own line
          // carries the final numbers, so only that one is reported.
          return
        }
        if (type === 'turn_end') {
          const usage = readUsage(line.message?.usage)
          if (usage.total !== null) onEvent({ type: 'usage', ...usage })
          return
        }
        if (type === 'message_start' || type === 'message_end' || type === 'agent_start') return
        if (type === 'tool_execution_start') {
          onEvent({
            type: 'tool.start',
            callId: typeof line.toolCallId === 'string' ? line.toolCallId : null,
            tool: typeof line.toolName === 'string' ? line.toolName : 'tool',
            input: line.args ?? null,
          })
          return
        }
        if (type === 'tool_execution_update') return
        if (type === 'tool_execution_end') {
          const result = line.result
          onEvent({
            type: 'tool.finished',
            callId: typeof line.toolCallId === 'string' ? line.toolCallId : null,
            output: typeof result === 'string' ? result : JSON.stringify(result ?? ''),
            isError: line.isError === true,
          })
          return
        }
        if (type === 'agent_end') {
          if (line.aborted === true || line.willRetry === true) failure = 'pi 中止了这一轮'
          return
        }
        if (type === 'agent_settled') {
          if (line.aborted === true) failure = 'pi 中止了这一轮'
          return
        }
        onEvent({ type: 'notice', message: `未映射的 pi 事件：${type}` })
      },
    })

    const ok = failure === null && result.code === 0
    onEvent({
      type: 'run.finished',
      ok,
      ...(ok
        ? {}
        : { error: failure ?? `pi 退出码 ${String(result.code)}：${result.stderr.slice(-300)}` }),
    })
    return { ok, sessionId: session, error: ok ? null : (failure ?? 'pi 运行失败') }
  },
}
