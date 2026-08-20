import type { SessionRecord } from './domain.js'
import type { RuntimeEvent } from './runtime-protocol.js'

export const REDACTED_SECRET = '[REDACTED]'

function uniqueSecrets(secretValues: readonly string[]): string[] {
  return [...new Set(secretValues.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  )
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export class SecretRedactor {
  private readonly secrets: string[]

  constructor(secretValues: readonly string[]) {
    this.secrets = uniqueSecrets(secretValues)
  }

  redactText(text: string): string {
    return this.secrets.reduce(
      (redacted, secret) => redacted.split(secret).join(REDACTED_SECRET),
      text,
    )
  }

  redactSession(session: SessionRecord): SessionRecord {
    return {
      ...session,
      title: this.redactText(session.title).slice(0, 120),
      messages: session.messages.map((message) => ({
        ...message,
        content: this.redactText(message.content),
      })),
      runs: session.runs.map((run) => ({
        ...run,
        error: run.error === null ? null : this.redactText(run.error),
        toolEvents: run.toolEvents.map((tool) => ({
          ...tool,
          label: this.redactText(tool.label),
          path: tool.path === null ? null : this.redactText(tool.path),
          output: tool.output === null ? null : this.redactText(tool.output),
          command:
            tool.command === null
              ? null
              : {
                  ...tool.command,
                  command: this.redactText(tool.command.command),
                  cwd: this.redactText(tool.command.cwd),
                  purpose: this.redactText(tool.command.purpose),
                },
        })),
      })),
    }
  }

  redactRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    switch (event.type) {
      case 'run.stateChanged':
        return { ...event, error: event.error === null ? null : this.redactText(event.error) }
      case 'message.delta':
        return { ...event, delta: this.redactText(event.delta) }
      case 'message.completed':
        return { ...event, content: this.redactText(event.content) }
      case 'tool.started':
        return {
          ...event,
          label: this.redactText(event.label),
          path: event.path === null ? null : this.redactText(event.path),
        }
      case 'tool.updated':
      case 'tool.completed':
        return { ...event, output: this.redactText(event.output) }
      case 'approval.requested':
        return {
          ...event,
          command: this.redactText(event.command),
          cwd: this.redactText(event.cwd),
          purpose: this.redactText(event.purpose),
        }
      case 'runtime.error':
        return { ...event, message: this.redactText(event.message) }
      case 'extension.ui.requested':
        return {
          ...event,
          title: this.redactText(event.title),
          message: event.message === null ? null : this.redactText(event.message),
          options: event.options.map((option) => this.redactText(option)),
          value: event.value === null ? null : this.redactText(event.value),
        }
      case 'extension.ui.notification':
        return { ...event, message: this.redactText(event.message) }
      case 'extension.ui.status':
        return { ...event, text: event.text === null ? null : this.redactText(event.text) }
      case 'queue.updated':
        return {
          ...event,
          steering: event.steering.map((message) => this.redactText(message)),
          followUp: event.followUp.map((message) => this.redactText(message)),
        }
      case 'usage.updated':
      case 'session.activeLeafChanged':
        return event
      case 'compaction.stateChanged':
        return { ...event, error: event.error === null ? null : this.redactText(event.error) }
      case 'session.bound':
        return event
      case 'message.started':
      case 'approval.resolved':
        return event
    }
  }

  redactPiEntry(entry: unknown): unknown {
    const object = objectValue(entry)
    if (!object || typeof object.type !== 'string') {
      throw new Error('Invalid Pi transcript entry')
    }

    switch (object.type) {
      case 'session':
      case 'model_change':
      case 'thinking_level_change':
        return entry
      case 'message':
        return { ...object, message: this.redactPiMessage(object.message) }
      case 'compaction':
        return {
          ...object,
          summary: this.redactRequiredText(object.summary),
          ...(Array.isArray(object.retainedTail)
            ? { retainedTail: object.retainedTail.map((message) => this.redactPiMessage(message)) }
            : {}),
          ...(object.details === undefined ? {} : { details: this.redactPayload(object.details) }),
        }
      case 'branch_summary':
        return {
          ...object,
          summary: this.redactRequiredText(object.summary),
          ...(object.details === undefined ? {} : { details: this.redactPayload(object.details) }),
        }
      case 'custom':
        return {
          ...object,
          ...(object.data === undefined ? {} : { data: this.redactPayload(object.data) }),
        }
      case 'custom_message':
        return {
          ...object,
          content: this.redactPiContent(object.content),
          ...(object.details === undefined ? {} : { details: this.redactPayload(object.details) }),
        }
      case 'label':
        return {
          ...object,
          ...(typeof object.label === 'string' ? { label: this.redactText(object.label) } : {}),
        }
      case 'session_info':
        return {
          ...object,
          ...(typeof object.name === 'string' ? { name: this.redactText(object.name) } : {}),
        }
      default:
        throw new Error('Unsupported Pi transcript entry')
    }
  }

  redactPiEntryInPlace<T>(entry: T): T {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid Pi transcript entry')
    }
    const redacted = this.redactPiEntry(entry)
    if (redacted === entry) return entry
    for (const key of Object.keys(entry)) Reflect.deleteProperty(entry, key)
    Object.assign(entry, redacted)
    return entry
  }

  private redactPiMessage(value: unknown): unknown {
    const message = objectValue(value)
    if (!message || typeof message.role !== 'string') throw new Error('Invalid Pi message')

    switch (message.role) {
      case 'user':
        return { ...message, content: this.redactPiContent(message.content) }
      case 'assistant':
        return {
          ...message,
          content: this.redactPiContent(message.content),
          ...(typeof message.errorMessage === 'string'
            ? { errorMessage: this.redactText(message.errorMessage) }
            : {}),
        }
      case 'toolResult':
        return {
          ...message,
          content: this.redactPiContent(message.content),
          ...(message.details === undefined
            ? {}
            : { details: this.redactPayload(message.details) }),
        }
      default:
        throw new Error('Unsupported Pi message')
    }
  }

  private redactPiContent(value: unknown): unknown {
    if (typeof value === 'string') return this.redactText(value)
    if (!Array.isArray(value)) throw new Error('Invalid Pi message content')

    return value.map((item) => {
      const block = objectValue(item)
      if (!block || typeof block.type !== 'string') throw new Error('Invalid Pi content block')
      if (block.type === 'text' && typeof block.text === 'string') {
        return { ...block, text: this.redactText(block.text) }
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return { ...block, thinking: this.redactText(block.thinking) }
      }
      if (block.type === 'toolCall' && objectValue(block.arguments)) {
        return { ...block, arguments: this.redactPayload(block.arguments) }
      }
      if (block.type === 'image') return block
      throw new Error('Unsupported Pi content block')
    })
  }

  private redactPayload(value: unknown): unknown {
    if (typeof value === 'string') return this.redactText(value)
    if (Array.isArray(value)) return value.map((item) => this.redactPayload(item))
    const object = objectValue(value)
    if (!object) return value
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, this.redactPayload(item)]),
    )
  }

  private redactRequiredText(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid Pi text payload')
    return this.redactText(value)
  }
}

export function createSecretRedactor(secretValues: readonly string[]): SecretRedactor {
  return new SecretRedactor(secretValues)
}
