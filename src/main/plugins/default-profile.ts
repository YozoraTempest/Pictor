import { pluginProfileSchema } from '../../plugin/profile.js'

export const defaultPluginProfile = pluginProfileSchema.parse({
  id: 'pictor.default',
  plugins: {
    'pictor.agent-workspace': '^0.2.0',
    'pictor.git-changes': '^0.2.0',
    'pictor.pi-agent-runtime': '^0.2.0',
    'pictor.pi-extension-host': '^0.2.0',
    'pictor.updater': '^0.2.0',
  },
})
