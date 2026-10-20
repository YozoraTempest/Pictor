import { FlaskConical, Loader2 } from 'lucide-react'
import { useState } from 'react'

import type { AgentTestResult } from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Banner, Button, Textarea } from '../../components/ui/index.js'
import { Section } from './Section.js'

export function AgentTestSection(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null

  const [prompt, setPrompt] = useState('用一个短句介绍你自己')
  const [result, setResult] = useState<AgentTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(): Promise<void> {
    if (prompt.trim().length === 0) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await window.pictor.runAgentTest(prompt, project?.path ?? ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Agent 试运行"
      description="以当前模型配置跑一次最简 Agent 调用，用于验证端到端链路。"
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || prompt.trim().length === 0}
          onClick={() => void run()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FlaskConical className="size-3.5" />
          )}
          运行
        </Button>
      }
    >
      {error !== null && <Banner tone="error">{error}</Banner>}

      <Textarea
        value={prompt}
        aria-label="试运行提示词"
        rows={3}
        onChange={(event) => setPrompt(event.target.value)}
      />

      <p className="text-2xs text-faint">
        工作目录：<span className="font-mono">{project?.path ?? '未选择项目（使用临时目录）'}</span>
      </p>

      {result !== null && (
        <div className="rounded-md border border-border bg-bg px-3 py-2">
          <p className={result.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
            {result.ok ? 'Agent 调用成功' : (result.message ?? '运行失败')}
          </p>
          {result.text.length > 0 && (
            <pre className="selectable mt-1.5 max-h-40 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">
              {result.text}
            </pre>
          )}
          <p className="mt-1.5 font-mono text-2xs text-faint">事件：{result.events.join(', ')}</p>
        </div>
      )}
    </Section>
  )
}
