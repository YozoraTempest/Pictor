// @vitest-environment node

import { expect, it } from 'vitest'
import {
  AgentSessionRuntime,
  InteractiveMode,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from '@earendil-works/pi-coding-agent'

it('records the installed Pi public composition contract used by the TUI adapter', () => {
  expect(AgentSessionRuntime).toBeTypeOf('function')
  expect(InteractiveMode).toBeTypeOf('function')
  expect(InteractiveMode.prototype.run).toBeTypeOf('function')
  expect(createAgentSessionServices).toBeTypeOf('function')
  expect(createAgentSessionFromServices).toBeTypeOf('function')
  expect(createAgentSessionRuntime).toBeTypeOf('function')
})
