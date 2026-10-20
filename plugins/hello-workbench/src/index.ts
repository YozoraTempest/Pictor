import type { PluginModule } from '@pictor/plugin-sdk'

/**
 * Minimal bundled plugin.
 *
 * It proves the whole host loop: discovery, manifest validation, dependency
 * resolution, activation, contribution registration, UI visibility and reverse
 * disposal. Everything it does goes through the public Plugin SDK contract.
 */
const plugin: PluginModule = {
  activate(context) {
    context.logger.info(`hello-workbench activated (data: ${context.dataDirectory})`)

    context.contribute('commands', {
      id: 'hello.greet',
      description: 'Greet from the bundled hello-workbench plugin',
      result: { greeting: 'Hello from pictor.hello' },
    })
  },

  deactivate() {
    // Contributions are disposed by the host; nothing else to release yet.
  },
}

export default plugin
