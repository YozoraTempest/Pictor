import type { z } from 'zod'

import { commandErrorSchema, CommandFailure } from './contract.js'
import type { CommandClient, CommandContext, CommandEvent } from './contract.js'

export async function executeCommandAndWait<TSchema extends z.ZodType>(
  client: CommandClient,
  commandId: string,
  input: unknown,
  context: CommandContext,
  outputSchema: TSchema,
): Promise<z.output<TSchema>> {
  const execution = await client.execute(commandId, input, context)
  return new Promise<z.output<TSchema>>((resolve, reject) => {
    let settled = false
    let release: (() => void) | null = null

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
      release?.()
    }

    const onEvent = (event: CommandEvent): void => {
      if (event.type === 'completed') {
        finish(() => {
          try {
            resolve(outputSchema.parse(event.result.value))
          } catch {
            reject(
              new CommandFailure(
                commandErrorSchema.parse({
                  code: 'invalid-output',
                  message: '命令输出无效',
                  commandId: execution.commandId,
                  executionId: execution.executionId,
                }),
              ),
            )
          }
        })
      } else if (event.type === 'failed') {
        finish(() => reject(new CommandFailure(event.error)))
      } else if (event.type === 'cancelled') {
        finish(() =>
          reject(
            new CommandFailure(
              commandErrorSchema.parse({
                code: 'cancelled',
                message: '命令已取消',
                commandId: execution.commandId,
                executionId: execution.executionId,
              }),
            ),
          ),
        )
      }
    }

    try {
      release = client.subscribe(execution.executionId, onEvent)
      if (settled) release()
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
