import { CheckCircle2, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type {
  AppInfo,
  UpdateChannel,
  UpdateCheckResult,
  UpdaterClient,
  UpdaterSnapshot,
} from '../../src/modules/updater/shared.js'

interface AboutSettingsProps {
  client: UpdaterClient
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法读取应用信息'
}

export function AboutSettings({ client }: AboutSettingsProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot | null>(null)
  const [busy, setBusy] = useState<'channel' | 'check' | 'open' | null>(null)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const appInfo: AppInfo | null = snapshot?.appInfo ?? null
  const channel = snapshot?.channel ?? 'stable'
  const packageLabel =
    result?.packageKind === 'windows-nsis'
      ? 'Windows x64 安装包'
      : result?.packageKind === 'arch-pacman'
        ? 'Arch Linux x64 Pacman 包'
        : result?.packageKind === 'linux-appimage'
          ? 'Linux x64 AppImage'
          : null

  useEffect(() => {
    let active = true
    void client
      .getSnapshot()
      .then((value) => {
        if (active) setSnapshot(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause))
      })
    return () => {
      active = false
    }
  }, [client])

  const handleChannelChange = async (nextChannel: UpdateChannel) => {
    const previousSnapshot = snapshot
    if (!previousSnapshot || nextChannel === previousSnapshot.channel) return
    setBusy('channel')
    setError(null)
    setResult(null)
    setSnapshot({ ...previousSnapshot, channel: nextChannel })
    try {
      setSnapshot(await client.setChannel(nextChannel))
    } catch (cause) {
      setSnapshot(previousSnapshot)
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const handleCheckForUpdates = async () => {
    setBusy('check')
    setError(null)
    setResult(null)
    try {
      const response = await client.checkForUpdates()
      if (response.ok) setResult(response.value)
      else setError(response.error.message)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const handleOpenUpdate = async () => {
    setBusy('open')
    setError(null)
    try {
      const response = await client.openUpdate()
      if (!response.ok) setError(response.error.message)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const buildLabel = appInfo
    ? appInfo.buildChannel === 'nightly'
      ? `Nightly ${appInfo.sourceCommit?.slice(0, 7) ?? ''}`.trim()
      : appInfo.buildChannel === 'stable'
        ? `Stable ${appInfo.sourceCommit?.slice(0, 7) ?? ''}`.trim()
        : 'Development'
    : '读取中'
  const latestCommit = result?.latestCommit?.slice(0, 7) ?? null
  const resultTitle = result
    ? result.channel === 'nightly'
      ? result.updateAvailable
        ? appInfo?.buildChannel === 'nightly'
          ? `发现新的 Nightly ${latestCommit ?? ''}`.trim()
          : `可以切换到 Nightly ${latestCommit ?? ''}`.trim()
        : `当前已是最新 Nightly ${latestCommit ?? ''}`.trim()
      : result.updateAvailable
        ? `发现新版本 v${result.latestVersion}`
        : appInfo?.buildChannel === 'stable'
          ? `当前已是最新稳定版 v${result.currentVersion}`
          : '当前没有更新的稳定版本'
    : null

  return (
    <div className="about-settings" data-pictor-plugin="pictor.updater">
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
          <dt>构建</dt>
          <dd>{buildLabel}</dd>
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
            <p>
              {channel === 'stable'
                ? '从 Pictor 官方 GitHub Release 检查稳定版本。'
                : '从滚动 Nightly Pre-release 检查最新 develop 快照。'}
            </p>
          </div>
          <button
            className="updater-secondary-button"
            type="button"
            onClick={handleCheckForUpdates}
            disabled={!snapshot || busy !== null}
          >
            {busy === 'check' ? (
              <LoaderCircle className="updater-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            {result ? '重新检查' : '检查更新'}
          </button>
        </div>

        <label className="updater-field update-channel-field" htmlFor="update-channel">
          更新通道
          <select
            id="update-channel"
            value={channel}
            disabled={!snapshot || busy !== null}
            onChange={(event) => void handleChannelChange(event.target.value as UpdateChannel)}
          >
            <option value="stable">稳定版（推荐）</option>
            <option value="nightly">Nightly（每日滚动）</option>
          </select>
        </label>

        {channel === 'nightly' ? (
          <div className="update-channel-warning" role="note">
            Nightly 来自最新通过 CI 的 develop 快照，未签名且可能包含不兼容的数据变更。切换前请备份
            Pictor 用户数据。
          </div>
        ) : null}

        {result ? (
          <div
            className={`update-result ${result.updateAvailable ? 'is-available' : ''}`}
            role="status"
          >
            <CheckCircle2 size={16} />
            <div>
              <strong>{resultTitle}</strong>
              {result.updateAvailable ? (
                <span>
                  {result.packageAvailable
                    ? `可以下载官方${packageLabel ?? '发行包'}。`
                    : '该版本未附带匹配的发行包，可前往发布页查看。'}
                </span>
              ) : null}
              {result.channel === 'nightly' && result.publishedAt ? (
                <span>
                  发布于 {new Date(result.publishedAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              ) : null}
            </div>
            {result.updateAvailable ? (
              <button
                className="updater-primary-button"
                type="button"
                onClick={handleOpenUpdate}
                disabled={busy !== null}
              >
                {busy === 'open' ? (
                  <LoaderCircle className="updater-spin" size={15} />
                ) : (
                  <Download size={15} />
                )}
                {result.packageAvailable ? '下载发行包' : '查看发布页'}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="updater-form-error updater-error" role="alert">
            {error}
          </div>
        ) : null}
        <small className="update-privacy">仅在点击“检查更新”后连接 GitHub，不会后台轮询。</small>
      </section>
    </div>
  )
}
