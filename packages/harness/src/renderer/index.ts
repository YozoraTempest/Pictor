/**
 * What the harness gives a shell to mount.
 *
 * The destinations and the state are the harness's; the window's chrome — rail, title bar,
 * columns — is the shell's, and composing the two is the shell's job. That is why there is
 * no `HarnessApp` here: a component that rendered the shell's own frame would be the shell
 * living inside the package.
 */
export { defaultView, findView, viewsFor } from './app/views.js'
export { openView } from './app/open-view.js'
export { useUiStore } from './app/ui-store.js'
export { useWorkspaceStore } from './app/workspace-store.js'
export { useChatStore } from './features/chat/chat-store.js'
