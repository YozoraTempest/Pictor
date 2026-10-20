import { AlertTriangle, MessageSquarePlus } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Banner, Button, EmptyState } from '../../components/ui/index.js'
import { useChatStore } from './chat-store.js'
import { Composer } from './Composer.js'
import { Transcript } from './Transcript.js'

export function ChatView(): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const createSession = useWorkspaceStore((state) => state.createSession)

  const messages = useChatStore((state) => state.messages)
  const running = useChatStore((state) => state.running)
  const loading = useChatStore((state) => state.loading)
  const hasMore = useChatStore((state) => state.hasMore)
  const path = useChatStore((state) => state.path)
  const error = useChatStore((state) => state.error)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const loadOlder = useChatStore((state) => state.loadOlder)

  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <h1 className="truncate text-sm font-medium">
          {session?.title ?? (project === null ? 'Pictor' : `${project.name} · 新会话`)}
        </h1>

        {running && (
          <Badge tone="accent" className="shrink-0">
            运行中
          </Badge>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {path !== null && (
            <span
              title={path}
              className="hidden max-w-72 truncate font-mono text-2xs text-faint sm:inline"
            >
              {path}
            </span>
          )}
          {project !== null && (
            <Badge tone="neutral" className="shrink-0">
              {project.name}
            </Badge>
          )}
        </div>
      </header>

      {error !== null && (
        <div className="px-4 pt-3">
          <Banner tone="error">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="size-3" />
              {error}
            </span>
          </Banner>
        </div>
      )}

      {session === null ? (
        <EmptyState
          title="选择或新建会话"
          description="在左侧项目下新建一个会话，然后开始对话。"
          action={
            selectedProjectId === null ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => void createSession('新会话')}>
                <MessageSquarePlus className="size-3.5" />
                新建会话
              </Button>
            )
          }
        />
      ) : (
        <>
          <Transcript
            messages={messages}
            hasMore={hasMore}
            loading={loading}
            onLoadOlder={() => void loadOlder()}
          />
          <Composer
            disabled={false}
            running={running}
            onSend={(prompt) => void send(prompt)}
            onStop={() => void stop()}
          />
        </>
      )}
    </section>
  )
}
