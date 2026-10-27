/**
 * The only place that knows dsh's method names.
 *
 * Everything else — the driver, the projections, the host's question and job handling —
 * names an operation, not a wire method. dsh renames one, this file changes; nothing that
 * consumes it has to.
 *
 * One exception: the guard plugin is *generated source* that runs inside dsh, so it names
 * the events it hooks as literals — it cannot import anything from here.
 *
 * This is the first half of the contract. The second half — dsh emitting our events so the
 * host stops reading its payloads at all — is a runtime change, and it lands here when it
 * lands.
 */
export const DSH = {
  session: {
    create: 'session/create',
    prompt: 'session/prompt',
    cancel: 'session/cancel',
    fork: 'session/fork',
    resume: 'session/resume',
    wait: 'session/wait',
    follow: 'session/follow',
    event: 'session/event',
    title: 'session/title',
    command: 'session/command',
    projections: 'session/projections',
    selectModel: 'session/selectModel',
  },
  settings: { mutate: 'settings/mutate', list: 'settings/list' },
  commands: { list: 'commands/list', execute: 'commands/execute' },
  job: {
    list: 'job/list',
    follow: 'job/follow',
    kill: 'job/kill',
    registered: 'job/registered',
    settled: 'job/settled',
  },
  tool: { call: 'tool/call', result: 'tool/result' },
  tools: { preExecute: 'tools/pre-execute', postExecute: 'tools/post-execute' },
} as const
