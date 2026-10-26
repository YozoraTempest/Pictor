import type { KernelCommand } from '@pictor/kernel-sdk'

/**
 * Reading the runtime's command surface into Pictor's shape.
 *
 * `commands/list` answers with descriptors the runtime owns: a name without a slash, a
 * sentence for the menu, and an optional input hint. `commands/execute` answers with a
 * settlement — `{commandId, result: {kind, text?}}` — where a refusal is a result, not
 * a transport error, so the sentence still has to reach the window.
 *
 * Both payloads arrive as untyped JSON: the runtime is a separate process on its own
 * version, and a field that changed shape has to be dropped rather than crash a menu.
 */

/** The command list, keeping only entries the menu can draw. */
export function parseCommands(value: unknown): KernelCommand[] {
  const list = (value as { commands?: unknown } | null)?.commands ?? value
  if (!Array.isArray(list)) return []

  const commands: KernelCommand[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { name?: unknown; description?: unknown; input?: unknown }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (name.length === 0) continue
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    const input = record.input as { placeholder?: unknown } | undefined
    const placeholder = typeof input?.placeholder === 'string' ? input.placeholder : ''
    commands.push({
      name,
      // A command with no sentence still has to be listed: the runtime offers it, and
      // hiding it would leave a valid line the menu can never suggest.
      description: description.length === 0 ? `/${name}` : description,
      ...(placeholder.length === 0 ? {} : { input: placeholder }),
    })
  }
  return commands
}

/** What one execution said, or null when it said nothing worth a banner. */
export function commandTextOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const result = (value as { result?: unknown }).result
  if (typeof result !== 'object' || result === null) return null
  const { kind, text, message } = result as {
    kind?: unknown
    text?: unknown
    message?: unknown
  }
  const said = typeof text === 'string' ? text : typeof message === 'string' ? message : ''
  if (said.trim().length === 0) {
    // A refusal with no words would look like a button that did nothing; name it.
    return kind === 'error' ? '命令没有完成' : null
  }
  return said
}
