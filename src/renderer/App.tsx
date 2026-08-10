import { MessageSquareText, Plus, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AppInfo } from '../shared/contracts'

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true

    void window.pictor.getAppInfo().then((info) => {
      if (active) setAppInfo(info)
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="项目与会话">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <strong>Pictor</strong>
            <span>Delegate workspace</span>
          </div>
          <button className="icon-button" type="button" aria-label="新建项目" title="新建项目">
            <Plus size={17} />
          </button>
        </div>
        <div className="sidebar-empty">
          <span>尚未添加项目</span>
        </div>
        <button className="settings-button" type="button">
          <Settings size={16} />
          设置
        </button>
      </aside>

      <section className="workspace" aria-label="会话">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">委托模式</span>
            <h1>选择一个项目开始</h1>
          </div>
          <span className="version-label">{appInfo ? `v${appInfo.version}` : '正在连接'}</span>
        </header>

        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <MessageSquareText size={24} />
          </div>
          <h2>从本地项目创建第一个 Session</h2>
          <p>项目、会话和 Agent 运行会在这里保持连续。</p>
          <button className="primary-button" type="button">
            <Plus size={16} />
            新建项目
          </button>
        </div>
      </section>
    </main>
  )
}
