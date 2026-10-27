import type { ChatJob, ChatPlanState, ChatSubagent, ChatTodoItem } from '@vulonlok/shared'

/**
 * The three states a conversation has *now*, replayed from its own event log.
 *
 * A transcript accumulates rows; these three do not. Each is replaced wholesale — a
 * todo list is a snapshot, plan mode is a boolean, a job roster is keyed by job id — so
 * "what is the state" is answered by replaying the log with last-write-wins and
 * keeping the result beside the transcript rather than in it. That is also why a
 * reopened conversation and a live one can share this code: both are reading the same
 * durable events.
 *
 * Absent means the kernel never said anything about it, which is not the same as an
 * empty answer: a Pi conversation has no todo list, and a panel for one would be a
 * control that never does anything.
 */

const TODO_STATUSES = new Set<ChatTodoItem['status']>(['pending', 'in_progress', 'completed'])

/** One `todo/write` payload, or null when it is not a list worth drawing. */
export function todosOf(value: unknown): ChatTodoItem[] | null {
  if (!Array.isArray(value)) return null
  const todos: ChatTodoItem[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { content?: unknown; status?: unknown }
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if (content.length === 0) continue
    const status = record.status
    // An unknown status is drawn as pending rather than dropped: the step exists, and
    // hiding it would misreport how much work is left.
    todos.push({
      content,
      status: TODO_STATUSES.has(status as ChatTodoItem['status'])
        ? (status as ChatTodoItem['status'])
        : 'pending',
    })
  }
  return todos
}

/** Whether a `plan/mode` payload says the conversation is exploring read-only. */
export function planActiveOf(data: Record<string, unknown>): boolean {
  return data['active'] === true
}

/**
 * One job from a `job/registered` or a `job/settled` payload.
 *
 * Registration carries no status; it is the terminal record that names one. A settled
 * record repeats every registration field, so the two are the same shape with the end
 * filled in.
 */
export function jobOf(value: unknown): ChatJob | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = typeof record['jobId'] === 'string' ? record['jobId'] : ''
  if (id.length === 0) return null

  const status = record['status']
  const kind =
    status === 'completed' || status === 'killed' || status === 'failed' ? status : 'running'
  const startedAt = record['startedAt']
  const finishedAt = record['finishedAt']
  const detail = record['detail']
  const label = record['label']

  return {
    id,
    kind: typeof record['kind'] === 'string' ? record['kind'] : 'job',
    // A job with no label still has to be a row: the runtime names most, not all.
    label: typeof label === 'string' && label.length > 0 ? label : id,
    status: kind,
    startedAt: typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : 0,
    finishedAt: typeof finishedAt === 'number' && Number.isFinite(finishedAt) ? finishedAt : null,
    detail: typeof detail === 'string' && detail.length > 0 ? detail : null,
  }
}

/**
 * One `subagent/catalog` payload.
 *
 * The runtime appends this to the *parent* the moment a child is published, which is
 * what makes a delegation knowable before the child has produced anything. Two versions
 * exist: a local child (0) and an external provider's (2, no local session).
 */
export function subagentOf(value: unknown): ChatSubagent | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = typeof record['childId'] === 'string' ? record['childId'] : ''
  if (id.length === 0) return null

  const label = typeof record['label'] === 'string' ? record['label'].trim() : ''
  const mode = typeof record['mode'] === 'string' ? record['mode'] : 'unknown'
  const createdAt = record['childCreatedAt']

  return {
    id,
    label: label.length > 0 ? label : id,
    mode,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : null,
  }
}

/** One stored event, as the wire carries it. */
interface StoredEvent {
  type?: unknown
  data?: unknown
}

function recordOf(event: StoredEvent): Record<string, unknown> | null {
  if (event.type === undefined) return null
  const data = event.data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/** What a session log says about its three current states. */
export interface SessionStates {
  todos?: ChatTodoItem[]
  plan?: ChatPlanState
  jobs?: ChatJob[]
  subagents?: ChatSubagent[]
}

/**
 * Replay a session log into the three states.
 *
 * Plan mode needs three events rather than one: the runtime commands itself to leave or
 * enter the mode, so a `/plan` that has been issued but not yet settled shows up as
 * `pending` — which is the difference between "nothing happened" and "loading".
 */
export function sessionStates(events: readonly unknown[]): SessionStates {
  let todos: ChatTodoItem[] | undefined
  let planActive: boolean | null = null
  let planSaid = false
  let planCommandId: string | null = null
  const jobs = new Map<string, ChatJob>()
  const subagents = new Map<string, ChatSubagent>()

  for (const raw of events) {
    if (typeof raw !== 'object' || raw === null) continue
    const event = raw as StoredEvent
    const type = event.type
    const data = recordOf(event)

    if (type === 'todo/write' && data !== null) {
      const parsed = todosOf(data['todos'])
      if (parsed !== null) todos = parsed
      continue
    }

    if (type === 'plan/mode' && data !== null) {
      planActive = planActiveOf(data)
      planCommandId = null
      planSaid = true
      continue
    }

    if (type === 'command/run' && data !== null && data['name'] === 'plan') {
      // A `plan` command with no words toggles; `off` is the only word that means
      // leave. Either way it is a command in flight until its `command/done` lands.
      if (typeof data['args'] === 'string') planCommandId = String(data['commandId'] ?? '')
      planSaid = true
      continue
    }

    if (type === 'command/done' && data !== null && planCommandId !== null) {
      if (String(data['commandId'] ?? '') === planCommandId) planCommandId = null
      continue
    }

    if (type === 'subagent/catalog' && data !== null) {
      const subagent = subagentOf(data)
      if (subagent !== null) subagents.set(subagent.id, subagent)
      continue
    }

    if ((type === 'job/registered' || type === 'job/settled') && data !== null) {
      const job = jobOf(data)
      // Later records win: settlement repeats the registration fields.
      if (job !== null) jobs.set(job.id, job)
      continue
    }
  }

  const states: SessionStates = {}
  if (todos !== undefined) states.todos = todos
  if (planSaid) {
    states.plan = { active: planActive === true, pending: planCommandId !== null }
  }
  if (jobs.size > 0) {
    // Oldest first, the order they were started in: a roster reads like a queue.
    states.jobs = [...jobs.values()].sort((left, right) => left.startedAt - right.startedAt)
  }
  if (subagents.size > 0) {
    states.subagents = [...subagents.values()].sort(
      (left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0),
    )
  }
  return states
}
