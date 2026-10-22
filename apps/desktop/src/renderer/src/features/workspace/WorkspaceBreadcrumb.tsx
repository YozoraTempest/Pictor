import { useWorkspaceStore } from '../../app/workspace-store.js'

/**
 * What the title bar shows while the workspace is open: the project the agent is
 * working in, followed by the conversation.
 *
 * A session outside every project reports 临时任务, and the session part is only
 * rendered once there is a conversation to name.
 */
export function WorkspaceBreadcrumb(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null
  const project = projects.find((entry) => entry.id === session?.projectId) ?? null

  return (
    <>
      {project?.name ?? '临时任务'}
      {session !== null && <span className="text-muted"> / {session.title}</span>}
    </>
  )
}
