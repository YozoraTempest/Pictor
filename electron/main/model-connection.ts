import type { ConnectionTestResult, ModelSettingsInput } from '../../src/shared/contracts.js'

type Fetch = typeof globalThis.fetch

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function responseMessage(status: number, fallback: string): string {
  return `${fallback}（HTTP ${status}）`
}

export class ModelConnectionTester {
  constructor(private readonly fetchImplementation: Fetch = globalThis.fetch) {}

  async test(settings: ModelSettingsInput, apiKey: string): Promise<ConnectionTestResult> {
    try {
      const response = await this.fetchImplementation(endpoint(settings.baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          stream: true,
          max_tokens: 1,
          tools: [
            {
              type: 'function',
              function: {
                name: 'pictor_connection_test',
                description: 'Connection capability probe.',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'none',
        }),
        signal: AbortSignal.timeout(15_000),
      })

      if (response.status === 401 || response.status === 403) {
        return { outcome: 'authentication', message: 'API Key 无效或没有访问该端点的权限' }
      }
      if (response.status === 404) {
        return { outcome: 'model', message: '模型标识不存在，或端点不提供该模型' }
      }
      if (response.status >= 500 || response.status === 429) {
        return {
          outcome: 'server',
          message: responseMessage(response.status, '模型服务暂时不可用'),
        }
      }
      if (!response.ok) {
        return {
          outcome: 'incompatible',
          message: responseMessage(response.status, '端点不兼容流式文本或工具调用请求'),
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLocaleLowerCase('en-US').includes('text/event-stream')) {
        return { outcome: 'incompatible', message: '端点未返回流式事件响应' }
      }

      await response.body?.cancel()
      return { outcome: 'success', message: '连接成功，端点接受流式文本和工具调用参数' }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        outcome: 'connectivity',
        message: timedOut
          ? '连接超时，请检查 API 地址和网络'
          : '无法连接模型服务，请检查 API 地址和网络',
      }
    }
  }
}
