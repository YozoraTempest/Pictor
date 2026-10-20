import { useEffect, useMemo, useState } from 'react'

import type { PluginRecord, Project, Session } from '@pictor/shared'

import type { AppInfo, CommandDescriptor, PluginReport } from '../../shared/bridge.js'

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [plugins, setPlugins] = useState<PluginRecord[]>([])
  const [commands, setCommands] = useState<CommandDescriptor[]>([])
  const [report, setReport] = useState<PluginReport | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('New session')
  const [output, setOutput] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.projectId === selectedProject),
    [sessions, selectedProject],
  )

  async function refresh(): Promise<void> {
    const [snapshot, pluginList, commandList, pluginReport, appInfo] = await Promise.all([
      window.pictor.getSnapshot(),
      window.pictor.listPlugins(),
      window.pictor.listCommands(),
      window.pictor.pluginReport(),
      window.pictor.getAppInfo(),
    ])

    setProjects(snapshot.projects)
    setSessions(snapshot.sessions)
    setPlugins(pluginList)
    setCommands(commandList)
    setReport(pluginReport)
    setInfo(appInfo)
    setSelectedProject((current) => current ?? snapshot.projects[0]?.id ?? null)
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(String(reason)))
  }, [])

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>Pictor</h1>
          <p className="muted">Agent-native local development environment</p>
        </div>
        <div className="topbar-actions">
          {info !== null && (
            <span className="muted">
              v{info.version} · host-core {info.hostCore} · Electron {info.electron}
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const path = await window.pictor.pickDirectory()
                if (path !== null) await window.pictor.addProject(path)
              })
            }
          >
            Add project
          </button>
        </div>
      </header>

      {error !== null && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main className="columns">
        <section className="panel">
          <h2>Projects</h2>
          {projects.length === 0 && <p className="muted">No projects yet.</p>}
          <ul className="list">
            {projects.map((project) => (
              <li key={project.id} className={project.id === selectedProject ? 'selected' : ''}>
                <button
                  type="button"
                  className="link"
                  onClick={() => setSelectedProject(project.id)}
                >
                  {project.name}
                </button>
                <span className="path">{project.path}</span>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void run(() => window.pictor.removeProject(project.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Sessions</h2>
          {selectedProject === null ? (
            <p className="muted">Select a project first.</p>
          ) : (
            <>
              <div className="row">
                <input
                  value={sessionTitle}
                  onChange={(event) => setSessionTitle(event.target.value)}
                  aria-label="Session title"
                />
                <button
                  type="button"
                  disabled={busy || sessionTitle.trim().length === 0}
                  onClick={() =>
                    void run(async () => {
                      await window.pictor.createSession(selectedProject, sessionTitle)
                      setSessionTitle('New session')
                    })
                  }
                >
                  Create
                </button>
              </div>
              <ul className="list">
                {visibleSessions.map((session) => (
                  <li key={session.id}>
                    <span>{session.title}</span>
                    <span className="muted">{new Date(session.createdAt).toLocaleString()}</span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => void run(() => window.pictor.deleteSession(session.id))}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Plugins</h2>
          <ul className="list">
            {plugins.map((plugin) => (
              <li key={plugin.id}>
                <span>{plugin.id}</span>
                <span className="muted">{plugin.version}</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      void run(async () => {
                        await window.pictor.setPluginEnabled(plugin.id, event.target.checked)
                      })
                    }
                  />
                  enabled
                </label>
              </li>
            ))}
          </ul>
          <p className="muted">Changes apply after restart.</p>
          {report !== null && report.failures.length > 0 && (
            <ul className="list failures">
              {report.failures.map((failure) => (
                <li key={failure.source}>
                  <strong>{failure.source}</strong>
                  <span>{failure.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <section className="panel commands">
        <h2>Commands</h2>
        <ul className="list inline">
          {commands.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await window.pictor.executeCommand(command.id, {})
                    setOutput(`${command.id} → ${JSON.stringify(result, null, 2)}`)
                  })
                }
              >
                {command.id}
              </button>
              <span className="muted">{command.description}</span>
              <span className="badge">{command.source}</span>
            </li>
          ))}
        </ul>
        {output.length > 0 && <pre className="output">{output}</pre>}
      </section>
    </div>
  )
}
