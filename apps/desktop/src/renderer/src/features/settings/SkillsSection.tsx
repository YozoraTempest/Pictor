import { BookOpen, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SkillEntry } from '@pictor/shared'

import { Badge, Button, Spinner } from '../../components/ui/index.js'
import { useChatStore } from '../chat/chat-store.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/**
 * Where skills are looked for, in the order the runtime scans them.
 *
 * Written out rather than discovered, because the point of showing it is to tell
 * a reader where to put a file: a root that does not exist yet is exactly the
 * one worth naming.
 */
const ROOTS = [
  '<工作目录>/.dsh/skills',
  '<工作目录>/.agents/skills',
  '~/.config/pictor/harness/skills',
  '~/.agents/skills',
]

/**
 * The skills the open conversation can see.
 *
 * A catalog belongs to a conversation, not to the app: the runtime scans the
 * session's working directory and the preset it runs under. That is why this page
 * asks for a session first instead of listing something global — a list assembled
 * any other way would name skills that session cannot actually load.
 */
export function SkillsSection(): React.JSX.Element {
  const sessionId = useChatStore((state) => state.current.sessionId)
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (sessionId.length === 0) {
      setSkills(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    void window.pictor
      .listSkills(sessionId)
      .then((next) => {
        if (!alive) return
        setSkills(next)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setSkills(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [sessionId, attempt])

  const found = skills?.length ?? 0

  return (
    <Section
      title="技能目录"
      description="一段按需加载的说明文档。模型用它自己的 skill 工具加载，你在输入框里打 / 直接调用。"
      actions={
        <>
          {loading ? (
            <Spinner className="size-3.5" />
          ) : (
            <Badge tone="neutral">
              {sessionId.length === 0 ? '无会话' : `${String(found)} 个`}
            </Badge>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="刷新技能列表"
            disabled={sessionId.length === 0 || loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </>
      }
      padded={false}
    >
      {sessionId.length === 0 ? (
        <SettingRow
          title="先打开一个会话"
          description="技能按会话的工作目录解析，没有会话就无从知道该扫哪些目录。"
          control={null}
        />
      ) : error !== null ? (
        <SettingRow title="读取失败" description={error} control={null} />
      ) : skills !== null && skills.length === 0 ? (
        <SettingRow
          title="这个会话没有发现技能"
          description={`把 <名字>/SKILL.md 或 <名字>.md 放进下列任一目录即可：${ROOTS.join('、')}`}
          control={null}
        />
      ) : (
        (skills ?? []).map((skill) => (
          <SettingRow
            key={skill.name}
            title={skill.name}
            description={skill.whenToUse ?? skill.description}
            control={
              <div className="flex items-center gap-2">
                {!skill.modelInvocable && <Badge tone="neutral">仅自己可用</Badge>}
                {skill.path !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.pictor.showInFolder(skill.path ?? '')}
                  >
                    <FolderOpen className="size-3.5" />
                    位置
                  </Button>
                )}
              </div>
            }
          />
        ))
      )}

      {sessionId.length > 0 && (skills ?? []).length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 text-2xs text-faint">
          <BookOpen className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            在输入框里打 <span className="font-mono text-muted">/</span>{' '}
            选择技能，说明会在这一轮里直接注入； 模型自己判断需要时，会调用{' '}
            <span className="font-mono text-muted">skill</span> 工具加载。
          </span>
        </div>
      )}
    </Section>
  )
}
