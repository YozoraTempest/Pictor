import type { ChatAnswer, ChatQuestion, ChatQuestionOption } from '@pictor/shared'

/**
 * Reads the questions out of a `user-questions/request` waterfall payload.
 *
 * The payload crosses the runtime's gateway, which forwards only JSON-safe fields
 * minus the agent and the abort signal, so nothing here may assume more than the
 * wire promises. A request that names no usable question returns an empty list
 * instead of throwing: refusing it wholesale would leave the tool call hanging,
 * which is the failure this whole channel exists to avoid.
 */
export function questionsOf(request: unknown): ChatQuestion[] {
  if (typeof request !== 'object' || request === null) return []
  const raw = (request as Record<string, unknown>)['questions']
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item): ChatQuestion[] => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Record<string, unknown>
    const id = entry['id']
    const question = entry['question']
    if (typeof id !== 'string' || id.length === 0) return []
    if (typeof question !== 'string' || question.length === 0) return []

    const options = optionsOf(entry['options'])
    const header = textOf(entry['header'])
    const detail = textOf(entry['detail'])
    return [
      {
        id,
        question,
        ...(header === null ? {} : { header }),
        ...(detail === null ? {} : { detail }),
        ...(options === null ? {} : { options }),
        ...(entry['multiSelect'] === true ? { multiSelect: true } : {}),
      },
    ]
  })
}

function optionsOf(value: unknown): ChatQuestionOption[] | null {
  if (!Array.isArray(value)) return null
  const options = value.flatMap((item): ChatQuestionOption[] => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Record<string, unknown>
    const label = entry['label']
    if (typeof label !== 'string' || label.length === 0) return []
    const description = textOf(entry['description'])
    return [{ label, ...(description === null ? {} : { description }) }]
  })
  return options.length === 0 ? null : options
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * The value the runtime's question waterfall has to receive.
 *
 * Every asked question must appear exactly once — the runtime rejects a batch
 * that misses one — so this fills in the unanswered ones rather than dropping
 * them, and keeps only labels the model actually offered.
 */
export function answerValue(
  questions: readonly ChatQuestion[],
  answers: readonly ChatAnswer[],
): { answers: ChatAnswer[] } {
  const byId = new Map(answers.map((answer) => [answer.id, answer]))
  return {
    answers: questions.map((question) => {
      const given = byId.get(question.id)
      const offered = new Set((question.options ?? []).map((option) => option.label))
      const selected = (given?.selected ?? []).filter((label) => offered.has(label))
      const custom = given?.custom?.trim()
      return {
        id: question.id,
        selected,
        ...(custom === undefined || custom.length === 0 ? {} : { custom }),
      }
    }),
  }
}
