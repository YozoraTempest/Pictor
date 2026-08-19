import { pluginProfileSchema } from '../../plugin/profile.js'

export const defaultPluginProfile = pluginProfileSchema.parse({
  id: 'pictor.default',
  plugins: {
    'pictor.updater': '^0.2.0',
  },
})
