import { z } from 'zod'

import {
  defineModuleContract,
  invokeModuleMethod,
  type ModuleTransport,
} from '@pictor/plugin-sdk/contract'

export const gitChangesContract = defineModuleContract({
  id: 'pictor.git-changes',
  methods: {
    getStatus: {
      input: z.object({ projectRoot: z.string().min(1) }),
      output: z.object({
        available: z.boolean(),
        output: z.string(),
        message: z.string().nullable(),
      }),
    },
  },
  events: {},
})

export function createGitChangesClient(transport: ModuleTransport) {
  return {
    getStatus: (projectRoot: string) =>
      invokeModuleMethod(transport, gitChangesContract, 'getStatus', { projectRoot }),
  }
}

export type GitChangesClient = ReturnType<typeof createGitChangesClient>
