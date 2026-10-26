import {
  Boxes,
  ChevronRight,
  Info,
  Search,
  Settings2,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { SettingHighlight } from './highlight.js'
import {
  SETTING_ROWS,
  SETTINGS_PAGES,
  settingsTree,
  type SettingsPage,
  type SettingsPageId,
} from './pages.js'

interface SearchHit {
  page: SettingsPageId
  /** Set when the hit is one row rather than a whole page. */
  row: string | null
  title: string
  description: string
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

/**
 * Search runs over rows, not pages: "密钥" should land on the API Key field, not
 * on the page that happens to contain it. Pages are searched too, so a query
 * that names a page still works.
 */
function search(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []

  const rows: SearchHit[] = SETTING_ROWS.filter(
    (row) =>
      matches(row.title, needle) ||
      matches(row.description, needle) ||
      matches(row.keywords, needle),
  ).map((row) => ({ page: row.page, row: row.id, title: row.title, description: row.description }))

  const pages: SearchHit[] = SETTINGS_PAGES.filter(
    (page) =>
      matches(page.label, needle) ||
      matches(page.description, needle) ||
      matches(page.keywords, needle),
  ).map((page) => ({
    page: page.id,
    row: null,
    title: page.label,
    description: page.description,
  }))

  return [...rows, ...pages]
}

/**
 * One icon per top-level category.
 *
 * Data, not a field on each page: a category is a place in the rail, and its icon
 * belongs to the rail rather than to any single page in it.
 */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  通用: Settings2,
  DSH: Boxes,
  Pi: Terminal,
  关于: Info,
}

/** `通用 › 智能体 › 模型`, for a search hit that has to say where it lives. */
function pathOf(id: SettingsPageId): string {
  const page = SETTINGS_PAGES.find((entry) => entry.id === id)
  if (page === undefined) return ''
  return [page.category, ...(page.group === undefined ? [] : [page.group]), page.label].join(' › ')
}

/** One page row; the tree decides how far it is indented. */
function PageItem({
  page,
  active,
  onOpen,
}: {
  page: SettingsPage
  active: boolean
  onOpen: () => void
}): React.JSX.Element {
  const Icon = page.icon

  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150',
        active
          ? 'bg-surface-raised text-text'
          : 'text-muted hover:bg-surface-hover hover:text-text',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
      <span className="truncate">{page.label}</span>
    </button>
  )
}

export function SettingsView(): React.JSX.Element {
  const [active, setActive] = useState<SettingsPageId>('general')
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<string | null>(null)

  const hits = useMemo(() => search(query), [query])
  const tree = useMemo(() => settingsTree(), [])
  // Groups start open; the tree is short enough that collapsing is a preference,
  // not a necessity.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const current = SETTINGS_PAGES.find((page) => page.id === active) ?? SETTINGS_PAGES[0]
  const category = current?.category ?? ''
  const shown = tree.find((entry) => entry.title === category) ?? tree[0]
  /** Pages of one category, in the order the tree draws them. */
  const pagesOf = (title: string): string[] =>
    (tree.find((entry) => entry.title === title)?.entries ?? []).flatMap((entry) =>
      entry.kind === 'page' ? [entry.page.id] : entry.group.pages.map((page) => page.id),
    )

  /** Opens the page a hit belongs to and reveals the row it names. */
  function jumpTo(hit: SearchHit): void {
    setActive(hit.page)
    setQuery('')
    if (hit.row === null) return

    setHighlight(hit.row)
    // The page has to be on screen before the row can be scrolled to.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-setting-row="${hit.row ?? ''}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    window.setTimeout(() => setHighlight(null), 2000)
  }

  const searching = query.trim().length > 0

  return (
    <div className="flex h-full min-h-0">
      {/* Level one: whose settings these are. A rail of its own, because a heading
          inside the list made a category look like another item in it. */}
      <aside
        aria-label="设置分区"
        className="flex w-24 shrink-0 flex-col gap-0.5 border-r border-border bg-surface/40 px-1.5 py-3"
      >
        {tree.map((entry) => {
          const on = entry.title === category
          const icon = CATEGORY_ICON[entry.title] ?? Settings2
          const Icon = icon

          return (
            <button
              key={entry.title}
              type="button"
              aria-current={on ? 'true' : undefined}
              onClick={() => {
                // A category has no page of its own: opening it opens its first page,
                // which is what the second column lists first anyway. A search in
                // progress is dropped — the click asked for a place, not a result.
                const first = pagesOf(entry.title)[0]
                if (first !== undefined) setActive(first as SettingsPageId)
                setQuery('')
              }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md px-1 py-2 text-2xs transition-colors duration-150',
                on
                  ? 'bg-surface-raised text-text'
                  : 'text-muted hover:bg-surface-hover hover:text-text',
              )}
            >
              <Icon className={cn('size-4', on ? 'text-accent' : 'text-faint')} aria-hidden />
              <span className="truncate">{entry.title}</span>
            </button>
          )
        })}
      </aside>

      {/* Levels two and three: the open category's groups and pages. */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface/20">
        <div className="px-3 pt-3 pb-2">
          <h1 className="mb-2 text-sm font-semibold">{category}</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              aria-label="搜索设置"
              placeholder="搜索设置项"
              className="h-8 pl-7 text-xs"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <nav aria-label="设置分类" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {searching ? (
            hits.length === 0 ? (
              <p className="px-2 py-3 text-2xs text-faint">没有匹配的设置项。</p>
            ) : (
              <ul className="flex flex-col gap-px">
                {hits.map((hit) => (
                  <li key={`${hit.page}:${hit.row ?? ''}`}>
                    <button
                      type="button"
                      onClick={() => jumpTo(hit)}
                      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                    >
                      <span className="truncate text-text">{hit.title}</span>
                      <span className="truncate text-2xs text-faint">
                        {/* The path, not just the page: two categories can hold a page
                            with the same name (both runtimes are called 运行时). */}
                        {pathOf(hit.page)}
                        {hit.row === null ? '' : ` › ${hit.description}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            (shown?.entries ?? []).map((entry) => {
              if (entry.kind === 'page') {
                return (
                  <PageItem
                    key={entry.page.id}
                    page={entry.page}
                    active={entry.page.id === active}
                    onOpen={() => setActive(entry.page.id)}
                  />
                )
              }

              const { title, pages } = entry.group
              const shut = collapsed[`${category}/${title}`] === true
              const holdsActive = pages.some((page) => page.id === active)

              return (
                <div key={title} className="mb-px">
                  <button
                    type="button"
                    aria-expanded={!shut}
                    onClick={() =>
                      setCollapsed((current) => ({
                        ...current,
                        [`${category}/${title}`]: !shut,
                      }))
                    }
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-2xs transition-colors duration-150 hover:bg-surface-hover',
                      holdsActive && shut ? 'text-text' : 'text-faint',
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 shrink-0 transition-transform duration-150',
                        !shut && 'rotate-90',
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{title}</span>
                  </button>

                  {!shut && (
                    <div className="pl-2">
                      {pages.map((page) => (
                        <PageItem
                          key={page.id}
                          page={page}
                          active={page.id === active}
                          onOpen={() => setActive(page.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-7">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{current?.label ?? '设置'}</h2>
              <p className="mt-0.5 text-xs text-faint">{current?.description ?? ''}</p>
            </div>
            {current?.actions !== undefined && (
              <div className="app-no-drag flex shrink-0 items-center gap-2">
                {current.actions()}
              </div>
            )}
          </header>

          <SettingHighlight.Provider value={highlight}>
            {current?.render()}
          </SettingHighlight.Provider>
        </div>
      </section>
    </div>
  )
}
