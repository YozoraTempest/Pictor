import styles from './styles.css?raw'

import { installGuiPluginStyles } from '../../src/gui/plugin-style.js'

export function installWorkbenchStyles(target: Document = document): () => void {
  return installGuiPluginStyles('pictor.workbench.delegate', styles, target)
}
