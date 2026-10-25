import { FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SkillEntry, SkillOrigin } from '@pictor/shared'

import { Badge, Button, Spinner, Switch } from '../../components/ui/index.js'
import { useChatStore } from '../chat/chat-store.js'
import { useKernelCapabilities } from '../kernels/capabilities.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/** Where a row came from, in the words a reader would use for it. */
const ORIGIN_LABEL: Record<SkillOrigin, string> = {
  plugin: '插件',
  library: 'Pictor',
  filesystem: '文件',
  project: '项目',
}

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
 *
 * The switch is not one mechanism. Skills Pictor owns are moved out of the
 * scanned root; a skill the user wrote is shadowed by a same-named placeholder;
 * one that belongs to the project is ranked above both and can only be changed
 * in the repository, so its switch is disabled rather than lying.
 */
export function SkillsSection(): React.JSX.Element {
  const sessionId = useChatStore((state) => state.current.sessionId)
  // A kernel that loads skills on its own has no catalog to show. Reading it
  // anyway would list nothing and blame the scan roots for it.
  const canList = useKernelCapabilities(sessionId.length === 0 ? null : sessionId).skills
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (sessionId.length === 0 || !canList) {
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
  }, [sessionId, attempt, canList])

  const found = skills?.length ?? 0
  const enabled = skills?.filter((skill) => skill.enabled).length ?? 0

  async function toggle(skill: SkillEntry, next: boolean): Promise<void> {
    setBusy(skill.name)
    setError(null)
    try {
      setSkills(await window.pictor.setSkillEnabled(sessionId, skill.name, next))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

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
              {sessionId.length === 0
                ? '无会话'
                : canList
                  ? `${String(enabled)} / ${String(found)} 启用`
                  : '内核不支持'}
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
      ) : !canList ? (
        <SettingRow
          title="这个内核不提供技能目录"
          description="它自己决定加载哪些技能，Pictor 看不到那份清单，所以这里没有可列的条目。"
          control={null}
        />
      ) : error !== null && skills === null ? (
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
                <Badge tone="neutral">
                  {skill.origin === 'plugin' && skill.source !== null
                    ? `${ORIGIN_LABEL[skill.origin]} · ${skill.source}`
                    : ORIGIN_LABEL[skill.origin]}
                </Badge>
                {skill.path !== null && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`打开 ${skill.name} 的位置`}
                    onClick={() => void window.pictor.showInFolder(skill.path ?? '')}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                )}
                {busy === skill.name ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Switch
                    label={`切换技能 ${skill.name}`}
                    checked={skill.enabled}
                    disabled={skill.origin === 'project'}
                    onChange={(next) => void toggle(skill, next)}
                  />
                )}
              </div>
            }
          />
        ))
      )}

      {error !== null && skills !== null && (
        <div className="flex items-start gap-2 px-4 py-3 text-2xs text-danger" role="alert">
          {error}
        </div>
      )}
    </Section>
  )
}
