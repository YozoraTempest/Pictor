import { z } from 'zod'

export const ipcErrorSchema = z.object({
  code: z.enum([
    'invalid-input',
    'not-found',
    'project-unavailable',
    'credential-unavailable',
    'persistence-failed',
    'internal',
  ]),
  message: z.string().min(1),
  field: z.string().optional(),
})

export type IpcError = z.infer<typeof ipcErrorSchema>

export class PictorError extends Error {
  constructor(
    readonly code: IpcError['code'],
    message: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'PictorError'
  }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof PictorError) {
    return error.field
      ? { code: error.code, message: error.message, field: error.field }
      : { code: error.code, message: error.message }
  }

  return {
    code: 'internal',
    message: error instanceof Error ? error.message : '发生未知错误',
  }
}
