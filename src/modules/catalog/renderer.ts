import type { PictorModule } from '../../kernel/module.js'
import { updaterRendererModule } from '../updater/renderer.js'

export const rendererModules: readonly PictorModule[] = [updaterRendererModule]
