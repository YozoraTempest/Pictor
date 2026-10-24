import {
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelEntry, ProviderList } from '@pictor/shared'

import { cn } from '../../lib/cn.js'
import { capabilitiesOf, emptyModel } from '../settings/models.js'
import { useChatStore } from './chat-store.js'
import { EffortSlider } from './EffortSlider.js'
import { designedEffort, effortLabel, effortTone, effortsOf, pickEffort } from './effort.js'

export interface ModelPickerProps {
  /** Called after the host accepted the switch, so the chat can be reopened. */
  onChanged?: () => void
}

/** Gap between the trigger and the popover, and the least distance to the viewport. */
const OFFSET = 6
const VIEWPORT_MARGIN = 8
const MIN_WIDTH = 300

/** Shortcuts shown in the popover, and how many picks the store keeps. */
const RECENT_SHOWN = 2
const RECENT_STORED = 4
const RECENT_KEY = 'pictor.model.recents'

interface Choice {
  providerId: string
  providerName: string
  model: ModelEntry
}

function modelLabel(model: ModelEntry): string {
  return model.name !== null && model.name.length > 0 ? model.name : model.id
}

/** Every model of every service, in the order the services were listed. */
function choicesOf(list: ProviderList): Choice[] {
  return list.providers.flatMap((provider) => {
    // A service configured by hand may have a model id and no entry for it.
    const models = provider.models.length > 0 ? provider.models : [emptyModel(provider.modelId)]
    return models
      .filter((model) => model.id.length > 0)
      .map((model) => ({
        providerId: provider.id,
        providerName: provider.name.length > 0 ? provider.name : '未命名服务',
        model,
      }))
  })
}

