import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileCode2,
  FolderPlus,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { CommandFailure, executeCommandAndWait } from '../commands/index.js'
import type { CommandClient, CommandDescriptor } from '../commands/index.js'
import { appInfoSchema, type AppInfo } from '../shared/app-info.js'
import type { GuiPluginPicker, GuiPluginSource } from '../shared/desktop-bridge.js'
import { appDoctorResultSchema, type AppDoctorResult } from '../shared/app-doctor.js'
import { pluginManagerSnapshotSchema, type PluginManagerSnapshot } from '../shared/plugins.js'
import type { output, ZodType } from 'zod'
import type { GuiPluginStatus } from './contract.js'
import { sanitizeGuiDiagnostic, safePluginSource } from './diagnostics.js'

export const GUI_RECOVERY_COMMAND_IDS = [
  'app.info',
  'app.doctor',
  'plugin.list',
  'plugin.install',
  'plugin.enable',
  'plugin.disable',
  'plugin.remove',
  'plugin.restore',
] as const

const recoveryCommandIds = new Set<string>(GUI_RECOVERY_COMMAND_IDS)

const stateLabels = {
  active: '运行中',
  disabled: '已禁用',
  blocked: '已阻塞',
  failed: '启动失败',
  'pending-restart': '等待重启',
} as const

export interface GuiWorkbenchReference {
  readonly id: string
  readonly pluginId: string
}

export type PictorShellState =
  | { readonly kind: 'safe-mode' }
  | { readonly kind: 'no-workbench' }
  | {
      readonly kind: 'workbench-conflict'
      readonly workbenches: readonly GuiWorkbenchReference[]
    }
  | {
      readonly kind: 'plugin-failure'
      readonly failures: readonly GuiPluginStatus[]
    }
  | {
      readonly kind: 'workbench-render-failure'
      readonly workbench: GuiWorkbenchReference
      readonly reason: string
    }

export interface PictorShellProps {
  readonly commandClient: CommandClient
  readonly pluginPicker: GuiPluginPicker
  readonly guiPluginStatuses: readonly GuiPluginStatus[]
  readonly safeMode: boolean
  readonly state: PictorShellState
}

type ShellCommandResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export function filterGuiRecoveryCommands(
  descriptors: readonly CommandDescriptor[],
): readonly CommandDescriptor[] {
  return descriptors.filter(
    ({ id, execution }) => recoveryCommandIds.has(id) && execution.recoverySafe,
  )
}

export async function executeShellCommand<TSchema extends ZodType>(
  client: CommandClient,
  commandId: string,
  input: unknown,
  outputSchema: TSchema,
): Promise<ShellCommandResult<output<TSchema>>> {
  if (!recoveryCommandIds.has(commandId)) {
    return { ok: false, error: '该命令不在 Pictor Shell 恢复白名单中' }
  }
  try {
    const value = await executeCommandAndWait(
      client,
      commandId,
      input,
      { frontend: 'shell' },
      outputSchema,
    )
    return { ok: true, value }
  } catch (error) {
    if (error instanceof CommandFailure) {
      return { ok: false, error: sanitizeGuiDiagnostic(error.error.message) }
    }
    return { ok: false, error: '命令执行失败' }
  }
}

