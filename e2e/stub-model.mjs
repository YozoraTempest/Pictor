import { createServer } from 'node:http'

/**
 * A model endpoint that answers like the real one, without a network.
 *
 * The point of the chat spec is the path between the window and the runtime, so
 * the far end of that path must be predictable: the same text, the same order,
 * on every run. The stub speaks the OpenAI chat-completions wire format because
 * that is what the runtime's default route expects.
 *
 * @typedef {object} StubModel
 * @property {string} baseUrl what a provider's `baseUrl` should be
 * @property {string[]} requests one line per call, for assertions
 * @property {{ text: string, hasImage: boolean, roles: string[], effort: string | null, toolText: string }[]} calls what each request carried
 * @property {() => Promise<void>} close
 */

const TITLE_HINT = 'title for an'

/** @param {unknown} value */
const isRecord = (value) => typeof value === 'object' && value !== null

/**
 * @param {object} [options]
 * @param {string} [options.reply] what the assistant says, streamed in pieces
 * @param {string[]} [options.replies] one answer per turn, when a spec needs them to differ
 * @param {string} [options.title] what the titling request returns
 * @param {number} [options.delayMs] hold the stream open, so a turn can be caught mid-flight
 * @param {Array<{ name: string, arguments: unknown }>} [options.toolCalls] one call per
 *   request, in order, before the reply; this is how a spec drives a real tool
 * @returns {Promise<StubModel>}
 */
export async function startStubModel(options = {}) {
  const reply = options.reply ?? '这是 e2e 模型的回答。'
  const replies = options.replies ?? []
  let answered = 0
  const title = options.title ?? 'e2e 自动标题'
  const delayMs = options.delayMs ?? 0
  const toolCalls = options.toolCalls ?? []
  /** @type {string[]} */
  const requests = []
  /** @type {{ text: string, hasImage: boolean, roles: string[], effort: string | null, toolText: string }[]} */
  const calls = []

  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += String(chunk)
    })
    request.on('end', () => {
      requests.push(`${request.method ?? ''} ${request.url ?? ''}`)

      if (request.url?.endsWith('/models') === true) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'stub-model' }] }))
        return
      }

      let parsed = {}
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = {}
      }

      const model =
        isRecord(parsed) && typeof parsed['model'] === 'string' ? parsed['model'] : 'stub-model'
      const messages =
        isRecord(parsed) && Array.isArray(parsed['messages']) ? parsed['messages'] : []

      // Every message's text, flattened: what the runtime injected (a skill body
      // from `/name`, a catalog) can only be seen here.
      const prompt = messages
        .map((message) =>
          isRecord(message) && typeof message['content'] === 'string' ? message['content'] : '',
        )
        .join('\n')

      // A spec asks whether the runtime sent an image; the bytes stay out of here.
      calls.push({
        text: prompt,
        hasImage: messages.some(
          (message) =>
            isRecord(message) &&
            Array.isArray(message['content']) &&
            message['content'].some(
              (part) =>
                isRecord(part) && (part['type'] === 'image_url' || part['type'] === 'image'),
            ),
        ),
        roles: messages.map((message) => (isRecord(message) ? String(message['role']) : '?')),
        // The reasoning level the runtime actually sent, which is the only place a
        // picker's promise can be checked.
        effort:
          isRecord(parsed) && typeof parsed['reasoning_effort'] === 'string'
            ? parsed['reasoning_effort']
            : null,
        // What every tool message carried, flattened: an answer the reader typed
        // can only be proven here, where the runtime feeds it back to the model.
        toolText: messages
          .filter((message) => isRecord(message) && message['role'] === 'tool')
          .map((message) =>
            isRecord(message) && typeof message['content'] === 'string' ? message['content'] : '',
          )
          .join('\n'),
      })
      const wantsStream = isRecord(parsed) && parsed['stream'] === true

      // A tool result in the conversation means an earlier call has finished, so
      // the next entry in the plan is due.
      const toolResults = messages.filter(
        (message) => isRecord(message) && message['role'] === 'tool',
      ).length
      if (toolCalls.length > toolResults && !prompt.includes(TITLE_HINT)) {
        const call = toolCalls[toolResults]
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const chunk = (/** @type {object} */ delta, /** @type {string | null} */ finish = null) =>
          `data: ${JSON.stringify({
            id: 'stub-1',
            object: 'chat.completion.chunk',
            created: 1,
            model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`
        response.write(chunk({ role: 'assistant', content: '' }))
        response.write(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: `call_${String(toolResults)}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              },
            ],
          }),
        )
        response.write(chunk({}, 'tool_calls'))
        response.end('data: [DONE]\n\n')
        return
      }

      // The runtime asks for a conversation title with its own prompt; giving it
      // a fixed answer is what lets the spec check that Pictor adopts it.
      // A titling request is not a turn, so only a conversation walks the list.
      let content = reply
      if (prompt.includes(TITLE_HINT)) content = title
      else if (replies.length > 0) {
        content = replies[Math.min(answered, replies.length - 1)] ?? reply
        answered += 1
      }

      if (!wantsStream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'stub-1',
            object: 'chat.completion',
            created: 1,
            model,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
          }),
        )
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const chunk = (/** @type {object} */ delta, /** @type {string | null} */ finish = null) =>
        `data: ${JSON.stringify({
          id: 'stub-1',
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`

      response.write(chunk({ role: 'assistant', content: '' }))
      // Two pieces, so a spec can see the transcript grow rather than appear.
      const head = content.length > 4 ? content.slice(0, Math.ceil(content.length / 2)) : ''
      const rest = content.slice(head.length)
      const finishStream = () => {
        if (head.length > 0) response.write(chunk({ content: head }))
        response.write(chunk({ content: rest }))
        response.write(chunk({}, 'stop'))
        response.write(
          `data: ${JSON.stringify({
            id: 'stub-1',
            object: 'chat.completion.chunk',
            created: 1,
            model,
            choices: [],
            usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
          })}\n\n`,
        )
        response.end('data: [DONE]\n\n')
      }
      // A delayed answer is what lets a spec act while the turn is still running.
      if (delayMs > 0) setTimeout(finishStream, delayMs)
      else finishStream()
    })
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    calls,
    close: async () => {
      await new Promise((resolve) => {
        server.close(() => resolve(undefined))
      })
    },
  }
}
