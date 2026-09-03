import { pluginProfileSchema } from './profile.js'

export const defaultPluginProfile = pluginProfileSchema.parse({
  id: 'pictor.default',
  plugins: {
    'pictor.agent-workspace': '^0.4.0',
    'pictor.workbench.delegate': '^0.4.0',
    'pictor.tui.delegate': '^0.4.0',
    'pictor.gui.plugin-manager': '^0.4.0',
    'pictor.agent-resources': '^0.4.0',
    'pictor.git-changes': '^0.4.0',
    'pictor.model-openai-compatible': '^0.4.0',
    'pictor.pi-agent-runtime': '^0.4.0',
    'pictor.pi-extension-host': '^0.4.0',
    'pictor.updater': '^0.4.0',
  },
})

export const developerPluginProfile = pluginProfileSchema.parse({
  id: 'pictor.developer',
  plugins: { ...defaultPluginProfile.plugins },
})
