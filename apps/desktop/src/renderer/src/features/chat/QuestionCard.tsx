import { MessageCircleQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ChatAnswer, ChatQuestion, ChatQuestionRequest } from '@pictor/shared'

import { openSession } from '../../app/open-session.js'
import { useQuestionStore } from '../../app/question-store.js'
import { Button } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

/**
 * One question the model asked, with the answers it accepts.
 *
 * A question with options is answered by picking them; the same field also takes
 * free text, because "none of these" is a real answer and the runtime accepts a
 * custom string beside the selection. A question with no options is text only, and
 * one carrying a draft is an editor: a multi-line field seeded with the text the
 * person is asked to change. A single-line box there would hide the draft and
 * replace it, which is the one thing an edit must not do.
 */
function QuestionRow({
  question,
  answer,
  onChange,
}: {
  question: ChatQuestion
  answer: ChatAnswer | undefined
  onChange: (next: ChatAnswer) => void
}): React.JSX.Element {
  // A draft starts as the text it came with: an untouched answer is "the draft as
  // written", not "nothing", and clearing it on purpose is an edit too.
  const [custom, setCustom] = useState(answer?.custom ?? question.prefill ?? '')
  const selected = answer?.selected ?? []
  const options = question.options ?? []

  function toggle(label: string): void {
    const has = selected.includes(label)
    const next =
      question.multiSelect === true
        ? has
          ? selected.filter((entry) => entry !== label)
          : [...selected, label]
        : has
          ? []
          : [label]
    onChange({ id: question.id, selected: next, ...(custom.length === 0 ? {} : { custom }) })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {question.header !== undefined && (
        <span className="text-2xs text-faint">{question.header}</span>
      )}
      <p className="text-xs leading-relaxed text-text">{question.question}</p>
      {question.detail !== undefined && (
        <pre className="selectable max-h-32 overflow-auto rounded-md bg-bg px-2 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">
          {question.detail}
        </pre>
      )}

      {options.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {options.map((option) => {
            const on = selected.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={on}
                title={option.description}
                onClick={() => toggle(option.label)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-2xs transition-colors duration-150',
                  on
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}

      {question.prefill !== undefined ? (
        <textarea
          value={custom}
          aria-label={`编辑草稿：${question.question}`}
          rows={6}
          onChange={(event) => {
            setCustom(event.target.value)
            onChange({
              id: question.id,
              selected,
              ...(event.target.value.length === 0
                ? { custom: '' }
                : { custom: event.target.value }),
            })
          }}
          className="resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs leading-relaxed text-text focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      ) : (
        <input
          value={custom}
          aria-label={`补充说明：${question.question}`}
          placeholder={options.length > 0 ? '或输入你自己的答案' : '输入你的答案'}
          onChange={(event) => {
            setCustom(event.target.value)
            onChange({
              id: question.id,
              selected,
              ...(event.target.value.length === 0 ? {} : { custom: event.target.value }),
            })
          }}
          className="h-7 rounded-md border border-border bg-bg px-2 text-xs text-text placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      )}
    </div>
  )
}

/**
 * Asks the reader what the model wanted to know.
 *
 * The runtime holds the tool call until this is answered, so the card is loud and
 * blocks nothing else: dismissing it fails the call deliberately rather than
 * leaving the turn waiting for an answer that will never come.
 */
export function QuestionCard({
  request,
  foreign = false,
}: {
  request: ChatQuestionRequest
  /** True when the question belongs to a conversation other than the one on screen. */
  foreign?: boolean
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, ChatAnswer>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new request replaces the previous one wholesale, answers included.
  useEffect(() => {
    setAnswers({})
    setSending(false)
    setError(null)
  }, [request.eventId])

  async function send(list: ChatAnswer[] | null): Promise<void> {
    setSending(true)
    setError(null)
    try {
      await window.pictor.answerQuestions(request.eventId, list)
      useQuestionStore.getState().clear(request.eventId)
    } catch (reason) {
      setSending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-3.5 shrink-0 text-accent" aria-hidden />
        {/* Not "the model": a kernel can also pause for a question its own tooling
            asked, and the card is the same card either way. */}
        <span className="text-xs text-text">在等你回答</span>
      </div>

      {foreign && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-2xs text-faint">这个提问来自另一个会话，回答之后那边才会继续。</p>
          {request.sessionId !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                openSession(request.sessionId ?? '')
              }}
            >
              前往该会话
            </Button>
          )}
        </div>
      )}

      {request.questions.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          answer={answers[question.id]}
          onChange={(next) => setAnswers((current) => ({ ...current, [next.id]: next }))}
        />
      ))}

      {error !== null && <p className="text-2xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={sending}
          onClick={() =>
            void send(
              request.questions.map(
                (question) =>
                  answers[question.id] ?? {
                    id: question.id,
                    selected: [],
                    // Untouched, a draft is answered with the draft.
                    ...(question.prefill === undefined ? {} : { custom: question.prefill }),
                  },
              ),
            )
          }
        >
          回答
        </Button>
        <Button variant="ghost" size="sm" disabled={sending} onClick={() => void send(null)}>
          不回答
        </Button>
      </div>
    </div>
  )
}
