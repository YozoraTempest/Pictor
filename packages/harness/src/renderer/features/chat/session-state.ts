import type { ChatJob, ChatPlanState, ChatTodoItem } from '@vulonlok/shared'

/**
 * The pure half of the session-state bar.
 *
 * These three states are *current*, so every rule about them is a merge rule rather
 * than an append: an event patches the mode, the runtime's roster reconciles the jobs
 * the events claimed were running, and the todo list simply replaces itself. Keeping
 * the rules here rather than in the component is what makes them testable without a
 * browser and reusable by anything else that reads the same state.
 */

/** Fold one `plan.changed` into the plan that was on screen. */
export function applyPlanEvent(
  state: ChatPlanState | null,
  event: { active: boolean | null; pending: boolean },
): ChatPlanState {
  return {
    // A command in flight cannot say where it will land, so it keeps the mode it found.
    active: event.active ?? state?.active ?? false,
    pending: event.pending,
  }
}

/**
 * Reconcile what the events claimed with what the runtime says is still there.
 *
 * The roster wins for every job it names. A job the roster does not name is a job the
 * runtime no longer has — a process that died, a home that was wiped — and leaving it
 * marked `running` would draw work that will never finish. It becomes `failed` with a
 * reason that says whose judgement that was, rather than quietly disappearing: the
 * person may well need to know the task did not complete.
 */
export function mergeJobs(local: readonly ChatJob[], roster: readonly ChatJob[]): ChatJob[] {
  const byId = new Map<string, ChatJob>()
  for (const job of local) byId.set(job.id, job)

  const seen = new Set<string>()
  for (const job of roster) {
    byId.set(job.id, job)
    seen.add(job.id)
  }

  for (const [id, job] of byId) {
    if (seen.has(id) || (job.status !== 'running' && job.status !== 'stopping')) continue
    byId.set(id, {
      ...job,
      status: 'failed',
      finishedAt: job.finishedAt ?? Date.now(),
      detail: '运行时已不再持有这个任务',
    })
  }

  return [...byId.values()].sort((left, right) => left.startedAt - right.startedAt)
}

/** Jobs still occupying the runtime; the rest are history the bar keeps but does not act on. */
export function liveJobs(jobs: readonly ChatJob[]): ChatJob[] {
  return jobs.filter((job) => job.status === 'running' || job.status === 'stopping')
}

/** How much of the list is done, and which step is being worked on. */
export function todoSummary(todos: readonly ChatTodoItem[]): {
  done: number
  total: number
  current: string | null
} {
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  return { done, total: todos.length, current: active?.content ?? null }
}
