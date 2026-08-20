import type { RuntimeEvent } from './runtime-protocol.js'

export type RuntimeFailure = Pick<
  Extract<RuntimeEvent, { type: 'runtime.error' }>,
  'category' | 'message'
>

const categoryMessages: Record<RuntimeFailure['category'], string> = {
  authentication: '模型认证失败：请检查 API Key 和端点权限后重试。',
  connectivity: '模型连接中断：请检查网络和 API Base URL 后重试。',
  model: '模型不可用：请检查模型标识及该端点的模型权限。',
  server: '模型服务暂时不可用或请求受限：请稍后重试。',
  runtime: '模型响应无法处理：请检查兼容模式和服务端 SSE 格式。',
}

export function classifyRuntimeFailure(detail: string): RuntimeFailure {
  const normalized = detail.toLocaleLowerCase('en-US')
  let category: RuntimeFailure['category'] = 'runtime'
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('api key')) {
    category = 'authentication'
  } else if (normalized.includes('429') || /\b5\d\d\b/.test(normalized)) {
    category = 'server'
  } else if (normalized.includes('404') || normalized.includes('model')) {
    category = 'model'
  } else if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('connect') ||
    normalized.includes('timeout') ||
    normalized.includes('terminated') ||
    normalized.includes('socket') ||
    normalized.includes('econnreset') ||
    normalized.includes('stream ended') ||
    normalized.includes('stream closed')
  ) {
    category = 'connectivity'
  }
  return { category, message: `${categoryMessages[category]} 技术详情：${detail}` }
}
