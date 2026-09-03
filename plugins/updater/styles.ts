import styles from './styles.css?raw'

import { installGuiPluginStyles } from '../../src/gui/plugin-style.js'

export function installUpdaterStyles(target: Document = document): () => void {
  return installGuiPluginStyles('pictor.updater', styles, target)
}
