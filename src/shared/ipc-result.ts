import { z } from 'zod'

import { toIpcError, type IpcResult } from './errors.js'

export async function ipcResult<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]
      return {
        ok: false,
        error: {
          code: 'invalid-input',
          message: issue?.message ?? '输入内容无效',
          ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
        },
      }
    }
    return { ok: false, error: toIpcError(error) }
  }
}
