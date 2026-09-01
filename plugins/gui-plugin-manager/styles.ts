import styles from './styles.css?raw'

import { installGuiPluginStyles } from '../../src/gui/plugin-style.js'

export function installPluginManagerStyles(target: Document = document): () => void {
  return installGuiPluginStyles('pictor.gui.plugin-manager', styles, target)
}
