export interface GuiPluginStyleTarget {
  createElement(localName: 'style'): HTMLStyleElement
  head: HTMLElement
}

/**
 * Installs one owned stylesheet for a GUI Plugin and returns its disposer.
 *
 * The DOM node and its stable identity stay inside this helper so Plugin
 * modules only manage the lifecycle returned from activation.
 */
export function installGuiPluginStyles(
  pluginId: string,
  cssText: string,
  target: GuiPluginStyleTarget = document,
): () => void {
  const style = target.createElement('style')
  style.dataset.pictorPlugin = pluginId
  style.textContent = cssText
  target.head.append(style)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    style.remove()
  }
}
