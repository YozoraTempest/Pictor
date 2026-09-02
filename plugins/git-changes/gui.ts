import { GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { createElement, useCallback, useEffect, useState } from 'react'

import {
  guiSettingsSectionContributions,
  type GuiSettingsSectionContext,
} from '../../src/gui/contract.js'
import { createAgentWorkspaceClient } from '../../src/modules/agent-workspace/shared.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type GuiPluginContext } from '@pictor/plugin-sdk/plugin'
import { createGitChangesClient, type GitChangesClient } from './shared.js'
import { installGitChangesStyles } from './styles.js'

function GitChangesSettings({ client }: { client: GitChangesClient }) {
  const [result, setResult] = useState<{ output: string; message: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setResult(await loadGitStatus(client))
    setLoading(false)
  }, [client])

  useEffect(() => {
    let active = true
    void loadGitStatus(client).then((value) => {
      if (active) {
        setResult(value)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [client])

  return createElement(
    'div',
    { className: 'git-changes-settings', 'data-pictor-plugin': 'pictor.git-changes' },
    createElement(
      'header',
      null,
      createElement('h3', null, 'Git Changes'),
      createElement(
        'button',
        {
          className: 'git-changes-settings__button',
          type: 'button',
          onClick: () => void refresh(),
        },
        loading
          ? createElement(LoaderCircle, { className: 'git-changes-spin', size: 14 })
          : createElement(RefreshCw, { size: 14 }),
        '刷新',
      ),
    ),
    result?.message
      ? createElement('div', { className: 'git-changes-error', role: 'alert' }, result.message)
      : createElement('pre', null, result?.output || '工作树干净'),
  )
}

async function loadGitStatus(client: GitChangesClient) {
  const snapshot = await createAgentWorkspaceClient(window.pictorModules).getSnapshot()
  if (!snapshot.ok) return { output: '', message: snapshot.error.message }
  const project = snapshot.value.projects.find(
    (candidate) => candidate.id === snapshot.value.selectedProjectId,
  )
  return project ? client.getStatus(project.rootPath) : { output: '', message: '当前未选择项目' }
}

export default pluginEntrypoint<GuiPluginContext>(({ pluginId }) => [
  defineModule({
    id: 'pictor.git-changes.gui',
    activate(context) {
      const client = createGitChangesClient(window.pictorModules)
      const releaseStyles = installGitChangesStyles()
      context.onDispose({ dispose: releaseStyles })
      context.contribute(guiSettingsSectionContributions, {
        id: 'pictor.git-changes',
        owner: pluginId,
        label: 'Git',
        icon: GitBranch,
        order: 200,
        render: (_settingsContext: GuiSettingsSectionContext) =>
          createElement(GitChangesSettings, { client }),
      })
    },
  }),
])
