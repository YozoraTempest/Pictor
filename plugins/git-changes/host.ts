import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { moduleHandlerContributions, registerModuleHandlers } from '@pictor/plugin-sdk/contract'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type HostPluginContext } from '@pictor/plugin-sdk/plugin'
import { gitChangesContract } from './shared.js'

const execFileAsync = promisify(execFile)

export default pluginEntrypoint<HostPluginContext>(() => [
  defineModule({
    id: 'pictor.git-changes.host',
    activate(context) {
      context.contribute(
        moduleHandlerContributions,
        registerModuleHandlers(gitChangesContract, {
          getStatus: async ({ projectRoot }) => {
            try {
              const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
                cwd: projectRoot,
                timeout: 10_000,
                windowsHide: true,
              })
              return { available: true, output: stdout.trim(), message: null }
            } catch (error) {
              return {
                available: false,
                output: '',
                message: error instanceof Error ? error.message : 'Git status failed',
              }
            }
          },
        }),
      )
    },
  }),
])
