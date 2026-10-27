/**
 * Which page a kernel's conversations live on.
 *
 * The rail used to carry a hand-written list — dsh, pi — so a kernel installed from a
 * plugin had no page at all: its conversations were reachable only through the search
 * palette. A page is now named after the kernel it holds (`kernel:<id>`), which makes
 * the rail a function of what is mounted. This module deliberately imports nothing:
 * the store, the view registry and the shortcuts all ask it, and a cycle between them
 * would be resolved by whichever one happened to load first.
 */

/** Prefix that keeps a kernel page distinct from `home` and `settings`. */
export const KERNEL_VIEW_PREFIX = 'kernel:'

/** The view id that lists one kernel's conversations. */
export function kernelViewId(kernelId: string): string {
  return `${KERNEL_VIEW_PREFIX}${kernelId}`
}

/** The kernel a view is about, or null for a view that is not one kernel's. */
export function kernelOfView(view: string): string | null {
  if (!view.startsWith(KERNEL_VIEW_PREFIX)) return null
  const id = view.slice(KERNEL_VIEW_PREFIX.length)
  return id.length === 0 ? null : id
}
