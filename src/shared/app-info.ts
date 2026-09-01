import { z } from 'zod'

export const buildChannelSchema = z.enum(['development', 'stable', 'nightly'])

export const appInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    buildChannel: buildChannelSchema,
    sourceCommit: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    platform: z.enum(['win32', 'linux']),
    arch: z.literal('x64'),
    distribution: z.enum(['windows', 'arch', 'unsupported-linux']),
  })
  .superRefine((value, context) => {
    if (value.buildChannel !== 'development' && value.sourceCommit === null) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCommit'],
        message: 'Packaged builds require an exact source commit',
      })
    }
  })

export type AppInfo = z.infer<typeof appInfoSchema>
export type BuildChannel = z.infer<typeof buildChannelSchema>
