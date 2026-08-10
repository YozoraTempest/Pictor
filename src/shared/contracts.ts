import { z } from 'zod'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.literal('win32'),
})

export type AppInfo = z.infer<typeof appInfoSchema>

export interface PictorBridge {
  getAppInfo: () => Promise<AppInfo>
}
