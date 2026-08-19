import type { PictorModule } from '../../kernel/module.js'
import { createUpdaterMainModule, type UpdaterMainModuleOptions } from '../updater/main.js'

export interface MainModuleOptions {
  updater: UpdaterMainModuleOptions
}

export function createMainModules(options: MainModuleOptions): PictorModule[] {
  return [createUpdaterMainModule(options.updater)]
}
