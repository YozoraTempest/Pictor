import styles from './styles.css?raw'

export function installWorkbenchStyles(target: Document = document): () => void {
  const style = target.createElement('style')
  style.dataset.pictorPlugin = 'pictor.workbench.delegate'
  style.textContent = styles
  target.head.append(style)
  return () => style.remove()
}
