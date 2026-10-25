/**
 * Which kernel's conversations a view shows.
 *
 * The rail has one destination per kernel, and a destination is not just a filter
 * over the same list: a conversation belongs to the kernel that produced its
 * transcript, so "the Pi page" is the only place Pi conversations are created and
 * the only place they are listed. Keeping the mapping here — in a module with no
 * imports — is what lets the store ask "what kernel is this view about" without
 * importing the view registry (which imports the views, which import the store).
 */
export const KERNEL_VIEWS = [
  { id: 'dsh', kernelId: 'dsh' },
  { id: 'pi', kernelId: 'pi' },
] as const

/** The kernel a view is scoped to, or null for a view that spans every kernel. */
export function kernelScopeOf(view: string): string | null {
  return KERNEL_VIEWS.find((entry) => entry.id === view)?.kernelId ?? null
}
