import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { SettingHighlight } from './highlight.js'
import { SETTING_ROWS, SETTINGS_PAGES, settingsGroups, type SettingsPageId } from './pages.js'

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

export function SettingsView(): React.JSX.Element {
  const [active, setActive] = useState<SettingsPageId>('general')
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<string | null>(null)

  const hits = useMemo(() => search(query), [query])
  const groups = useMemo(() => settingsGroups(), [])
  const current = SETTINGS_PAGES.find((page) => page.id === active) ?? SETTINGS_PAGES[0]

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
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/20">
        <div className="px-3 pt-3 pb-2">
          <h1 className="mb-2 text-sm font-semibold">设置</h1>
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
                        {SETTINGS_PAGES.find((page) => page.id === hit.page)?.label ?? ''}
                        {hit.row === null ? '' : ` › ${hit.description}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            groups.map((group) => (
              <div key={group.title} className="mb-2">
                <h2 className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-wider text-faint">
                  {group.title}
                </h2>
                <ul className="flex flex-col gap-px">
                  {group.pages.map((page) => {
                    const Icon = page.icon
                    const isActive = page.id === active

                    return (
                      <li key={page.id}>
                        <button
                          type="button"
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => setActive(page.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150',
                            isActive
                              ? 'bg-surface-raised text-text'
                              : 'text-muted hover:bg-surface-hover hover:text-text',
                          )}
                        >
                          <Icon
                            className={cn(
                              'size-3.5 shrink-0',
                              isActive ? 'text-accent' : 'text-faint',
                            )}
                          />
                          <span className="truncate">{page.label}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
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
