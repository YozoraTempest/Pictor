import type { JsonValue } from '@pictor/shared'

export type AgentEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'message.delta'; runId: string; text: string }
  | { type: 'tool.started'; runId: string; tool: string; input: JsonValue }
  | { type: 'tool.finished'; runId: string; tool: string; output: string; isError: boolean }
  | {
      type: 'run.finished'
      runId: string
      reason: 'stop' | 'cancelled' | 'error'
      message?: string
    }

export interface AgentRequest {
  runId: string
  prompt: string
  workingDirectory: string
}

export interface AgentRunHandle {
  readonly runId: string
  cancel(): void
}

export interface AgentRuntime {
  readonly id: string
  run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<AgentRunHandle>
}

/**
 * Deterministic local runtime.
 *
 * It exists so the scaffold, tests and plugin development do not require a model
 * endpoint. The Pi adapter implements the same interface for real runs.
 */
export class EchoAgentRuntime implements AgentRuntime {
  readonly id = 'echo'

  async run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<AgentRunHandle> {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      onEvent({ type: 'run.started', runId: request.runId })
      onEvent({ type: 'message.delta', runId: request.runId, text: `Echo: ${request.prompt}` })
      onEvent({ type: 'run.finished', runId: request.runId, reason: 'stop' })
    })

    return {
      runId: request.runId,
      cancel(): void {
        cancelled = true
        onEvent({ type: 'run.finished', runId: request.runId, reason: 'cancelled' })
      },
    }
  }
}
