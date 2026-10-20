export interface CommandDefinition<TInput = undefined, TOutput = unknown> {
  id: string
  description: string
  handler: (input: TInput) => Promise<TOutput> | TOutput
}

export interface CommandDescriptor {
  id: string
  description: string
}

export class CommandError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommandError'
    this.code = code
  }
}

/**
 * The single place frontends can invoke application behaviour.
 *
 * Registry, handlers and cancellation stay inside the engine; frontends only
 * see `list()` and `execute()`. This is what keeps GUI, TUI and CLI from
 * re-implementing product logic.
 */
export class CommandEngine {
  readonly #commands = new Map<string, CommandDefinition<unknown, unknown>>()

  register<TInput, TOutput>(definition: CommandDefinition<TInput, TOutput>): () => void {
    if (this.#commands.has(definition.id)) {
      throw new CommandError('duplicate-command', `command already registered: ${definition.id}`)
    }

    this.#commands.set(definition.id, definition as unknown as CommandDefinition<unknown, unknown>)

    return () => {
      this.#commands.delete(definition.id)
    }
  }

  list(): CommandDescriptor[] {
    return [...this.#commands.values()]
      .map(({ id, description }) => ({ id, description }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  has(id: string): boolean {
    return this.#commands.has(id)
  }

  async execute<TOutput = unknown>(id: string, input?: unknown): Promise<TOutput> {
    const definition = this.#commands.get(id)
    if (definition === undefined) {
      throw new CommandError('unknown-command', `unknown command: ${id}`)
    }

    return (await definition.handler(input)) as TOutput
  }
}
