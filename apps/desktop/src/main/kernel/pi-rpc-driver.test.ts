import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HarnessNotification } from '@pictor/harness'
import { afterEach, describe, expect, it } from 'vitest'

import { PiRpcDriver } from './pi-rpc-driver.js'

/**
 * The driver, driven by a stand-in that speaks Pi's RPC protocol.
 *
 * Everything that can go wrong here is a protocol mistake — a command that never
 * gets a response, an event that is not translated, a turn that never closes — and
 * none of it is visible until a real turn runs. The fake answers like `pi --mode
 * rpc`: one JSON record per line, responses echoing the command id, events
 * describing the session.
 */

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A fake Pi: `input` decides what `get_state` claims the model accepts, and `ask`
 * makes a turn hold a tool call on a dialog instead of finishing by itself.
 */
function fakePi(
  options: {
    input: string
    reply?: string
    settle?: 'immediately' | 'onAbort'
    ask?: boolean
  } = {
    input: 'text',
  },
): {
  userData: string
  script: string
  log: string
} {
  const userData = mkdtempSync(join(tmpdir(), 'pictor-pi-rpc-'))
  dirs.push(userData)
  const script = join(userData, 'fake-pi.mjs')
  const log = join(userData, 'commands.log')
  writeFileSync(
    script,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const NL = String.fromCharCode(10)
const log = ${JSON.stringify(log)}
const reply = ${JSON.stringify(options.reply ?? '等于 2')}
const input = ${JSON.stringify(options.input)}.split(',')
const settle = ${JSON.stringify(options.settle ?? 'immediately')}
const ask = ${JSON.stringify(options.ask === true)}
let sessionId = 'pi-fake-1'
let level = 'high'
let modelId = 'fake-1'
const LEVELS = ['omit', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const MODELS = {
  'fake-1': { name: 'Fake Model', provider: 'fake', input: input, levels: ['low', 'high', 'max'] },
  'vision-1': { name: 'Vision Model', provider: 'fake', input: ['text', 'image'], levels: [] },
}
const modelOf = (id) => {
  const found = MODELS[id] ?? MODELS['fake-1']
  return { id: id, name: found.name, provider: found.provider, input: found.input }
}
// Pi clamps to the levels the model maps, so a request it cannot honor comes back lower.
const clampLevel = (requested) => {
  const available = MODELS[modelId].levels
  if (available.length === 0 || available.includes(requested)) return requested
  const wanted = LEVELS.indexOf(requested)
  return available.filter((entry) => LEVELS.indexOf(entry) <= wanted).at(-1) ?? available[0]
}
appendFileSync(log, JSON.stringify({ type: 'argv', argv: process.argv.slice(2) }) + NL)
const send = (record) => process.stdout.write(JSON.stringify(record) + NL)
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf(NL)
    if (newline === -1) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line.trim().length === 0) continue
    const command = JSON.parse(line)
    appendFileSync(log, JSON.stringify(command) + NL)
    handle(command)
  }
})
function handle(command) {
  if (command.type === 'get_state') {
    send({ id: command.id, type: 'response', command: 'get_state', success: true,
      data: { model: modelOf(modelId),
        sessionId: sessionId, sessionFile: '/tmp/' + sessionId + '.jsonl', thinkingLevel: level } })
    return
  }
  if (command.type === 'get_entries') {
    send({ id: command.id, type: 'response', command: 'get_entries', success: true,
      data: { entries: [
        { type: 'message', id: 'entry-1', message: { role: 'user', content: [{ type: 'text', text: '你好' }] } },
        { type: 'message', id: 'entry-2', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
      ], leafId: 'entry-2' } })
    return
  }
  if (command.type === 'get_fork_messages') {
    send({ id: command.id, type: 'response', command: 'get_fork_messages', success: true,
      data: { messages: [{ entryId: 'entry-1', text: '你好' }] } })
    return
  }
  if (command.type === 'fork') {
    sessionId = 'pi-forked'
    send({ id: command.id, type: 'response', command: 'fork', success: true,
      data: { text: '你好', cancelled: false } })
    return
  }
  if (command.type === 'get_available_models') {
    send({ id: command.id, type: 'response', command: 'get_available_models', success: true,
      data: { models: [
        { id: 'fake-1', name: 'Fake Model', provider: 'fake', input: ['text'], contextWindow: 1000,
          thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' } },
        { id: 'vision-1', name: 'Vision Model', provider: 'fake', input: ['text', 'image'], contextWindow: 2000 },
      ] } })
    return
  }
  if (command.type === 'set_model') {
    modelId = String(command.modelId)
    level = clampLevel(level)
    send({ id: command.id, type: 'response', command: 'set_model', success: true, data: {} })
    return
  }
  if (command.type === 'set_thinking_level') {
    level = clampLevel(String(command.level))
    send({ id: command.id, type: 'response', command: 'set_thinking_level', success: true, data: {} })
    return
  }
  if (command.type === 'prompt') {
    send({ id: command.id, type: 'response', command: 'prompt', success: true,
      data: { disposition: 'started' } })
    const images = Array.isArray(command.images) ? command.images.length : 0
    send({ type: 'session', id: 'pi-fake-1' })
    send({ type: 'turn_start' })
    send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '想' } })
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: reply } })
    if (images > 0) {
      send({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'a.png' } })
      send({ type: 'tool_execution_end', toolCallId: 'c1', isError: false,
        result: { content: [{ type: 'text', text: 'Read image file' }] } })
    }
    send({ type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text: reply }],
      usage: { input: 7, output: 3, totalTokens: 10 } } })
    if (ask) {
      // A held tool call: Pi asks the client and waits for the answer.
      send({ type: 'extension_ui_request', id: 'dlg-1', method: 'confirm',
        title: 'bash', message: '这个会话设置为「改动型工具先问我」' })
      return
    }
    if (settle === 'immediately') {
      send({ type: 'agent_end', messages: [] })
      send({ type: 'agent_settled', aborted: false })
    }
    return
  }
  if (command.type === 'extension_ui_response') {
    if (command.confirmed === true) {
      send({ type: 'tool_execution_start', toolCallId: 'c9', toolName: 'bash', args: { command: 'ls' } })
      send({ type: 'tool_execution_end', toolCallId: 'c9', isError: false,
        result: { content: [{ type: 'text', text: 'a.txt' }] } })
    }
    send({ type: 'agent_end', messages: [] })
    send({ type: 'agent_settled', aborted: command.confirmed !== true })
    return
  }
  if (command.type === 'abort') {
    send({ id: command.id, type: 'response', command: 'abort', success: true, data: {} })
    send({ type: 'agent_end', messages: [] })
    send({ type: 'agent_settled', aborted: true })
    return
  }
  if (command.type === 'shutdown') {
    send({ id: command.id, type: 'response', command: 'shutdown', success: true, data: {} })
    process.exit(0)
  }
}
`,
    { mode: 0o755 },
  )
  return { userData, script, log }
}

function driverFor(fake: { userData: string; script: string }): PiRpcDriver {
  return new PiRpcDriver({
    userData: fake.userData,
    script: fake.script,
    // The app's own runtime: exactly what production does, minus Electron.
    runtime: process.execPath,
    resolveCwd: () => Promise.resolve(fake.userData),
  })
}

interface Collected {
  frames: { type: string; data?: unknown; chunk?: Record<string, unknown> }[]
}

/** Collects frames until a turn closes, then returns everything seen. */
async function collect(
  driver: PiRpcDriver,
  act: (done: () => void) => Promise<void>,
): Promise<Collected> {
  const frames: Collected['frames'] = []
  let finish: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    finish = resolve
  })
  driver.onNotification((notification: HarnessNotification) => {
    const params = notification.params as {
      frame?:
        | { type: 'event'; event: { type: string; data?: unknown } }
        | { type: 'assistant-stream'; frame: { chunk: Record<string, unknown> } }
    }
    const frame = params.frame
    if (frame === undefined) return
    if (frame.type === 'event') {
      frames.push({ type: frame.event.type, data: frame.event.data })
      if (frame.event.type === 'turn/end') finish()
      return
    }
    frames.push({ type: 'chunk', chunk: frame.frame.chunk })
  })
  await act(finish)
  await closed
  return { frames }
}

function typesOf(collected: Collected): string[] {
  return collected.frames.map((frame) =>
    frame.type === 'chunk' ? `chunk:${String(frame.chunk?.['type'])}` : frame.type,
  )
}

function commands(fake: { log: string }): Record<string, unknown>[] {
  try {
    return readFileSync(fake.log, 'utf8')
      .split('\n')
      .flatMap((line): Record<string, unknown>[] => {
        if (line.trim().length === 0) return []
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

describe('PiRpcDriver', () => {
  it('runs a prompt as one turn and closes it when Pi settles', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    const collected = await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    expect(typesOf(collected)).toEqual([
      'turn/start',
      'chunk:reasoning-delta',
      'chunk:text-delta',
      'chunk:usage',
      'assistant/message',
      'turn/end',
    ])
    expect(collected.frames[0]?.data).toEqual({ turn: 1 })
    // The closing frame also names the question Pi stored, so the row that asked it
    // can be branched from.
    expect(collected.frames.at(-1)?.data).toEqual({
      reason: { kind: 'completed' },
      forkId: 'entry-1',
    })

    // The child is started with the session directory, so Pi stores the transcript
    // where Pictor reads it back from.
    expect(commands(fake).map((command) => command['type'])).toContain('get_state')
    await driver.stop()
  })

  it('sends images as content, and refuses them when the model cannot see', async () => {
    const blind = fakePi({ input: 'text' })
    const blindDriver = driverFor(blind)
    await expect(
      blindDriver.prompt('s1', '看图', [{ mediaType: 'image/png', data: 'AAAA' }]),
    ).rejects.toThrow(/Fake Model 不接受图片/)
    await blindDriver.stop()

    const seeing = fakePi({ input: 'text,image', reply: '图上写着 TOKEN' })
    const seeingDriver = driverFor(seeing)
    const collected = await collect(seeingDriver, async () => {
      await seeingDriver.prompt('s2', '看图', [{ mediaType: 'image/png', data: 'AAAA' }])
    })

    const prompt = commands(seeing).find((command) => command['type'] === 'prompt')
    expect(prompt?.['images']).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }])
    expect(typesOf(collected)).toContain('tool/call')
    expect(typesOf(collected).at(-1)).toBe('turn/end')
    await seeingDriver.stop()
  })

  it('cancels through a command, and reports the turn as aborted', async () => {
    // This child keeps the run open until it is aborted, which is the case a cancel
    // exists for.
    const fake = fakePi({ input: 'text', settle: 'onAbort' })
    const driver = driverFor(fake)

    const collected = await collect(driver, async () => {
      await driver.prompt('s1', '你好')
      await driver.cancel('s1')
    })

    expect(commands(fake).map((command) => command['type'])).toContain('abort')
    expect(collected.frames.at(-1)?.data).toMatchObject({ reason: { kind: 'aborted' } })
    await driver.stop()
  })

  it('reports a turn that reasoned but never answered as a failure', async () => {
    // The fake always streams a thinking delta, so this is the "thought, then
    // stopped" case: an answer bubble with nothing in it would be a lie.
    const fake = fakePi({ input: 'text', reply: '' })
    const driver = driverFor(fake)

    const collected = await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    const end = collected.frames.at(-1)
    expect(end?.type).toBe('turn/end')
    expect(JSON.stringify(end?.data)).toContain('只给出了思考')
    await driver.stop()
  })

  it('shuts its children down and reports what this machine can run', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    expect(driver.status().state).toBe('ready')
    expect(driver.status().binary).toBe(fake.script)

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    await driver.stop()
    expect(commands(fake).map((command) => command['type'])).toContain('shutdown')
  })

  it("offers Pi's own catalogue and switches a running conversation to it", async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    // Before the conversation has run, the list is Pi's and nothing is chosen.
    expect(await driver.models('s1')).toEqual({
      models: [
        {
          id: 'fake/fake-1',
          label: 'Fake Model',
          provider: 'fake',
          images: false,
          contextWindow: 1000,
          // Only the levels the provider actually maps are offered; the nulls buy
          // nothing, and offering them would promise thinking that never happens.
          efforts: ['low', 'high', 'max'],
        },
        {
          id: 'fake/vision-1',
          label: 'Vision Model',
          provider: 'fake',
          images: true,
          contextWindow: 2000,
          efforts: null,
        },
      ],
      activeId: null,
      activeEffort: null,
    })

    // Selecting on a live child is a command, not a restart.
    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    await driver.selectModel('s1', 'fake/vision-1')

    const setModel = commands(fake).find((command) => command['type'] === 'set_model')
    expect(setModel).toMatchObject({ provider: 'fake', modelId: 'vision-1' })
    expect((await driver.models('s1')).activeId).toBe('fake/vision-1')
    await driver.stop()
  })

  it('remembers a choice made before the conversation started', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await driver.selectModel('s1', 'fake/vision-1')
    expect((await driver.models('s1')).activeId).toBe('fake/vision-1')

    // The next child is started on that model, so the picker means the same thing
    // whether or not a process happens to be running.
    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    // The catalogue query runs in its own child, so look for the conversation's.
    const started = commands(fake)
      .filter((command) => command['type'] === 'argv')
      .map((command) => command['argv'])
      .find((argv): argv is string[] => Array.isArray(argv) && argv.includes('--provider'))
    expect(started).toEqual(expect.arrayContaining(['--provider', 'fake', '--model', 'vision-1']))
    await driver.stop()
  })

  it("forks at a question and hands back the branch's own session", async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    const forked = await driver.fork('s1', { id: 'entry-1' })
    expect(forked).toBe('pi-forked')
    const command = commands(fake).find((entry) => entry['type'] === 'fork')
    expect(command?.['entryId']).toBe('entry-1')

    // The child became the branch, so it is kept rather than restarted: adopting the
    // branch gives it the live process, and its history is the fork's own.
    expect(commands(fake).map((entry) => entry['type'])).not.toContain('shutdown')
    driver.adopt('s2', 'pi-forked')
    expect(
      (await driver.historyPage('s2', 50, 0)).messages.map((row) => [row.role, row.text]),
    ).toEqual([
      ['user', '你好'],
      ['assistant', '等于 2'],
    ])
    await driver.stop()
  })

  it('takes the newest question when no message was picked', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    await driver.fork('s1')

    expect(commands(fake).find((entry) => entry['type'] === 'fork')?.['entryId']).toBe('entry-1')
  })

  it('names the question it just stored, so a fresh turn can be branched from', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    const collected = await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    const end = collected.frames.at(-1)
    expect(end?.type).toBe('turn/end')
    expect(end?.data).toMatchObject({ forkId: 'entry-1' })
  })

  it('starts the child with the guard extension when one is available', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = new PiRpcDriver({
      userData: fake.userData,
      script: fake.script,
      runtime: process.execPath,
      resolveCwd: () => Promise.resolve(fake.userData),
      guardExtension: () => '/tmp/pictor-guard.mjs',
    })

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    const started = commands(fake)
      .filter((command) => command['type'] === 'argv')
      .map((command) => command['argv'])
      .find((argv): argv is string[] => Array.isArray(argv) && argv.includes('--extension'))
    expect(started).toEqual(expect.arrayContaining(['--extension', '/tmp/pictor-guard.mjs']))
    await driver.stop()
  })

  it('sets the thinking level and reports the one Pi is running', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    // Pi reports its own level; that is what the picker shows until someone changes it.
    expect((await driver.models('s1')).activeEffort).toBe('high')

    await driver.setEffort('s1', 'max')
    expect(commands(fake).find((entry) => entry['type'] === 'set_thinking_level')).toMatchObject({
      level: 'max',
    })
    expect((await driver.models('s1')).activeEffort).toBe('max')

    // A level chosen before the conversation runs is remembered for its first turn.
    await driver.setEffort('s2', 'low')
    expect((await driver.models('s2')).activeEffort).toBe('low')
    await driver.stop()
  })

  it('keeps the level Pi clamps to instead of the one that was asked for', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })
    // The model maps low/high/max, so Pi answers a request for medium with a level it
    // has; that answer is what the picker shows and what a restart comes back to.
    await driver.setEffort('s1', 'medium')
    expect((await driver.models('s1')).activeEffort).toBe('low')
    await driver.stop()
  })

  it('starts a fresh conversation on its recorded level', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await driver.setEffort('s1', 'max')
    await collect(driver, async () => {
      await driver.prompt('s1', '你好')
    })

    const started = commands(fake)
      .filter((command) => command['type'] === 'argv')
      .map((command) => command['argv'])
      .find((argv): argv is string[] => Array.isArray(argv) && argv.includes('--thinking'))
    expect(started).toEqual(expect.arrayContaining(['--thinking', 'max']))
    await driver.stop()
  })

  it('turns one of Pi’s dialogs into an approval and answers it', async () => {
    const fake = fakePi({ input: 'text', ask: true })
    const driver = driverFor(fake)
    const approvals: Record<string, unknown>[] = []
    let shown: () => void = () => undefined
    const asked = new Promise<void>((resolve) => {
      shown = resolve
    })
    driver.onNotification((notification: HarnessNotification) => {
      if (notification.method !== 'approval.request') return
      approvals.push(notification.params as Record<string, unknown>)
      shown()
    })

    // The turn only closes once the dialog is answered, so the collected frames are
    // also the proof that the answer reached Pi's side.
    const collected = await collect(driver, async () => {
      await driver.prompt('s1', '你好')
      await asked
      // The card needs to know which conversation is blocked, and Pi's own dialog
      // words are what it shows: Pictor does not re-describe the call.
      expect(approvals).toEqual([
        {
          eventId: 'dlg-1',
          agentId: null,
          tool: 'bash',
          reason: '这个会话设置为「改动型工具先问我」',
          sessionId: 's1',
        },
      ])
      await driver.answerApproval('dlg-1', true)
    })

    // Allowing resumed the call: the tool Pi was holding ran.
    expect(typesOf(collected)).toEqual(expect.arrayContaining(['turn/end']))
    expect(commands(fake).find((entry) => entry['type'] === 'extension_ui_response')).toMatchObject(
      {
        id: 'dlg-1',
        confirmed: true,
      },
    )
    await driver.stop()
  })

  it('refuses an approval it did not ask for', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    await expect(driver.answerApproval('别人的问句', true)).rejects.toThrow(/不属于 Pi 内核/)
    await driver.stop()
  })

  it('starts the next conversation on the approval mode last chosen', async () => {
    const fake = fakePi({ input: 'text' })
    const driver = driverFor(fake)

    // Nothing chosen yet: a conversation runs its calls without asking.
    expect(driver.approvalMode('s1')).toBe('never')
    driver.setApprovalMode('s1', 'mutating')
    expect(driver.approvalMode('s1')).toBe('mutating')
    // A conversation that never chose follows the last choice rather than resetting.
    expect(driver.approvalMode('s2')).toBe('mutating')
    await driver.stop()

    // And the choice outlives the app, so reopening does not quietly stop asking.
    const reopened = driverFor(fake)
    await reopened.start(fake.userData)
    expect(reopened.approvalMode('s1')).toBe('mutating')
    await reopened.stop()
  })

  it('says so instead of pretending when Pi cannot answer', async () => {
    const driver = new PiRpcDriver({
      userData: mkdtempSync(join(tmpdir(), 'pictor-pi-none-')),
      script: join('/', 'definitely', 'not', 'pi.js'),
      resolveCwd: () => Promise.resolve('/tmp'),
    })

    expect(driver.status()).toMatchObject({ state: 'error', binary: null })
    await expect(driver.prompt('s1', '你好')).rejects.toThrow(/没有找到 pi/)
  })
})
