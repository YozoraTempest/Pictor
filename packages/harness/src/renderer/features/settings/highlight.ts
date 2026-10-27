import { createContext, useContext } from 'react'

/**
 * The row a search result pointed at.
 *
 * Search works at row level, so a result has to be able to reveal the exact row
 * it names — not just the page it lives on. Pages do not thread this through
 * their props: the row asks the context itself.
 */
export const SettingHighlight = createContext<string | null>(null)

/** True while `id` is the row a search result just jumped to. */
export function useSettingHighlight(id: string | undefined): boolean {
  const highlighted = useContext(SettingHighlight)
  return id !== undefined && highlighted === id
}
