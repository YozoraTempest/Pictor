/**
 * One turn, as every kernel adapter reports it.
 *
 * The names mirror `ChatEvent` in `@vulonlok/shared`, so an adapter that works here
 * is already shaped for the main process: `run.started` opens a turn, deltas
 * arrive in order, tools bracket their call, and exactly one `run.finished`
 * closes it.
 */

/** @typedef {{ type: 'run.started', sessionId: string | null }} RunStarted */
/** @typedef {{ type: 'text.delta', text: string }} TextDelta */
/** @typedef {{ type: 'thinking.delta', text: string }} ThinkingDelta */
/** @typedef {{ type: 'tool.start', callId: string | null, tool: string, input: unknown }} ToolStart */
/** @typedef {{ type: 'tool.finished', callId: string | null, output: string, isError: boolean }} ToolFinished */
/** @typedef {{ type: 'usage', input: number | null, output: number | null, total: number | null }} Usage */
/** @typedef {{ type: 'run.finished', ok: boolean, error?: string }} RunFinished */
/** @typedef {{ type: 'notice', message: string }} Notice */

/**
 * @typedef {RunStarted | TextDelta | ThinkingDelta | ToolStart | ToolFinished | Usage | RunFinished | Notice} KernelEvent
 */

/**
 * A kernel is a coding agent this app can drive.
 *
 * Only four things have to line up for one to be usable: it can be started, a
 * message can be handed to it, it reports what happened as it goes, and the turn
 * can end. Everything else — how it authenticates, whether it keeps a server
 * alive, what its tools are called — belongs to the adapter.
 *
 * @typedef {object} KernelAdapter
 * @property {string} id                 stable name, e.g. `codex`
 * @property {string} label              how a person would say it
 * @property {KernelCapabilities} capabilities
 * @property {(input: KernelRunInput) => Promise<KernelRunResult>} run
 */

/**
 * What an adapter can offer the interface.
 *
 * A shell around several kernels has to hide what one of them cannot do rather
 * than offering a button that quietly does nothing.
 *
 * @typedef {object} KernelCapabilities
 * @property {boolean} streaming      text arrives incrementally, not only at the end
 * @property {boolean} thinking       the kernel reports reasoning separately
 * @property {boolean} usage          the provider's token counts are reported
 * @property {boolean} approvals      a tool call can wait for a person's decision
 * @property {boolean} questions      the model can ask the user mid-turn
 * @property {boolean} resume         a later turn continues an earlier session
 * @property {boolean} history        past messages can be read back
 * @property {boolean} fork           an existing session can be branched
 */

/**
 * @typedef {object} KernelRunInput
 * @property {string} prompt
 * @property {string} cwd
 * @property {NodeJS.Signals | null} signal  abort to cancel the turn
 * @property {(event: KernelEvent) => void} onEvent
 * @property {string | null} sessionId      continue this session, when supported
 * @property {string | null} model          model override, when supported
 */

/** @typedef {{ ok: boolean, sessionId: string | null, error: string | null }} KernelRunResult */

/** Longest a single line of kernel output may be before the probe gives up on it. */
export const MAX_LINE = 8 * 1024 * 1024