function keyOf(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`
}

/** Recently used picks, newest first; a corrupted entry is simply ignored. */
function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * Active-model switch in the composer's footer.
 *
 * Keys live per service, so several services can be configured at once; this is
 * where a reader picks which one answers. The choice is a (service, model) pair,
 * because two services can offer a model with the same id, and because switching
 * service is exactly what picking one of its models means.
 */
export function ModelPicker({ onChanged }: ModelPickerProps): React.JSX.Element | null {
  const [list, setList] = useState<ProviderList | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /** Which page of the popover is showing; the full list is one level deeper. */
  const [view, setView] = useState<'recent' | 'all'>('recent')
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void window.pictor
      .listProviders()
      .then((next) => {
        if (!alive) return
        setList(next)
        setRecents(readRecents())
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // The settings page can add or drop a service while this popover is closed, so
  // opening it re-reads the list instead of trusting the copy from mount.
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.pictor
      .listProviders()
      .then((next) => {
        if (alive) setList(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open])

  const close = useCallback((): void => {
    setOpen(false)
    setPosition(null)
    // Reopening starts at the shortcuts again, with no search left over from the
    // last visit to the full list.
    setQuery('')
    setView('recent')
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return

    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, MIN_WIDTH)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - VIEWPORT_MARGIN,
    )
    setPosition({ left, bottom: window.innerHeight - rect.top + OFFSET, width })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true) return
      if (popoverRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onViewportChange = (): void => {
      place()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, close, place])

  const choices = useMemo(() => (list === null ? [] : choicesOf(list)), [list])
  const activeId = list?.activeId ?? null
  const activeProvider = list?.providers.find((provider) => provider.id === activeId) ?? null
  const active = activeProvider?.modelId ?? ''
  const activeModel =
    activeProvider?.models.find((model) => model.id === active) ?? emptyModel(active)
  const activeName = activeProvider === null ? '' : modelLabel(activeModel)
  // The level starts wherever the model says: the designed default in that model's
  // own settings is what the user set up, so picking the model is enough to get it.
  // `undefined` in the store means "untouched", and follows the model from then on.
  const chosen = useChatStore((state) => state.effort)
  const setEffort = useChatStore((state) => state.setEffort)
  const levels = effortsOf(activeModel)
  const designed = designedEffort(activeModel)
  const effort = chosen === undefined ? designed : pickEffort(levels, chosen)

  // The store has to agree with what the slider shows, because the send reads the
  // store: an untouched level adopts the model's design, and one the model dropped
  // falls back to it rather than being sent and refused.
  useEffect(() => {
    if (list === null) return
    if (chosen === undefined) setEffort(designed)
    else if (chosen !== null && !levels.includes(chosen)) setEffort(designed)
  }, [list, chosen, designed, levels, setEffort])

  const recentChoices = useMemo(() => {
    const byKey = new Map(
      choices.map((choice) => [keyOf(choice.providerId, choice.model.id), choice]),
    )
    return recents
      .map((key) => byKey.get(key))
      .filter((choice): choice is Choice => choice !== undefined)
      .slice(0, RECENT_SHOWN)
  }, [choices, recents])

  // The full list is the only page with a search box, so it is also the only page
  // that filters: a query typed there must not silently shrink the shortcuts.
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return choices
    return choices.filter(
      (choice) =>
        choice.model.id.toLowerCase().includes(needle) ||
        modelLabel(choice.model).toLowerCase().includes(needle) ||
        choice.providerName.toLowerCase().includes(needle),
    )
  }, [choices, query])

  const groups = useMemo(() => {
    const byProvider = new Map<string, { name: string; items: Choice[] }>()
    for (const choice of matching) {
      const group = byProvider.get(choice.providerId) ?? { name: choice.providerName, items: [] }
      group.items.push(choice)
      byProvider.set(choice.providerId, group)
    }
    return [...byProvider.values()]
  }, [matching])

  // Nothing configured means nothing to choose: stay out of the way.
  if (list === null || choices.length === 0) return null

  async function choose(choice: Choice): Promise<void> {
    close()
    setError(null)
    try {
      await window.pictor.useModel(choice.providerId, choice.model.id)
      // A switch adopts the new model's own designed level, so the badge and the
      // next request describe the same behaviour straight away.
      setEffort(undefined)
      setList(await window.pictor.listProviders())
      const next = [keyOf(choice.providerId, choice.model.id), ...recents]
        .filter((key, index, all) => all.indexOf(key) === index)
        .slice(0, RECENT_STORED)
      setRecents(next)
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // A profile that refuses storage only loses the shortcut.
      }
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setOpen(true)
    }
  }

  function renderRow(choice: Choice): React.JSX.Element {
    const capabilities = capabilitiesOf(choice.model)
    const current = choice.providerId === activeId && choice.model.id === active
    return (
      <button
        key={keyOf(choice.providerId, choice.model.id)}
        type="button"
        onClick={() => void choose(choice)}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{modelLabel(choice.model)}</span>
          <span className="block truncate text-2xs text-faint">{choice.model.id}</span>
        </span>
        {capabilities.image && (
          <ImageIcon className="size-3 shrink-0 text-faint" aria-label="支持图片" />
        )}
        {capabilities.reasoning && (
          <Sparkles className="size-3 shrink-0 text-faint" aria-label="支持推理" />
        )}
        <span className="max-w-24 shrink-0 truncate text-2xs text-faint">
          {choice.providerName}
        </span>
        {current && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="选择模型"
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      >
        <Cpu className="size-3 shrink-0 text-faint" aria-hidden />
        <span className="truncate">
          {activeProvider === null || active.length === 0 ? '未选择模型' : activeName}
        </span>
        {levels.length > 0 && (
          <span
            className={cn('shrink-0 font-medium', effortTone(effort))}
            aria-label={`推理强度 ${effortLabel(effort)}`}
          >
            {effortLabel(effort)}
          </span>
        )}
        <ChevronDown
          className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="选择模型"
            style={{
              left: position?.left ?? 0,
              bottom: position?.bottom ?? 0,
              width: position?.width ?? MIN_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className="fixed z-50 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised p-1 shadow-popover"
          >
            {view === 'all' ? (
              // The full list is a page of its own: search only means something
              // here, and the shortcuts above stay one click away.
              <div key="all" data-page="all" className="picker-page flex min-h-0 flex-1 flex-col">
                <div className="mx-1 mb-1 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="返回最近使用"
                    onClick={() => {
                      setView('recent')
                      setQuery('')
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  >
                    <ChevronLeft className="size-3.5" aria-hidden />
                  </button>
                  <input
                    autoFocus
                    value={query}
                    aria-label="搜索模型"
                    placeholder="搜索模型"
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-text placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {groups.map((group) => (
                    <div key={group.name}>
                      <p className="px-2 pt-1 pb-0.5 text-2xs text-faint">{group.name}</p>
                      {group.items.map(renderRow)}
                    </div>
                  ))}

                  {matching.length === 0 && (
                    <p className="px-2 py-3 text-xs text-faint">没有匹配的模型</p>
                  )}
                </div>
              </div>
            ) : (
              <div
                key="recent"
                data-page="recent"
                className="picker-page flex min-h-0 flex-1 flex-col"
              >
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {recentChoices.length > 0 ? (
                    <>
                      <p className="px-2 pt-1 pb-0.5 text-2xs text-faint">最近使用</p>
                      {recentChoices.map(renderRow)}
                    </>
                  ) : (
                    <p className="px-2 py-3 text-xs text-faint">还没有用过的模型</p>
                  )}

                  <button
                    type="button"
                    aria-label="所有模型"
                    onClick={() => setView('all')}
                    className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  >
                    <Boxes className="size-3 shrink-0 text-faint" aria-hidden />
                    <span className="flex-1">所有模型</span>
                    <span className="shrink-0 text-2xs text-faint">{choices.length}</span>
                    <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden />
                  </button>
                </div>
              </div>
            )}

            {/* The level belongs beside the list rather than in the composer row:
                it only means something for the model picked here, and one slider
                beats a row per level. It stays put across both pages. */}
            {levels.length > 0 && (
              <div className="mt-1 shrink-0 border-t border-border px-2 pt-2 pb-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs text-faint">推理强度</span>
                  <span className={cn('text-2xs font-medium', effortTone(effort))}>
                    {effortLabel(effort)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <EffortSlider levels={levels} value={effort} onChange={setEffort} />
                </div>
                <div className="mt-0.5 flex justify-between text-2xs text-faint">
                  <span>{effortLabel(null)}</span>
                  <span>{effortLabel(levels[levels.length - 1] ?? null)}</span>
                </div>
              </div>
            )}

            {error !== null && (
              <p className="px-2 py-1 text-2xs text-danger" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
