/**
 * The harness: everything this app does behind its window.
 *
 * Sessions, models, the engine, tool rules, skills, plugins — and the React tree that draws
 * them. The shell (`apps/desktop`, `@vulonlok/pictor`) keeps a window and a mount point; the
 * code that knows what a conversation is lives here.
 *
 * Being moved in, leaf first:
 *
 * - `main/` — the engine host, IPC channels, the plugin runtime, the model service
 * - `preload/` — the bridge a window is given
 * - `renderer/` — the tree the shell mounts (`<HarnessApp />`)
 */
export {}
