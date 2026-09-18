import type { WebConnectionState } from './connection.js'

const labels: Record<Exclude<WebConnectionState, 'ready' | 'stopped'>, string> = {
  connecting: '正在连接 Pictor Host…',
  reconnecting: 'Pictor Host 正在重新启动，连接恢复后会继续。',
  'lease-conflict': '另一个浏览器窗口正在使用当前 Pictor Profile。',
}

export class WebConnectionStatusView {
  private readonly element: HTMLDivElement

  constructor(target: HTMLElement = document.body) {
    this.element = document.createElement('div')
    this.element.className = 'web-connection-status'
    this.element.setAttribute('role', 'status')
    this.element.setAttribute('aria-live', 'polite')
    target.append(this.element)
  }

  update(state: WebConnectionState): void {
    if (state === 'ready' || state === 'stopped') {
      this.element.hidden = true
      this.element.dataset.state = state
      return
    }
    this.element.hidden = false
    this.element.dataset.state = state
    this.element.textContent = labels[state]
  }

  showReload(): void {
    this.element.hidden = false
    this.element.dataset.state = 'reloading'
    this.element.textContent = '创造模式已生成新的 Host，正在重新装配界面…'
  }

  stop(): void {
    this.element.remove()
  }
}
