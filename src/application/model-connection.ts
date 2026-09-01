import { z } from 'zod'

import type {
  ConnectionTestResult,
  ModelCatalogResult,
  ModelSettingsInput,
} from '../shared/model.js'

type Fetch = typeof globalThis.fetch

const PROBE_TOOL_NAME = 'pictor_connection_test'
const REQUEST_TIMEOUT_MS = 15_000

const modelCatalogResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1).max(200),
    }),
  ),
})

function apiEndpoint(baseUrl: string, resource: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${resource}`
}

function requestBody(settings: ModelSettingsInput): Record<string, unknown> {
  const tool = {
    name: PROBE_TOOL_NAME,
    description: 'Return an empty object to confirm function tool support.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    strict: false,
  }
  const prompt = `Call ${PROBE_TOOL_NAME} exactly once with an empty object. Do not answer with text.`

  if (settings.apiProtocol === 'responses') {
    return {
      model: settings.modelId,
      input: prompt,
      stream: true,
      store: false,
      tools: [{ type: 'function', ...tool }],
      tool_choice: { type: 'function', name: PROBE_TOOL_NAME },
      ...(settings.reasoningEffort === null
        ? {}
        : { reasoning: { effort: settings.reasoningEffort } }),
    }
  }

  return {
    model: settings.modelId,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    tools: [{ type: 'function', function: tool }],
    tool_choice: { type: 'function', function: { name: PROBE_TOOL_NAME } },
    ...(settings.reasoningEffort === null ? {} : { reasoning_effort: settings.reasoningEffort }),
  }
}

function responseMessage(status: number, fallback: string): string {
  return `${fallback}（HTTP ${status}）`
}

function classifyHttpStatus(status: number, modelRequest: boolean): ConnectionTestResult | null {
  if (status === 401 || status === 403) {
    return { outcome: 'authentication', message: 'API Key 无效或没有访问该端点的权限' }
  }
  if (status === 404 && modelRequest) {
    return { outcome: 'model', message: '模型标识不存在，或端点不提供该模型' }
  }
  if (status >= 500 || status === 429) {
    return { outcome: 'server', message: responseMessage(status, '模型服务暂时不可用') }
  }
  if (status >= 400) {
    return {
      outcome: 'incompatible',
      message: responseMessage(
        status,
        modelRequest ? '端点不兼容流式工具调用请求' : '无法获取模型列表',
      ),
    }
  }
  return null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function isChatEvent(value: unknown): boolean {
  return Array.isArray(objectValue(value)?.choices)
}

function chatEventHasProbeTool(value: unknown): boolean {
  const choices = objectValue(value)?.choices
  if (!Array.isArray(choices)) return false
  return choices.some((choice) => {
    const choiceObject = objectValue(choice)
    const message = objectValue(choiceObject?.delta) ?? objectValue(choiceObject?.message)
    const toolCalls = message?.tool_calls
    if (!Array.isArray(toolCalls)) return false
    return toolCalls.some(
      (call) => objectValue(objectValue(call)?.function)?.name === PROBE_TOOL_NAME,
    )
  })
}

function isResponsesEvent(value: unknown): boolean {
  const type = objectValue(value)?.type
  return typeof type === 'string' && type.startsWith('response.')
}

function responsesEventHasProbeTool(value: unknown): boolean {
  const event = objectValue(value)
  if (objectValue(event?.item)?.name === PROBE_TOOL_NAME) return true
  const output = objectValue(event?.response)?.output
  return Array.isArray(output) && output.some((item) => objectValue(item)?.name === PROBE_TOOL_NAME)
}

interface StreamProbeResult {
  validEvent: boolean
  toolCall: boolean
}

function inspectEvent(
  data: string,
  protocol: ModelSettingsInput['apiProtocol'],
): StreamProbeResult {
  if (!data || data === '[DONE]') return { validEvent: false, toolCall: false }
  try {
    const value: unknown = JSON.parse(data)
    return protocol === 'responses'
      ? { validEvent: isResponsesEvent(value), toolCall: responsesEventHasProbeTool(value) }
      : { validEvent: isChatEvent(value), toolCall: chatEventHasProbeTool(value) }
  } catch {
    return { validEvent: false, toolCall: false }
  }
}

function eventData(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
}

async function inspectStream(
  response: Response,
  protocol: ModelSettingsInput['apiProtocol'],
): Promise<StreamProbeResult> {
  const reader = response.body?.getReader()
  if (!reader) return { validEvent: false, toolCall: false }

  const decoder = new TextDecoder()
  let buffer = ''
  let result: StreamProbeResult = { validEvent: false, toolCall: false }

  const inspectBlock = (block: string) => {
    const inspected = inspectEvent(eventData(block), protocol)
    result = {
      validEvent: result.validEvent || inspected.validEvent,
      toolCall: result.toolCall || inspected.toolCall,
    }
  }

  try {
    while (!result.toolCall) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) inspectBlock(block)
      if (chunk.done) {
        if (buffer.trim()) inspectBlock(buffer)
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return result
}

function connectivityResult(error: unknown): ConnectionTestResult {
  const timedOut =
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
  return {
    outcome: 'connectivity',
    message: timedOut
      ? '连接超时，请检查 API 地址和网络'
      : '无法连接模型服务，请检查 API 地址和网络',
  }
}

export class ModelConnectionTester {
  constructor(private readonly fetchImplementation: Fetch = globalThis.fetch) {}

  async test(settings: ModelSettingsInput, apiKey: string): Promise<ConnectionTestResult> {
    const protocol = settings.apiProtocol === 'responses' ? 'Responses' : 'Chat Completions'
    try {
      const response = await this.fetchImplementation(
        apiEndpoint(
          settings.baseUrl,
          settings.apiProtocol === 'responses' ? 'responses' : 'chat/completions',
        ),
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody(settings)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )

      const statusResult = classifyHttpStatus(response.status, true)
      if (statusResult) return statusResult

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLocaleLowerCase('en-US').includes('text/event-stream')) {
        return {
          outcome: 'incompatible',
          message: `${protocol} 端点未返回 SSE 流；请确认 Base URL 是 API 根地址（通常以 /v1 结尾）`,
        }
      }

      const probe = await inspectStream(response, settings.apiProtocol)
      if (!probe.validEvent) {
        return {
          outcome: 'incompatible',
          message: `${protocol} 端点未返回可解析的协议事件`,
        }
      }
      if (!probe.toolCall) {
        return {
          outcome: 'incompatible',
          message: `${protocol} 端点可以流式响应，但未执行指定工具调用`,
        }
      }
      return { outcome: 'success', message: `连接成功，已验证 ${protocol} 流式工具调用` }
    } catch (error) {
      return connectivityResult(error)
    }
  }

  async listModels(baseUrl: string, apiKey: string): Promise<ModelCatalogResult> {
    try {
      const response = await this.fetchImplementation(apiEndpoint(baseUrl, 'models'), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const statusResult = classifyHttpStatus(response.status, false)
      if (statusResult) return { ...statusResult, models: [] }

      const parsed = modelCatalogResponseSchema.safeParse(await response.json())
      if (!parsed.success) {
        return {
          outcome: 'incompatible',
          message: '模型端点未返回 OpenAI 兼容的模型列表',
          models: [],
        }
      }
      const models = [...new Set(parsed.data.data.map((model) => model.id))].sort((left, right) =>
        left.localeCompare(right, 'en-US'),
      )
      if (models.length === 0) {
        return { outcome: 'incompatible', message: '模型端点返回了空列表', models: [] }
      }
      return { outcome: 'success', message: `已获取 ${models.length} 个可用模型`, models }
    } catch (error) {
      return { ...connectivityResult(error), models: [] }
    }
  }
}
