import {
  tuiApplicationContributions,
  type TuiApplicationContext,
  type TuiApplicationContribution,
} from '../../src/tui/contract.js'
import type { IpcResult } from '../../src/shared/errors.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type TuiPluginContext } from '@pictor/plugin-sdk/plugin'

const delegateContribution: TuiApplicationContribution = {
  owner: 'pictor.tui.delegate',
  id: 'delegate',
  run: runDelegateTui,
}

export default pluginEntrypoint<TuiPluginContext>(({ pluginId }) => [
  defineModule({
    id: `${pluginId}.tui`,
    activate(context) {
      context.contribute(tuiApplicationContributions, delegateContribution)
    },
  }),
])

async function runDelegateTui(context: TuiApplicationContext): Promise<void> {
  const target = await resolveTarget(context)
  if (!target) {
    context.terminal.write(
      'Pictor TUI 首次使用：请使用 --project <path> 指定一个已存在且受信任的项目目录；不会自动创建或猜测项目路径。\n',
    )
    return
  }

  const selected = await context.workspace.selectContext({
    projectId: target.projectId,
    sessionId: target.sessionId,
  })
  unwrap(selected, '选择 TUI Session')

  const snapshot = unwrap(await context.workspace.getSnapshot(), '读取 TUI Workspace')
  const session = snapshot.sessions.find(({ id }) => id === target.sessionId)
  const project = snapshot.projects.find(({ id }) => id === target.projectId)
  if (!session || !project) throw new Error('TUI 定位的 Project/Session 在选择后不可用')

  if (context.launchTarget.nonInteractive) {
    context.terminal.write(
      `Pictor TUI 已就绪：${project.name} / ${session.title}（Session ${session.id}）\n`,
    )
    return
  }

  const settings = unwrap(await context.workspace.getSettings(), '读取模型设置')
  if (!settings?.hasApiKey) {
    context.terminal.write(
      'Pictor TUI 无法开始委托：请先在 GUI 或 CLI 保存模型设置和凭据；TUI 不会绕过凭据约束。\n',
    )
    return
  }

  if (context.signal.aborted) return
  const runner = context.interactive.createInteractiveRunner({
    tuiMode: context.launchTarget.tuiMode,
  })
  await runner.run()
}

interface ResolvedTarget {
  readonly projectId: string
  readonly sessionId: string
}

async function resolveTarget(context: TuiApplicationContext): Promise<ResolvedTarget | null> {
  const snapshot = unwrap(await context.workspace.getSnapshot(), '读取 TUI Workspace')
  let projectId = snapshot.selectedProjectId

  if (context.launchTarget.projectPath) {
    const candidate = unwrap(
      await context.workspace.inspectProjectPath({ rootPath: context.launchTarget.projectPath }),
      '检查 TUI Project 路径',
    )
    if (candidate.existingProjectId) projectId = candidate.existingProjectId
    else {
      const project = unwrap(
        await context.workspace.registerProject({
          rootPath: candidate.rootPath,
          trusted: true,
        }),
        '注册 TUI Project',
      )
      projectId = project.id
    }
  }

  if (context.launchTarget.sessionId) {
    const session = snapshot.sessions.find(({ id }) => id === context.launchTarget.sessionId)
    if (!session) throw new Error(`找不到 TUI Session：${context.launchTarget.sessionId}`)
    if (projectId && session.projectId !== projectId) {
      throw new Error('TUI Project 与 Session 不匹配')
    }
    projectId = session.projectId
  }

  if (!projectId) return null
  const sessions = snapshot.sessions.filter(({ projectId: id }) => id === projectId)
  const sessionId =
    context.launchTarget.sessionId ??
    (snapshot.selectedProjectId === projectId && snapshot.selectedSessionId
      ? snapshot.selectedSessionId
      : (sessions[0]?.id ?? null))
  if (sessionId) return { projectId, sessionId }

  const created = unwrap(
    await context.workspace.createSession({ projectId }),
    '创建首次 TUI Session',
  )
  return { projectId, sessionId: created.id }
}

function unwrap<T>(result: IpcResult<T>, operation: string): T {
  if (!result.ok) throw new Error(`${operation}失败：${result.error.message}`)
  return result.value
}
