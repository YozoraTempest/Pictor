export {
  HarnessClient,
  NOTIFICATION,
  type HarnessClientOptions,
  type HarnessNotification,
  type HarnessNotificationListener,
  type HarnessSpawn,
  type SessionEventNotification,
} from './client.js'
export {
  PROTOCOL_VERSION,
  isJsonRpcNotification,
  isJsonRpcResponse,
  normalizeMethod,
  type InitializeParams,
  type InitializeResult,
  type JsonRpcError,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type NotificationName,
  type PromptContentBlock,
  type PromptParams,
  type SessionParams,
} from './protocol.js'

export {
  FollowStream,
  type FollowStreamOptions,
  type WebSocketConstructor,
  type WebSocketLike,
} from './follow.js'
export { HarnessRemote, type HarnessRemoteOptions } from './remote.js'
export type {
  PromptContentPart,
  SessionAddress,
  SessionAssistantStreamFrame,
  SessionCancelRequest,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionWireEvent,
  SessionWireHeader,
  StreamChunk,
} from './session.js'
export { EventStream, type EventStreamOptions, type RemoteWaterfallFrame } from './events.js'
