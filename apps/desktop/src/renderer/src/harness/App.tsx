import { useEffect } from 'react'

import { Banner } from '@vulonlok/ui'
import { useChatStore } from '@vulonlok/harness/renderer/features/chat/chat-store'
import { AppShell } from '../shell/AppShell.js'
import { useApprovalStore } from '@vulonlok/harness/renderer/approval-store'
import { useQuestionStore } from '@vulonlok/harness/renderer/question-store'
import { useRuntimeStore } from '@vulonlok/harness/renderer/runtime-store'
import { useUiStore } from '@vulonlok/harness/renderer/app/ui-store'
import { openView } from '@vulonlok/harness/renderer/app/open-view'
import { findView } from '@vulonlok/harness/renderer/app/views'
import { useAppShortcuts } from '@vulonlok/harness/renderer/app/use-app-shortcuts'
import { useWorkspaceStore } from '@vulonlok/harness/renderer/app/workspace-store'

export function HarnessApp(): React.JSX.Element {
  useAppShortcuts()

  const view = useUiStore((state) => state.view)
  const kernels = useWorkspaceStore((state) => state.kernels)
  const active = findView(view, kernels)

  // A kernel page stops existing when that kernel is turned off or uninstalled. Land
  // on home instead of a frame nobody draws.
  useEffect(() => {
    if (active.id !== view) openView(active.id)
  }, [active.id, view])

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

  // An extension asked to say something. It is not Pictor's message, so it lands in
  // the same banner every other notice uses and names the kernel that sent it.
  useEffect(
    () =>
      window.pictor.onKernelNotice((notice) => {
        if (notice.level === 'error') setError(notice.message)
        else setNotice(notice.message)
      }),
    [setError, setNotice],
  )

  useEffect(
    () =>
      window.pictor.onChatEvent((event) => {
        useChatStore.getState().handleEvent(event)
        // A conversation that ends cannot still be waiting on a person: the kernel
        // cancels the dialog, and both the card and the sidebar badge have to go.
        if (event.type === 'run.finished') {
          useApprovalStore.getState().clearOf(event.sessionId)
          useQuestionStore.getState().clearOf(event.sessionId)
        }
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
