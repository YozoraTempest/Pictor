/**
 * Moved: the UI kit belongs to `@vulonlok/ui` now.
 *
 * One kit, two consumers — the shell's own chrome and the harness's pages — so it cannot
 * live in either of them. This re-export goes away when the last import stops using it.
 */
export * from '@vulonlok/ui'
