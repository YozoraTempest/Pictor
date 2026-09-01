import styles from './styles.css?raw'

import { installGuiPluginStyles } from '../../src/gui/plugin-style.js'

export function installGitChangesStyles(target: Document = document): () => void {
  return installGuiPluginStyles('pictor.git-changes', styles, target)
}
