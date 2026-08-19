import { DatabaseZap, FolderPlus, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { PluginManagerSnapshot } from '../../shared/plugins'
import type { PluginStatus } from '../../plugin/host'

const stateLabels = {
  active: '运行中',
  disabled: '已禁用',
  blocked: '已阻塞',
  failed: '启动失败',
  'pending-restart': '等待重启',
} as const

interface PluginManagerProps {
  rendererPluginStatuses: readonly PluginStatus[]
}

export function PluginManager({ rendererPluginStatuses }: PluginManagerProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<PluginManagerSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.pictor.getPluginManagerSnapshot().then((result) => {
      if (!active) return
      setBusy(null)
      if (result.ok) setSnapshot(result.value)
      else setError(result.error.message)
    })
    return () => {
      active = false
    }
  }, [])

  const apply = async (
    key: string,
    operation: () => Promise<Awaited<ReturnType<typeof window.pictor.getPluginManagerSnapshot>>>,
  ) => {
    setBusy(key)
    setError(null)
    const result = await operation()
    setBusy(null)
    if (result.ok) setSnapshot(result.value)
    else setError(result.error.message)
  }

  if (!snapshot) {
    return (
      <div className="plugin-manager-loading" role="status">
        {busy ? <LoaderCircle className="spin" size={17} /> : null}
        <span>{error ?? '正在读取 Plugin Registry'}</span>
      </div>
    )
  }

  return (
    <div className="plugin-manager">
      <header className="plugin-manager__toolbar">
        <div>
          <h3>Plugins</h3>
          <span>{snapshot.items.length} 个已登记扩展</span>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy !== null}
          onClick={() => void apply('install', () => window.pictor.installLocalPlugin())}
        >
          {busy === 'install' ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <FolderPlus size={14} />
          )}
          安装本地 Plugin
        </button>
      </header>

      {snapshot.safeMode ? (
        <div className="plugin-manager__notice" role="status">
          安全模式已忽略全部 Plugin
        </div>
      ) : null}
      {snapshot.restartRequired ? (
        <div className="plugin-manager__notice" role="status">
          重启 Pictor 后应用 Plugin 变更
        </div>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="plugin-list">
        {snapshot.items.length === 0 ? (
          <div className="plugin-list__empty">没有已安装的 Plugin</div>
        ) : (
          snapshot.items.map((item) => {
            const rendererStatus = rendererPluginStatuses.find((status) => status.id === item.id)
            const effectiveState =
              item.effectiveState === 'pending-restart'
                ? item.effectiveState
                : (rendererStatus?.effectiveState ?? item.effectiveState)
            const reason = rendererStatus?.reason ?? item.reason
            return (
              <div className="plugin-row" key={`${item.kind}:${item.id}`}>
                <div className="plugin-row__identity">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.version ? `v${item.version}` : item.kind}</span>
                  </div>
                  <code>{item.id}</code>
                </div>
                <div className="plugin-row__state">
                  <span className={`plugin-state plugin-state--${effectiveState}`}>
                    {stateLabels[effectiveState]}
                  </span>
                  <small title={item.source}>{reason ?? item.source}</small>
                </div>
                <div className="plugin-row__actions">
                  {item.canRestore ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void apply(item.id, () =>
                          window.pictor.restoreBundledPlugin({ id: item.id }),
                        )
                      }
                    >
                      <RotateCcw size={14} />
                      恢复
                    </button>
                  ) : item.desiredState !== 'removed' && item.kind === 'pictor-plugin' ? (
                    <>
                      <label className="plugin-toggle">
                        <input
                          type="checkbox"
                          checked={item.desiredState === 'enabled'}
                          disabled={busy !== null}
                          onChange={(event) =>
                            void apply(item.id, () =>
                              window.pictor.setPluginEnabled({
                                id: item.id,
                                enabled: event.target.checked,
                              }),
                            )
                          }
                        />
                        <span>启用</span>
                      </label>
                      <button
                        className="icon-button"
                        type="button"
                        title="移除 Plugin，保留数据"
                        aria-label={`移除 ${item.name}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void apply(item.id, () =>
                            window.pictor.removePlugin({ id: item.id, deleteData: false }),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        className="icon-button danger-icon-button"
                        type="button"
                        title="移除 Plugin 及数据"
                        aria-label={`移除 ${item.name} 及数据`}
                        disabled={busy !== null}
                        onClick={() => {
                          if (!window.confirm(`移除 ${item.name} 及其全部数据？`)) return
                          void apply(item.id, () =>
                            window.pictor.removePlugin({ id: item.id, deleteData: true }),
                          )
                        }}
                      >
                        <DatabaseZap size={15} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      {snapshot.issues.map((issue) => (
        <div className="form-error" role="alert" key={issue}>
          {issue}
        </div>
      ))}
    </div>
  )
}
