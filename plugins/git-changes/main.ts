import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { moduleHandlerContributions, registerModuleHandlers } from '../../src/kernel/contract.js'
import { defineModule } from '../../src/kernel/module.js'
import { pluginEntrypoint, type MainPluginContext } from '../../src/plugin/entry.js'
import { gitChangesContract } from './shared.js'

const execFileAsync = promisify(execFile)

export default pluginEntrypoint<MainPluginContext>(() => [
  defineModule({
    id: 'pictor.git-changes.main',
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
