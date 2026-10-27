import { FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SkillEntry, SkillOrigin } from '@vulonlok/shared'

import { Badge, Button, Spinner, Switch } from '../../components/ui/index.js'
import { useChatStore } from '../chat/chat-store.js'
import { useKernelCapabilities, useKernelIdOf } from '../kernels/capabilities.js'
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
 * Where dsh looks for skills, in the order it scans them.
 *
 * Written out rather than discovered, because the point of showing it is to tell a
 * reader where to put a file: a root that does not exist yet is exactly the one worth
 * naming. Another kernel scans wherever it likes, so this list is only used when the
 * conversation's kernel is dsh.
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
  const kernelId = useKernelIdOf(sessionId.length === 0 ? null : sessionId)
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // With no conversation open there is no runtime catalog to ask for — but Pictor's own
  // root and what plugins contributed do not need one. That is the difference between a
  // panel that says "open a conversation first" and a panel that can be read.
  const libraryOnly = sessionId.length === 0

  useEffect(() => {
    // A kernel that loads skills on its own has no catalog to show; with no conversation
    // at all there is no catalog to ask for either — but Pictor's own root does not need
    // one. One effect, two sources, because everything after it is the same list.
    if (!libraryOnly && !canList) {
      setSkills(null)
      setError(null)
      return
    }

    let alive = true
    setLoading(true)
    setError(null)
    const load = libraryOnly
      ? (): Promise<SkillEntry[]> => window.pictor.listLibrarySkills()
      : (): Promise<SkillEntry[]> => window.pictor.listSkills(sessionId)

    void load()
      .then((next) => {
        if (alive) setSkills(next)
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
  }, [sessionId, attempt, canList, libraryOnly])

  const found = skills?.length ?? 0
  const enabled = skills?.filter((skill) => skill.enabled).length ?? 0

  async function toggle(skill: SkillEntry, next: boolean): Promise<void> {
    setBusy(skill.name)
    setError(null)
    try {
      setSkills(
        libraryOnly
          ? await window.pictor.setLibrarySkillEnabled(skill.name, next)
          : await window.pictor.setSkillEnabled(sessionId, skill.name, next),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      // The toolbar says the count; everything else is the list. Two numbers for the
      // same fact (a badge and a line) is one number too many.
      description={
        !libraryOnly && !canList
          ? '这个内核不提供技能目录'
          : libraryOnly
            ? `${String(found)} 个技能 · 没有打开的会话`
            : `${String(found)} 个技能 · ${String(enabled)} 个启用`
      }
      actions={
        <>
          {loading && <Spinner className="size-3.5" />}
          <Button
            size="icon"
            variant="ghost"
            aria-label="刷新技能列表"
            disabled={loading || (!libraryOnly && !canList)}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </>
      }
      padded={false}
    >
      {!libraryOnly && !canList ? (
        <SettingRow
          title="这个内核不提供技能目录"
          description="它自己决定加载哪些技能，Pictor 看不到那份清单，所以这里没有可列的条目。"
          control={null}
        />
      ) : error !== null && skills === null ? (
        <SettingRow title="读取失败" description={error} control={null} />
      ) : skills !== null && skills.length === 0 ? (
        <SettingRow
          title={libraryOnly ? 'Pictor 还没有自己的技能' : '这个会话没有发现技能'}
          description={
            libraryOnly
              ? '装一个带技能的插件就会出现在这里；也可以把 <名字>/SKILL.md 放进应用数据目录下的 harness/skills。'
              : kernelId === null || kernelId === 'dsh'
                ? `把 <名字>/SKILL.md 或 <名字>.md 放进下列任一目录即可：${ROOTS.join('、')}`
                : '这个内核自己决定从哪里扫技能，把文件放进它约定的目录即可。'
          }
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
