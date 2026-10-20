import { useEffect, useMemo, useState } from 'react'

import type { PluginRecord, Project, Session } from '@pictor/shared'

import type { AppInfo, CommandDescriptor, PluginReport } from '../../shared/bridge.js'
import { ChatPanel } from './ChatPanel.js'
import { ModelSettingsPanel } from './ModelSettings.js'

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [plugins, setPlugins] = useState<PluginRecord[]>([])
  const [commands, setCommands] = useState<CommandDescriptor[]>([])
  const [report, setReport] = useState<PluginReport | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('New session')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const project = useMemo(
    () => projects.find((entry) => entry.id === selectedProject) ?? null,
    [projects, selectedProject],
  )

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

  useEffect(() => {
    if (selectedProject === null) {
      setSelectedSession(null)
      return
    }

    setSelectedSession((current) => {
      if (current !== null && sessions.some((session) => session.id === current)) return current
      return sessions.find((session) => session.projectId === selectedProject)?.id ?? null
    })
  }, [sessions, selectedProject])

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
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Pictor</h1>
          <p className="muted">Agent-native local development environment</p>
        </div>
        <div className="topbar-actions">
          {info !== null && (
            <span className="muted">
              v{info.version} · host-core {info.hostCore}
            </span>
          )}
          <button type="button" onClick={() => setSettingsOpen((open) => !open)}>
            Model settings
          </button>
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
          <button type="button" className="ghost" onClick={() => setRightOpen((open) => !open)}>
            {rightOpen ? 'Hide panel' : 'Show panel'}
          </button>
        </div>
      </header>

      {settingsOpen && <ModelSettingsPanel workingDirectory={project?.path ?? ''} />}
      {error !== null && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className={`app-layout${rightOpen ? '' : ' right-hidden'}`}>
        <aside className="sidebar">
          <section>
            <h2>Projects</h2>
            {projects.length === 0 && <p className="muted">No projects yet.</p>}
            <ul className="list">
              {projects.map((entry) => (
                <li key={entry.id} className={entry.id === selectedProject ? 'selected' : ''}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setSelectedProject(entry.id)}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void run(() => window.pictor.removeProject(entry.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="sessions">
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
                    +
                  </button>
                </div>
                <ul className="list">
                  {visibleSessions.map((session) => (
                    <li
                      key={session.id}
                      className={session.id === selectedSession ? 'selected' : ''}
                    >
                      <button
                        type="button"
                        className="link"
                        onClick={() => setSelectedSession(session.id)}
                      >
                        {session.title}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await window.pictor.deleteSession(session.id)
                            if (selectedSession === session.id) setSelectedSession(null)
                          })
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>

        <main className="chat-area">
          <ChatPanel sessionId={selectedSession} projectName={project?.name ?? ''} />
        </main>

        <aside className="right-panel">
          <section>
            <h2>Plugins</h2>
            <ul className="list">
              {plugins.map((plugin) => (
                <li key={plugin.id}>
                  <span className="path">{plugin.id}</span>
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
                    on
                  </label>
                </li>
              ))}
            </ul>
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

          <section>
            <h2>Commands</h2>
            <ul className="list">
              {commands.map((command) => (
                <li key={command.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await window.pictor.executeCommand(command.id, {})
                        setOutput(`${command.id} → ${JSON.stringify(result)}`)
                      })
                    }
                  >
                    {command.id}
                  </button>
                </li>
              ))}
            </ul>
            {output.length > 0 && <pre className="output">{output}</pre>}
          </section>
        </aside>
      </div>
    </div>
  )
}