export function PictorShell({
  commandClient,
  pluginPicker,
  guiPluginStatuses,
  safeMode,
  state,
}: PictorShellProps): React.JSX.Element {
  const [descriptors, setDescriptors] = useState<readonly CommandDescriptor[]>([])
  const [snapshot, setSnapshot] = useState<PluginManagerSnapshot | null>(null)
  const [doctor, setDoctor] = useState<AppDoctorResult | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const availableCommandIds = useMemo(() => new Set(descriptors.map(({ id }) => id)), [descriptors])

  useEffect(() => {
    let active = true
    const loadDescriptors = async (): Promise<void> => {
      try {
        const listed = await commandClient.list({ recoverySafe: true })
        if (active) setDescriptors(filterGuiRecoveryCommands(listed))
      } catch (caught) {
        if (active) setError(commandErrorMessage(caught))
      }
    }
    const loadSnapshot = async (): Promise<void> => {
      const result = await executeShellCommand(
        commandClient,
        'plugin.list',
        null,
        pluginManagerSnapshotSchema,
      )
      if (!active) return
      if (result.ok) setSnapshot(result.value)
      else setError(result.error)
    }
    void Promise.all([loadDescriptors(), loadSnapshot()]).finally(() => {
      if (active) setBusy(null)
    })
    return () => {
      active = false
    }
  }, [commandClient])

  const runSnapshotCommand = async (
    commandId: string,
    input: unknown,
    busyKey: string,
  ): Promise<void> => {
    setBusy(busyKey)
    setError(null)
    setNotice(null)
    const result = await executeShellCommand(
      commandClient,
      commandId,
      input,
      pluginManagerSnapshotSchema,
    )
    setBusy(null)
    if (result.ok) {
      setSnapshot(result.value)
      setNotice(commandId === 'plugin.list' ? null : snapshotNotice('操作', result.value))
    } else setError(result.error)
  }

  const runDoctor = async (): Promise<void> => {
    setBusy('app.doctor')
    setError(null)
    const result = await executeShellCommand(
      commandClient,
      'app.doctor',
      null,
      appDoctorResultSchema,
    )
    setBusy(null)
    if (result.ok) setDoctor(result.value)
    else setError(result.error)
  }

  const readAppInfo = async (): Promise<void> => {
    setBusy('app.info')
    setError(null)
    const result = await executeShellCommand(commandClient, 'app.info', null, appInfoSchema)
    setBusy(null)
    if (result.ok) setAppInfo(result.value)
    else setError(result.error)
  }

  const installPlugin = async (source: Extract<GuiPluginSource, 'local' | 'development'>) => {
    setBusy(`plugin.install:${source}`)
    setError(null)
    setNotice(null)
    const selection = await pluginPicker.pickPlugin(source)
    if (!selection.ok) {
      setBusy(null)
      setError(sanitizeGuiDiagnostic(selection.error.message))
      return
    }
    if (!selection.value.path) {
      setBusy(null)
      return
    }
    if (selection.value.source !== source) {
      setBusy(null)
      setError('Plugin 选择器返回了不匹配的来源')
      return
    }
    const result = await executeShellCommand(
      commandClient,
      'plugin.install',
      { source: selection.value.source, path: selection.value.path },
      pluginManagerSnapshotSchema,
    )
    setBusy(null)
    if (result.ok) {
      setSnapshot(result.value)
      setNotice(snapshotNotice('Plugin 安装意图', result.value))
    } else setError(result.error)
  }

  const failureStatuses = guiPluginStatuses.filter((status) => status.effectiveState === 'failed')
  const priorityPluginIds = useMemo(() => relatedPluginIds(state), [state])
  const orderedItems = useMemo(() => {
    if (!snapshot) return []
    return [...snapshot.items].sort((left, right) => {
      const leftPriority = priorityPluginIds.has(left.id) ? 0 : 1
      const rightPriority = priorityPluginIds.has(right.id) ? 0 : 1
      return leftPriority - rightPriority || compareText(left.id, right.id)
    })
  }, [priorityPluginIds, snapshot])

  return (
    <main className="pictor-shell">
      <header className="pictor-shell__header">
        <div className="pictor-shell__brand-mark" aria-hidden="true">
          P
        </div>
        <div>
          <strong>Pictor</strong>
          <span>宿主恢复 Shell</span>
        </div>
        <span className="pictor-shell__mode">Pictor Shell</span>
      </header>

      <section className="pictor-shell__content">
        <section className="pictor-shell__state" aria-labelledby="pictor-shell-title">
          <div className="pictor-shell__state-icon" aria-hidden="true">
            {state.kind === 'safe-mode' ? (
              <ShieldAlert size={26} />
            ) : state.kind === 'workbench-conflict' || state.kind === 'plugin-failure' ? (
              <AlertTriangle size={26} />
            ) : (
              <CircleHelp size={26} />
            )}
          </div>
          <div>
            <h1 id="pictor-shell-title">Pictor Shell</h1>
            <p>{stateDescription(state)}</p>
          </div>
        </section>

        {state.kind === 'workbench-conflict' ? (
          <div className="pictor-shell__diagnostic" role="alert">
            <strong>Workbench 冲突</strong>
            <ul>
              {state.workbenches.map((workbench) => (
                <li key={`${workbench.id}:${workbench.pluginId}`}>
                  <code>{workbench.id}</code>
                  <span>由 Plugin </span>
                  <code>{workbench.pluginId}</code>
                </li>
              ))}
            </ul>
            <span>请先禁用冲突 Plugin；Shell 不会任意选择 Workbench。</span>
          </div>
        ) : null}

        {state.kind === 'plugin-failure' ? (
          <div className="pictor-shell__diagnostic" role="alert">
            <strong>GUI Plugin 加载失败</strong>
            <ul>
              {state.failures.map((failure) => (
                <li key={`${failure.id}:${failure.version}`}>
                  <code>{failure.id}</code>
                  <span>{sanitizeGuiDiagnostic(failure.reason, 'Plugin 未能加载')}</span>
                </li>
              ))}
            </ul>
            <span>可以在下方优先处理相关 Plugin，其他恢复命令仍然可用。</span>
          </div>
        ) : null}

        {state.kind === 'workbench-render-failure' ? (
          <div className="pictor-shell__diagnostic" role="alert">
            <strong>Workbench 加载失败</strong>
            <p>
              <code>{state.workbench.id}</code>（Plugin <code>{state.workbench.pluginId}</code>）
            </p>
            <span>{sanitizeGuiDiagnostic(state.reason, 'Workbench 渲染失败')}</span>
          </div>
        ) : null}

        {safeMode ? (
          <div className="pictor-shell__notice" role="status">
            <ShieldAlert size={16} /> 安全模式已忽略全部 Plugin；GUI Plugin
            不会加载，恢复操作会在重启后生效。
          </div>
        ) : null}

        {error ? (
          <div className="pictor-shell__error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="pictor-shell__notice" role="status">
            <CheckCircle2 size={16} /> {notice}
          </div>
        ) : null}

        <section className="pictor-shell__panel" aria-labelledby="recovery-commands-title">
          <header className="pictor-shell__panel-header">
            <div>
              <h2 id="recovery-commands-title">恢复命令</h2>
              <span>仅显示 Core recovery allowlist</span>
            </div>
            <div className="pictor-shell__toolbar-actions">
              {availableCommandIds.has('app.info') ? (
                <button
                  className="pictor-shell__secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void readAppInfo()}
                >
                  <Info size={14} /> 应用信息
                </button>
              ) : null}
              {availableCommandIds.has('app.doctor') ? (
                <button
                  className="pictor-shell__secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void runDoctor()}
                >
                  {busy === 'app.doctor' ? (
                    <LoaderCircle className="pictor-shell__spin" size={14} />
                  ) : (
                    <Wrench size={14} />
                  )}{' '}
                  应用诊断
                </button>
              ) : null}
              {availableCommandIds.has('plugin.list') ? (
                <button
                  className="pictor-shell__secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void runSnapshotCommand('plugin.list', null, 'plugin.list')}
                >
                  {busy === 'plugin.list' ? (
                    <LoaderCircle className="pictor-shell__spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}{' '}
                  刷新 Plugin 列表
                </button>
              ) : null}
            </div>
          </header>
          <div className="pictor-shell__command-list">
            {busy === 'load' && descriptors.length === 0 ? (
              <div className="pictor-shell__loading" role="status">
                <LoaderCircle className="pictor-shell__spin" size={17} />
                <span>正在读取 recovery-safe 命令</span>
              </div>
            ) : descriptors.length === 0 ? (
              <div className="pictor-shell__empty">没有可用的 recovery-safe Core command</div>
            ) : (
              descriptors.map((descriptor) => (
                <div className="pictor-shell__command" key={descriptor.id}>
                  <code>{descriptor.id}</code>
                  <span>
                    <strong>{descriptor.title}</strong>
                    <small>{descriptor.description}</small>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="pictor-shell__panel" aria-labelledby="plugin-recovery-title">
          <header className="pictor-shell__panel-header">
            <div>
              <h2 id="plugin-recovery-title">Plugin 恢复</h2>
              <span>通过 Command Engine 记录变更，重启后加载</span>
            </div>
            <div className="pictor-shell__toolbar-actions">
              {availableCommandIds.has('plugin.install') ? (
                <>
                  <button
                    className="pictor-shell__secondary-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void installPlugin('local')}
                  >
                    {busy === 'plugin.install:local' ? (
                      <LoaderCircle className="pictor-shell__spin" size={14} />
                    ) : (
                      <FolderPlus size={14} />
                    )}{' '}
                    安装本地 GUI Plugin
                  </button>
                  <button
                    className="pictor-shell__secondary-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void installPlugin('development')}
                  >
                    {busy === 'plugin.install:development' ? (
                      <LoaderCircle className="pictor-shell__spin" size={14} />
                    ) : (
                      <FileCode2 size={14} />
                    )}{' '}
                    安装 Development GUI Plugin
                  </button>
                </>
              ) : null}
            </div>
          </header>

          {snapshot ? (
            <>
              <div className="pictor-shell__snapshot" aria-label="Plugin snapshot">
                <SnapshotValue
                  label="restartRequired"
                  value={snapshot.restartRequired ? 'true' : 'false'}
                />
                <SnapshotValue label="safeMode" value={snapshot.safeMode ? 'true' : 'false'} />
                <SnapshotValue label="items" value={String(snapshot.items.length)} />
              </div>
              <div className="pictor-shell__plugin-list">
                {orderedItems.length === 0 ? (
                  <div className="pictor-shell__empty">没有可恢复的已登记 Plugin</div>
                ) : (
                  orderedItems.map((item) => {
                    const guiStatus = guiPluginStatuses.find((status) => status.id === item.id)
                    const effectiveState =
                      item.effectiveState === 'pending-restart'
                        ? item.effectiveState
                        : (guiStatus?.effectiveState ?? item.effectiveState)
                    const reason = guiStatus?.reason ?? item.reason
                    const canManage = item.kind === 'pictor-plugin'
                    return (
                      <div
                        className={`pictor-shell__plugin-row ${priorityPluginIds.has(item.id) ? 'is-priority' : ''}`}
                        key={`${item.kind}:${item.id}`}
                      >
                        <div className="pictor-shell__plugin-identity">
                          <strong>{item.name}</strong>
                          <code>{item.id}</code>
                          <small>{safePluginSource(item.source)}</small>
                        </div>
                        <div className="pictor-shell__plugin-state">
                          <span
                            className={`pictor-shell__state-badge pictor-shell__state-badge--${effectiveState}`}
                          >
                            {stateLabels[effectiveState]}
                          </span>
                          <code>effectiveState: {effectiveState}</code>
                          <small>reason: {sanitizeGuiDiagnostic(reason, '无')}</small>
                        </div>
                        {canManage &&
                        availableCommandIds.has('plugin.restore') &&
                        item.canRestore ? (
                          <button
                            className="pictor-shell__secondary-button"
                            type="button"
                            disabled={busy !== null}
                            aria-label="恢复"
                            onClick={() =>
                              void runSnapshotCommand(
                                'plugin.restore',
                                { id: item.id },
                                `restore:${item.id}`,
                              )
                            }
                          >
                            <RotateCcw size={14} /> 恢复
                          </button>
                        ) : canManage && item.desiredState !== 'removed' ? (
                          <div className="pictor-shell__plugin-actions">
                            {availableCommandIds.has('plugin.enable') &&
                            availableCommandIds.has('plugin.disable') ? (
                              <button
                                className="pictor-shell__secondary-button"
                                type="button"
                                disabled={busy !== null}
                                aria-label={`${item.desiredState === 'enabled' ? '禁用' : '启用'} ${item.id}`}
                                onClick={() =>
                                  void runSnapshotCommand(
                                    item.desiredState === 'enabled'
                                      ? 'plugin.disable'
                                      : 'plugin.enable',
                                    { kind: 'pictor-plugin', id: item.id },
                                    `toggle:${item.id}`,
                                  )
                                }
                              >
                                {item.desiredState === 'enabled' ? '禁用' : '启用'}
                              </button>
                            ) : null}
                            {availableCommandIds.has('plugin.remove') ? (
                              <button
                                className="pictor-shell__icon-button pictor-shell__danger-icon-button"
                                type="button"
                                disabled={busy !== null}
                                aria-label={`移除 ${item.id}`}
                                title={`移除 ${item.id}（保留数据）`}
                                onClick={() =>
                                  void runSnapshotCommand(
                                    'plugin.remove',
                                    {
                                      kind: 'pictor-plugin',
                                      id: item.id,
                                      deleteData: false,
                                    },
                                    `remove:${item.id}`,
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div className="pictor-shell__loading" role="status">
              {busy === 'load' ? <LoaderCircle className="pictor-shell__spin" size={17} /> : null}
              <span>正在读取 Plugin 状态</span>
            </div>
          )}
        </section>

        {snapshot?.issues.length ? (
          <section className="pictor-shell__errors" aria-labelledby="pictor-shell-errors-title">
            <h2 id="pictor-shell-errors-title">errors</h2>
            {snapshot.issues.map((issue) => (
              <div className="pictor-shell__error" role="alert" key={issue}>
                {sanitizeGuiDiagnostic(issue, 'Plugin 状态存在诊断项')}
              </div>
            ))}
          </section>
        ) : null}

        {doctor ? <DoctorResult result={doctor} /> : null}
        {appInfo ? <AppInfoResult value={appInfo} /> : null}
        {failureStatuses.length > 0 && state.kind !== 'plugin-failure' ? (
          <section className="pictor-shell__errors" aria-labelledby="gui-failures-title">
            <h2 id="gui-failures-title">GUI Plugin errors</h2>
            {failureStatuses.map((status) => (
              <div className="pictor-shell__error" role="alert" key={status.id}>
                <code>{status.id}</code>：{sanitizeGuiDiagnostic(status.reason, 'Plugin 未能加载')}
              </div>
            ))}
          </section>
        ) : null}
      </section>
    </main>
  )
}

function SnapshotValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span>
      <code>{label}</code>
      <strong>{value}</strong>
    </span>
  )
}

function DoctorResult({ result }: { result: AppDoctorResult }): React.JSX.Element {
  return (
    <section className="pictor-shell__result" aria-labelledby="doctor-result-title">
      <h2 id="doctor-result-title">app.doctor</h2>
      <strong>{result.status}</strong>
      <ul>
        {result.checks.map((check) => (
          <li key={check.id}>
            <span>{check.id}</span>
            <span>{check.status}</span>
            <span>{sanitizeGuiDiagnostic(check.message)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AppInfoResult({ value }: { value: AppInfo }): React.JSX.Element {
  return (
    <section className="pictor-shell__result" aria-labelledby="app-info-result-title">
      <h2 id="app-info-result-title">app.info</h2>
      <span>
        {value.name} {value.version}
      </span>
      <small>
        {value.platform} / {value.arch} / {value.distribution}
      </small>
    </section>
  )
}

function stateDescription(state: PictorShellState): string {
  switch (state.kind) {
    case 'safe-mode':
      return '安全模式已启用，GUI Plugin 被忽略。'
    case 'no-workbench':
      return '当前没有可用 Workbench，仍可诊断和恢复 GUI Plugin。'
    case 'workbench-conflict':
      return '发现多个 Workbench Contribution，宿主拒绝任意选择。'
    case 'plugin-failure':
      return 'GUI Plugin 加载失败，宿主已隔离失败并保留恢复入口。'
    case 'workbench-render-failure':
      return 'Workbench 渲染失败，宿主已隔离该界面并回到 Shell。'
  }
}

function relatedPluginIds(state: PictorShellState): Set<string> {
  if (state.kind === 'workbench-conflict') {
    return new Set(state.workbenches.map(({ pluginId }) => pluginId))
  }
  if (state.kind === 'plugin-failure') return new Set(state.failures.map(({ id }) => id))
  if (state.kind === 'workbench-render-failure') return new Set([state.workbench.pluginId])
  return new Set()
}

function commandErrorMessage(error: unknown): string {
  if (error instanceof CommandFailure) return sanitizeGuiDiagnostic(error.error.message)
  return '无法读取恢复命令'
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function snapshotNotice(label: string, snapshot: PluginManagerSnapshot): string {
  return snapshot.restartRequired
    ? `${label}已记录；重启 Pictor 后生效。`
    : `${label}已完成，无需重启。`
}
