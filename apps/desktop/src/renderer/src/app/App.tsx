import { useEffect } from 'react'

import { Banner } from '../components/ui/index.js'
import { useChatStore } from '../features/chat/chat-store.js'
import { AppShell } from '../shell/AppShell.js'
import { useApprovalStore } from './approval-store.js'
import { useQuestionStore } from './question-store.js'
import { useRuntimeStore } from './runtime-store.js'
import { useUiStore } from './ui-store.js'
import { findView } from './views.js'
import { useAppShortcuts } from './use-app-shortcuts.js'
import { useWorkspaceStore } from './workspace-store.js'

export function App(): React.JSX.Element {
  useAppShortcuts()

  const view = useUiStore((state) => state.view)
  const active = findView(view)

  const refresh = useWorkspaceStore((state) => state.refresh)
  const error = useWorkspaceStore((state) => state.error)
  const notice = useWorkspaceStore((state) => state.notice)
  const setError = useWorkspaceStore((state) => state.setError)
  const setNotice = useWorkspaceStore((state) => state.setNotice)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [refresh, setError])

  useEffect(
    () =>
      window.pictor.onChatEvent((event) => {
        useChatStore.getState().handleEvent(event)
        // A conversation that ends cannot still be waiting on a person: the kernel
        // cancels the dialog, and the card has to go with it.
        if (event.type === 'run.finished') useApprovalStore.getState().clearOf(event.sessionId)
      }),
    [],
  )

  // The runtime names a conversation after its first prompt; the sidebar should
  // show that name without waiting for the next manual refresh.
  useEffect(() => window.pictor.onWorkspaceChanged(() => void refresh()), [refresh])

  // The runtime blocks a tool call until a decision arrives; keep the request
  // where every window can render it, not inside a transcript.
  useEffect(
    () =>
      window.pictor.onApprovalRequest((request) => {
        useApprovalStore.getState().show(request)
      }),
    [],
  )

  // Same contract for the model's own questions: the tool call is held until one
  // of these is settled, so an unanswered request is a stalled turn.
  useEffect(
    () =>
      window.pictor.onQuestionRequest((request) => {
        useQuestionStore.getState().show(request)
      }),
    [],
  )

  // A conversation opened before the runtime was up holds an empty transcript;
  // when the runtime arrives, the same conversation has to be read again.
  useEffect(() => {
    void window.pictor.harnessStatus().then((status) => useRuntimeStore.getState().set(status))

    return window.pictor.onHarnessStatus((status) => {
      useRuntimeStore.getState().set(status)
      if (status.state !== 'ready') return
      const { viewing, chats } = useChatStore.getState()
      if (viewing === null) return
      if ((chats[viewing]?.messages.length ?? 0) !== 0) return
      void useChatStore.getState().open(viewing, { reload: true })
    })
  }, [])

  useEffect(() => {
    void useChatStore.getState().open(selectedSessionId)
  }, [selectedSessionId])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1079px)')
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) useUiStore.setState({ rightPanelOpen: false })
    }

    narrow.addEventListener('change', onChange)
    return () => narrow.removeEventListener('change', onChange)
  }, [])

  const notification =
    error !== null ? (
      <Banner tone="error" onDismiss={() => setError(null)}>
        {error}
      </Banner>
    ) : notice !== null ? (
      <Banner tone="notice" onDismiss={() => setNotice(null)}>
        {notice}
      </Banner>
    ) : undefined

  return <AppShell notification={notification}>{active.render()}</AppShell>
}
