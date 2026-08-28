import { z } from 'zod'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.enum(['win32', 'linux']),
  arch: z.literal('x64'),
  distribution: z.enum(['windows', 'arch', 'unsupported-linux']),
})

export type AppInfo = z.infer<typeof appInfoSchema>
