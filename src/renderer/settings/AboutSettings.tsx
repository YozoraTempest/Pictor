import { CheckCircle2, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import type { AppInfo, UpdateCheckResult } from '../../shared/desktop-bridge'

interface AboutSettingsProps {
  appInfo: AppInfo | null
}

export function AboutSettings({ appInfo }: AboutSettingsProps): React.JSX.Element {
  const [busy, setBusy] = useState<'check' | 'open' | null>(null)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const packageLabel =
    result?.packageKind === 'windows-nsis'
      ? 'Windows x64 安装包'
      : result?.packageKind === 'ubuntu-deb'
        ? 'Ubuntu x64 DEB 包'
        : result?.packageKind === 'arch-pacman'
          ? 'Arch Linux x64 Pacman 包'
          : null

  const handleCheckForUpdates = async () => {
    setBusy('check')
    setError(null)
    setResult(null)
    const response = await window.pictor.checkForUpdates()
    setBusy(null)
    if (response.ok) setResult(response.value)
    else setError(response.error.message)
  }

  const handleOpenUpdate = async () => {
    setBusy('open')
    setError(null)
    const response = await window.pictor.openUpdate()
    setBusy(null)
    if (!response.ok) setError(response.error.message)
  }

  return (
    <div className="about-settings">
      <header className="about-product">
        <h3>Pictor</h3>
        <p>面向 Agent 委托工作流的桌面开发环境</p>
      </header>

      <dl className="about-details">
        <div>
          <dt>版本</dt>
          <dd>{appInfo ? `v${appInfo.version}` : '读取中'}</dd>
        </div>
        <div>
          <dt>平台</dt>
          <dd>
            {appInfo
              ? `${appInfo.platform === 'linux' ? 'Linux' : 'Windows'} ${appInfo.arch}`
              : '加载中'}
          </dd>
        </div>
        <div>
          <dt>许可证</dt>
          <dd>MIT</dd>
        </div>
        <div>
          <dt>作者</dt>
          <dd>YozoraTempest</dd>
        </div>
        <div>
          <dt>项目</dt>
          <dd>github.com/YozoraTempest/Pictor</dd>
        </div>
      </dl>

      <section className="update-settings" aria-labelledby="update-heading">
        <div className="update-settings__heading">
          <div>
            <h3 id="update-heading">应用更新</h3>
            <p>从 Pictor 官方 GitHub Release 检查稳定版本。</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={handleCheckForUpdates}
            disabled={busy !== null}
          >
            {busy === 'check' ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            {result ? '重新检查' : '检查更新'}
          </button>
        </div>

        {result ? (
          <div
            className={`update-result ${result.updateAvailable ? 'is-available' : ''}`}
            role="status"
          >
            <CheckCircle2 size={16} />
            <div>
              <strong>
                {result.updateAvailable
                  ? `发现新版本 v${result.latestVersion}`
                  : `当前已是最新版本 v${result.currentVersion}`}
              </strong>
              {result.updateAvailable ? (
                <span>
                  {result.packageAvailable
                    ? `可以下载官方${packageLabel ?? '发行包'}。`
                    : '该版本未附带匹配的安装包，可前往发布页查看。'}
                </span>
              ) : null}
            </div>
            {result.updateAvailable ? (
              <button
                className="primary-button"
                type="button"
                onClick={handleOpenUpdate}
                disabled={busy !== null}
              >
                {busy === 'open' ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Download size={15} />
                )}
                {result.packageAvailable ? '下载发行包' : '查看发布页'}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="form-error update-error" role="alert">
            {error}
          </div>
        ) : null}
        <small className="update-privacy">仅在点击“检查更新”后连接 GitHub，不会后台轮询。</small>
      </section>
    </div>
  )
}
