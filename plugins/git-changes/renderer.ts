import { GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { createElement, useCallback, useEffect, useState } from 'react'

import { defineModule } from '../../src/kernel/module.js'
import { settingsSectionContributions } from '../../src/modules/shell/settings.js'
import { pluginEntrypoint, type RendererPluginContext } from '../../src/plugin/entry.js'
import { createGitChangesClient, type GitChangesClient } from './shared.js'

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
    { className: 'git-changes-settings' },
    createElement(
      'header',
      null,
      createElement('h3', null, 'Git Changes'),
      createElement(
        'button',
        { className: 'secondary-button', type: 'button', onClick: () => void refresh() },
        loading
          ? createElement(LoaderCircle, { className: 'spin', size: 14 })
          : createElement(RefreshCw, { size: 14 }),
        '刷新',
      ),
    ),
    result?.message
      ? createElement('div', { className: 'form-error', role: 'alert' }, result.message)
      : createElement('pre', null, result?.output || '工作树干净'),
  )
}

async function loadGitStatus(client: GitChangesClient) {
  const snapshot = await window.pictor.getSnapshot()
  if (!snapshot.ok) return { output: '', message: snapshot.error.message }
  const project = snapshot.value.projects.find(
    (candidate) => candidate.id === snapshot.value.selectedProjectId,
  )
  return project ? client.getStatus(project.rootPath) : { output: '', message: '当前未选择项目' }
}

export default pluginEntrypoint<RendererPluginContext>(() => [
  defineModule({
    id: 'pictor.git-changes.renderer',
    activate(context) {
      const client = createGitChangesClient(window.pictorModules)
      context.contribute(settingsSectionContributions, {
        id: 'pictor.git-changes',
        label: 'Git',
        icon: GitBranch,
        render: () => createElement(GitChangesSettings, { client }),
      })
    },
  }),
])
