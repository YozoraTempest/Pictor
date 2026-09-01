import { z } from 'zod'

export const appDoctorCheckSchema = z.object({
  id: z.enum(['plugin-store', 'plugin-restart']),
  status: z.enum(['ok', 'warning']),
  message: z.string().min(1),
})

export const appDoctorResultSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.array(appDoctorCheckSchema),
})

export type AppDoctorResult = z.output<typeof appDoctorResultSchema>
