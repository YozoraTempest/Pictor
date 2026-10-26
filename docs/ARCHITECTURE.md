# Architecture constraints

This document only records the structure and dependency rules a contributor must
follow. Product direction and decision history live in the maintainer's Trilium
knowledge base.

## Principles

- `ApplicationHost` is the headless application core. It owns commands, events and
  the `MetadataStore` port. It must not import Electron, React, DOM or the
  renderer.
- The Rust `host-core` sidecar is the only writer of SQLite. Node code reaches it
  exclusively through `@pictor/host-client`; no other package opens the database.
- Protocols crossing a process or plugin boundary are serialisable. Plugins only
  receive the public `@pictor/plugin-sdk` surface.
- The renderer sees one narrow bridge. Electron capabilities stay in `main`, and
  the preload exposes no `ipcRenderer`, Node or filesystem object. Sandbox,
  context isolation and `nodeIntegration: false` are mandatory; the preload is
  emitted as CommonJS because sandboxed renderers do not load ESM preloads.
- The agent runtime is a separate process the app owns. `main` configures and
  monitors it; nothing above `main` knows how it speaks.

## Dependency direction

```text
Renderer -> bridge types -> preload -> IPC -> main -> application -> host-client -> racp -> stdio
main -> plugin-host -> plugin-sdk
main -> harness -> dsh (child process: HTTP + WebSocket)
host-core (Rust) -> SQLite
```

Forbidden:

- `packages/shared` importing Node, Electron, React or any concrete package.
- `packages/plugin-sdk` importing `src/`, Electron or React.
- `packages/harness` importing Electron, the renderer or `@pictor/shared` beyond
  type-only imports; it is a transport library and must stay testable with a fake
  socket.
- Renderer importing Electron, Node built-ins or main-process code.
- Any package opening the SQLite file directly.

## Boundaries

### Sidecar

`crates/host-core` speaks newline-delimited JSON-RPC 2.0 on stdin/stdout. stdout
carries frames only; diagnostics go to stderr. Method names are dotted
(`project.add`, `plugin.setEnabled`) and every error maps to a stable code.

### Application and plugins

`ApplicationHost` registers the workbench's own commands and exposes `list()`/`execute()`.
A plugin does not add to that engine: plugin panels are views (below), and a plugin's
capability surfaces are `toolGuards`, `toolHooks`, `toolViews`, `skills` and `kernel`.

Plugin lifecycle: discovery -> manifest validation -> engine check -> dependency
resolution -> topological order -> activation -> reverse disposal. Failures are
isolated per plugin and surfaced in the plugin report.

What a plugin contributes is a **projection** of the host, not a snapshot of it
(`apps/desktop/src/main/plugin-contributions.ts`): panels, the views behind them, tool
presenters, guards, hooks and skills are re-derived whenever `PluginHost.revision()`
changes, and remembered in between. That is what makes installing, removing or switching
off a plugin a live act. It used to be half true — the kernel half mounted immediately
while every list was frozen at launch, so a panel appeared only after a restart and a
guard installed at runtime guarded nothing. The settings switch had the same problem in
reverse: it wrote a record and left the plugin running until the next launch, which made
the row a promise the app did not keep.

### Plugin views

A plugin never ships a component. A `views` contribution answers with a **description** —
`{ blocks: [...] }` — and the renderer draws it with components it owns
(`apps/desktop/src/renderer/src/features/panels/PluginViewPanel.tsx`). A `panels` entry is
therefore only a frame: an id, a title, an icon, and the `view` it shows. A panel naming a
view nobody contributed is reported and dropped at load, so the launcher never offers a row
that opens nothing.

The work is split across the process boundary on purpose. `PluginViews`
(`apps/desktop/src/main/plugin-views.ts`) calls the plugin's `data` in the main process —
where the plugin already lives — under a timeout, and validates the answer with
`parseViewSpec` before anything reaches the window. Two properties follow: a plugin cannot
reach into the renderer, and a shape this build does not know fails the whole view with the
plugin's name in the message rather than dropping a block — a panel that lost half its
content looks like a plugin with less to say than it has.

The vocabulary is closed (`packages/plugin-sdk/src/views.ts`): heading, text, markdown,
list, keyValue, table, code, badge, divider, under `VIEW_LIMITS`. That is a deliberate
ceiling — a contribution the blocks cannot express is a request for a rendering engine, and
the honest answer is that this is not one. A view is read when the panel opens and when the
reader asks for a refresh, never on a timer: freshness a plugin needs it states in `note`,
which is drawn under the blocks, where limitations belong.

### Kernels

A conversation is executed by a kernel, never by Pictor itself. `KernelDriver`
(`packages/kernel-sdk/src/driver.ts`) is the whole contract the rest of the
main process may assume: lifecycle, one turn, history, events, settings,
diagnosis. `KernelRouter` (`apps/desktop/src/main/kernel/router.ts`) sends each call to the kernel that
owns the conversation and **never falls back**: history sent to a kernel that
never produced it would be a lie about where it came from.

### How a kernel is mounted

Every kernel is a **cordis plugin** that provides exactly one service named
`kernel.<id>` (`apps/desktop/src/main/kernel/host.ts`). Adding a kernel is adding a
plugin: the built-in ones are `@pictor/kernel-dsh` and `@pictor/kernel-pi`, and an
installed one is a package under `<profile>/plugins` — either a copied directory or a
package in its `node_modules`, named by `installed.json`. A plugin points at its kernel
from `pictor.contributes` (`{ point: 'kernel', value: { main } }`); `package.json`'s
`main` is the UI entry and has nothing to do with the kernel. `startKernelHost` mounts
them in order, watches `internal/service` for the services they publish, and hands the
resulting map to `KernelRouter` — nothing enumerates plugins by hand.

A kernel is its own package. `@pictor/kernel-dsh` and `@pictor/kernel-pi` contain the
driver and its helpers; `@pictor/kernel-sdk` contains what they compile against — the
driver interface, `KernelPlugin`/`KernelEntry`, the host services a plugin may inject,
and the kernel-facing types (`HarnessStatus`, `PermissionMode`, `KernelCapabilities`,
`KernelModel*`). A kernel package may depend on the SDK and on `@pictor/shared`, and on
nothing else in this repository; the app's `bridge.ts` re-exports the types from the SDK
so the window still imports one module.

Both halves arrive as a `KernelEntry` — "something that can hand over a plugin" — so
one `mount()` covers them: a built-in is a closure in this bundle (`{ load: async () =>
dshKernel }`) and an installed kernel is a module imported by path. Turning a built-in
into its own package is then a change of that one closure to an `import()`, not a change
of shape, and a kernel that fails to load fails alone with its reason on the settings
page.

The map is **live**. `KernelHost.mountInstalled` starts one more plugin and
`unmount` disposes its fiber, so installing a kernel does not need a restart and
removing one takes it out of the picker at once. The two steps are kept apart on
purpose (`kernel/installer.ts` owns the disk, the host owns the mount): a copy that
succeeds and a mount that fails is a kernel on disk with a reason attached, which the
settings page shows, rather than a rollback that hides what went wrong.

`installed.json` exists because the package manager owns `node_modules` and drags in
dependencies with it; only the names a person actually installed are plugins.

What a plugin may reach is a service, and the `inject` list it declares is the
sentence the settings page shows a person: `pictor.models`, `pictor.rules`,
`pictor.guard`, `pictor.permission`, `pictor.workspace`, `pictor.userdata`,
`pictor.settings`. A capability declared `true` with no method behind it is refused at
mount time, so the window never draws a control the kernel cannot answer.
`pictor.models` includes the running service's key — a kernel cannot take a turn
without it — which is why installing one asks first.

`pictor.settings` is what makes a kernel's own switch the kernel's business: it reads
a snapshot of the profile's settings, and it writes back through the same store, so a
plugin that declares a setting can remember it itself. The app that assembles the
kernels never spells out those keys. That snapshot is refreshed by every write the app
makes (`kernel/settings-store.ts`), not only by the kernels' own, so a page that saves
a value never leaves a kernel reporting the previous one.

The container is deliberately **in the main process only**. The runtime stays a child
process: cordis has no cross-process semantics, and the tool-guard bridge is only
fail-closed because the kernel lives on the other side of it.

Two kernels ship:

- **dsh** (`packages/kernel-dsh`) — the default, and the one the rest of this
  section describes: a server process booted with a profile Pictor owns.
- **Pi** (`packages/kernel-pi`) — an RPC child per conversation: `pi --mode
rpc` speaks JSONL commands on stdin and streams the same events over stdout,
  translated by `packages/kernel-pi/src/pi-events.ts` into the durable events and chunks the window
  already renders. The child runs on **this process's own runtime**
  (`ELECTRON_RUN_AS_NODE`), not on whatever `node` PATH offers: Pi needs Node 22.19
  or newer and a desktop app cannot assume the machine has it. Images travel as
  content parts, and a model that cannot see them is refused by name before the
  turn is spent. It branches conversations at a user message's entry id, and it
  answers for its own model catalogue (`KernelModelSource`). Its tool calls go
  through the same guard chain as dsh's: Pictor writes a Pi extension
  (`packages/kernel-pi/src/pi-guard-extension.ts`) that asks the loopback bridge about every call and
  blocks it when a rule or a plugin guard says so, failing closed when the bridge
  cannot be reached. It has no sandbox of its own, so _when_ a call waits for a
  person is Pictor's decision there (`KernelApprovalSource`): a per-conversation
  mode plus `ask` rules in the tool policy, carried out through Pi's own dialog
  (`ctx.ui.confirm`), which is what keeps timeouts, cancellation and parallel
  calls Pi's business. A conversation can also remember "not this tool again",
  which it can forget again from the same switch. Pi's other dialogs (`select`,
  `input`, `editor`) become the question card — options, free text, and a seeded
  multi-line field for a draft someone is meant to change — and since Pi ships no
  model-facing asking tool, that extension registers `ask_user_question` under
  dsh's name, `draft` included — so a Pi conversation can ask, not only answer.
  `notify` is the one fire-and-forget request a GUI has a place for: it becomes the
  banner, marked with the kernel that sent it. The rest (`setStatus`, `setWidget`,
  `setTitle`, a custom terminal component) describe a terminal's own surface, so
  they are neither drawn nor answered — Pi keeps no pending entry for them, and
  `custom` does not exist in RPC mode at all. What it still cannot express is a
  per-conversation sandbox; it declares none instead of faking one. Its
  transcript is read back from Pi's own session file (`packages/kernel-pi/src/pi-history.ts`),
  because Pictor keeps none.

Each driver also declares what it can do (`KernelCapabilities`: sandbox, approval,
model, skills, fork, commands, jobs), and that declaration reaches the renderer with
`kernels.list`. The composer draws a control only where the conversation's kernel
says it exists: a CLI kernel gets no sandbox switch and no model picker, instead
of a control that throws when pressed. The approval switch follows the same rule:
dsh decides for itself when to ask, so it draws no such switch, and a kernel that
hands the decision over draws one.

Who answers that "when" question is the conversation's own kernel
(`KernelRouter.guardApprovalMode` / `guardIsGranted`), asked per call by the guard
bridge: a kernel that decides for itself — dsh — answers `never`, because its own
policy already decided to hold the call, and only a `deny`/`ask` rule can hold one of
its calls from outside. Naming a kernel there instead is how the guard used to end up
asking Pi about dsh's conversations.

Pictor also hands its own services to Pi. The same loopback bridge that answers the
guard also answers "what can I run": the extension calls
`pi.registerProvider(name, { baseUrl, apiKey, models })` for each configured
provider, so one address, key and model list serves both kernels instead of being
typed twice. Keys travel over that socket and are never written into the extension
file, which lives on disk with the profile. What Pictor supplies is what it knows:
`input` stays `text` unless the model declared otherwise, and `thinkingLevelMap` is
left out entirely when the levels were never declared, so Pi keeps applying its own
default rather than a map invented here. Editing a service invalidates Pi's cached
catalogue, so the picker shows the new list without a restart.

Inside Pictor, Pi is pointed at a configuration directory of its own
(`<profile>/pi-home`, via `PI_CODING_AGENT_DIR`), so it sees exactly the providers
Pictor registered and nothing from `~/.pi/agent`: no second copy of the same
service, no models Pictor cannot offer. A conversation that had picked one of Pi's
own models is pruned at boot rather than left failing to start. The one way out is
the switch on the Pi runtime page — Pi then brings its own services, keys and
extensions, which is the only way to keep using those, at the cost of two lists
that differ again.

The MCP list is rendered into that directory too (`pi-home/mcp.json`, written before
each spawn), because Pi reads a file while dsh reads a patch: one list on the page,
two translations, and neither kernel learns about the other's format. With isolation
off, `~/.pi/agent/mcp.json` is the person's file and Pictor does not touch it.

A kernel may also own a setting rather than only read one: Pi's "run on my own
configuration" means nothing to dsh. It declares it as a `KernelSetting` — key,
label, description, and a `hint` for what the current value means — the host
collects whatever the mounted kernels declare, and the runtime page draws those
rows without knowing which kernel they belong to. Pictor persists the key and
hands the write to the kernel that declared it; a key nobody owns comes back
`false` rather than looking like it worked.

A kernel that brings its own models declares it (`KernelModelSource`), and
`kernels.list` says whose list the picker should show: `pictor` for a kernel
booted with Pictor's providers, `kernel` for one that answers for its own
catalogue. The composer draws one picker or the other, never both — a list that
is not the conversation's list is the same lie as a control the kernel cannot
honour.

The rail is **derived** from `kernels.list()`, not written by hand: `viewsFor()`
(`app/views.tsx`) builds home, one page per mounted kernel, and settings, and a page
is named after the kernel it holds (`kernel:<id>`, `app/kernel-scope.ts`). Turning a
kernel off takes its page away and installing one adds a page, both without an edit; a
kernel the build has never heard of still gets a page, an icon it borrows and a number
(`Ctrl+2…`), which is what makes "adding a kernel is adding a directory" true in the
window and not only in the container.

A kernel page lists only that kernel's conversations, filters the
project rows to the ones that hold one, draws only the sections that hold one,
opens a conversation of its own kernel instead of keeping the previous one, and
draws the kernel picker only for an open conversation — moving it to another kernel
is a branch, so the control is the branch. Home draws no list at all: it opens on a
draft, offers the choice of kernel, and is where a conversation starts. A list of
every kernel's conversations would have to describe runtimes that disagree about
almost everything, so the list belongs to the page that has one answer.

The kernel is fixed when a conversation is created (`sessions.kernel_id`), so the
picker opens a branch on the other kernel rather than rewriting one in place.
Lifecycle calls carry no session id and stay on the default kernel.

### Commands and compaction

A `/` menu holds two different things, and they are not interchangeable: a skill is
text the runtime injects into a turn, while a command is a lever only the kernel can
pull. `KernelCommandSource` (`packages/kernel-sdk/src/command-source.ts`) is the
second of them — `commands(sessionId)` lists what the conversation's kernel offers,
`runCommand(sessionId, line)` hands the whole line back. The kernel parses its own
arguments, because nothing here knows that `goal` takes a sentence and `compact` does
not. The composer lists commands before skills and sends a line as a turn only when
no command matches (`commandLineOf`), so `/compact` cannot reach a model as prose.

- **dsh** answers from the runtime's own service: `commands/list` and
  `commands/execute` over the same remote wire `/permission` already uses
  (`packages/kernel-dsh/src/harness-commands.ts`). The menu draws what it is given —
  `compact`, `export`, `feedback`, `goal`, `permission`, `plan` today — rather than a
  list kept here, so a runtime that adds one needs no release here.
- **Pi** offers exactly one, `compact`, and the rest of its terminal's slashes are not
  reachable over RPC; the menu says so by not listing them.

Both declare `commands: true`, and a kernel that declares it with no methods behind it
is refused at mount time.

A compaction is shown, not suffered. Replacing older context emits `run.compacted`,
and each kernel's history reader emits the same row on reload, so a reopened
conversation still says where its detail went. The row is a divider — never merged
into an answer — carrying the saving the kernel reported (`shadowedTokenCount` on dsh,
`tokensBefore - estimatedTokensAfter` on Pi) and the summary behind "查看摘要". Only a
summary draws one: dsh prunes each large tool result on its own, and a divider per
prune would bury the conversation.

### The tool bridge

One loopback socket carries two questions about a tool call, because they are about the
same call and a second bridge would only be a second token to keep in step
(`apps/desktop/src/main/tool-bridge-server.ts`). Each kernel gets a generated plugin in
its profile that asks — dsh through `tools/pre-execute` and `tools/post-execute`, Pi
through `tool_call` and `tool_result`.

- **Before: guards, fail closed.** `allow | deny`, plus "ask a person" where the caller
  can actually suspend the call (`hold`). dsh's own decision type is
  `allow | deny | cancel | ask` and excludes input rewriting on purpose, so a contract
  that promised to rewrite arguments would be a promise the kernel this app is built
  around cannot keep. A bridge that cannot be reached refuses the call.
- **After: hooks, fail open.** A hook sees the finished call (`tool`, `args`, `session`,
  `ok`, a clipped `output`) and may return a `note` — appended to what the model reads,
  prefixed with the hook's id — or a `fail`, which replaces the outcome with an error that
  still carries what the tool printed. Hook text is always attributed, because a
  transcript that reads as the tool's own words is making a claim about the tool. A hook
  that throws costs its own contribution: it cannot grant or deny, so its absence changes
  nothing about safety, and failing it closed would let an observation break a
  conversation.

A tool name is written either exactly (`mcp__github__create_issue`) or as a prefix ending
in `*` (`mcp__github__*`); one matcher (`packages/plugin-sdk/src/tool-pattern.ts`) serves
guards, hooks and views, so a guard and its view cannot disagree about which tool they
describe. Views match at render time (`registerToolView`), which is what lets a plugin
describe a namespace before any server has enumerated it; an exact name beats a prefix,
and a longer prefix beats a shorter one.

### Current state

Three things a conversation _is_ ride above the composer rather than in the transcript:
the agent's task list, plan mode, and the background jobs. None of them is history. A
transcript accumulates rows; these three are replaced wholesale, so the newest snapshot
is the whole truth and a reload has to land on the same answer (`ChatHistoryPage`
carries `todos`, `plan` and `jobs`; absent means the kernel keeps none of them, which is
why a Pi conversation draws no bar at all).

- **Replayed, never stored.** `sessionStates()` (`packages/kernel-dsh/src/harness-session-state.ts`)
  reads the same durable events the live stream carries — `todo/write` is last-write-wins,
  `plan/mode` is the mode, `job/registered` and `job/settled` are a roster keyed by id —
  so a reopened conversation and a running one are computed by one function.
- **Plan mode needs three events.** The runtime changes its own mode by running a `plan`
  command, and that command is in flight between `command/run` and `command/done`. A
  `plan.changed` event may therefore say nothing about the mode (`active: null`) and only
  report `pending`, because flipping the badge before the runtime agrees would be a
  promise it has not made.
- **The roster is asked, not remembered.** `jobs(sessionId)` opens `job/list` and takes
  its opening frame — the runtime documents it as the complete set — through
  `streamOnce` (`packages/harness/src/once.ts`), then hangs up. That is what
  reconciliation means here: a job whose runtime died between its registration and its
  settlement would otherwise keep claiming to run forever, so `mergeJobs` closes anything
  the live roster no longer names and says so in its own words.
- **Only the stop is a capability.** `capabilities.jobs` guards `killJob`; without it the
  roster is still drawn, because the runtime said the job is running and hiding it would
  be the lie. `job/kill` is fenced on the session that can see the job, and it answers
  `requested` or `already-finished` — a second click is not an error.
- **Job output is read, not tailed.** `jobOutput()` opens `job/follow`, which answers with
  an `opened` anchor, a run of `output` batches, and — only once the job settles and its
  ring drains — a terminal `status`. A running job's stream never ends, so the read takes
  what arrives within a budget (`streamCollect`) and reports `partial`: "so far" is a
  different answer from "finished", and the window says which. Chunks keep the stream they
  came from (`stdout`, `stderr`, the producer's `log`), because merging them would erase
  the one distinction a reader needs after a failure; a non-zero start offset, a `lossy`
  batch or a marked gap all set `lossy`, so a tail is never presented as the beginning.
- **A subagent is a link, not a row.** The runtime records a delegation in the _parent_
  as a `subagent/catalog` discovery fact — `{childId, label, mode}` — and the child is a
  session of its own. So the bar lists who was started, and the steps are read from that
  session on demand (`childTranscript`), shown in a dialog: drawing them inline would
  claim this conversation said them. A child is only addressable through its parent
  ("subagent Sessions require their durable parent address"), which is why the mode the
  catalog reported travels with the read, and why an `external` child — one with no local
  log — gets no "查看步骤" control at all.

### Runtime (dsh)

`packages/kernel-dsh/src/dsh-driver.ts` owns the runtime lifecycle, and
`@pictor/harness` owns the wire protocol.

- **Boot.** The runtime is spawned from `<userData>/harness-runtime` with
  `DSH_HOME` pointing at a profile this app owns. It prints an origin with an
  access token on stdout; the service waits for it, exchanges the token for a
  cookie, and only then reports `ready`.
- **Profile.** `harness-profile.ts` builds the patch text; the service writes it
  on every boot. The patch is a projection of the settings page, never edited by
  hand, and it is written as JSON because YAML is a superset of it — provider
  names and URLs then need no quoting rules of their own.
- **Routes.** One route named `pictor` carries the active service: its `api`
  (wire protocol), `baseURL`, `apiKeyEnv` and `models`. The route's protocol is
  the settings value; the runtime decides how to shape the request, so nothing
  here rewrites a URL.
- **Transport.** Unary calls are `POST /api/<endpoint>` with a
  `{type: 'client-request', rpcId, method, payload: {args}}` envelope. The live
  transcript is a WebSocket subscription on `/api/remote.mux`; the first item is a
  complete snapshot and later items are durable events in order, so reconnecting
  is "open a new stream", not "resume a cursor".
- **State.** `HarnessChatBridge` translates runtime traffic into the events the
  renderer already understands. Session ids are normalised back to Pictor's ids at
  this boundary so a notification reaches the right conversation.
- **Events.** `$events` is a second stream on the same mux, and the only channel
  that carries questions the runtime needs a client to answer. The gateway greets
  it with a `clientId`; every answer quotes that id plus the request's `eventId`.
- **Process failures.** A runtime that exits marks the status `error` with the
  tail of its stderr; the settings page is the only place that starts and stops
  it.
- **Tool servers.** Every enabled MCP server on the settings page becomes one
  `@deepseek-ai/dsh-mcp-client` instance inserted into that patch — stdio carries
  `command`/`args`/`env` with `failOnStartupError: false`, http carries the endpoint
  and its headers. The list is part of the boot fingerprint, so an edit reboots the
  runtime, and `applySettings()` waits for a running turn instead of cutting it. A
  server that will not start costs its own tools, not the runtime.
- **Stopping is not instant.** `stop()` only sends the signal; the process keeps
  its home — profile, session log, plugin directory — until it exits. `start()`
  therefore waits for the previous child (up to 4 s, after the 3 s SIGKILL
  fallback) before booting, so "stop, then start" never runs two runtimes over one
  home.

### Chat

The kernel is the only owner of a transcript; Pictor keeps no second copy, and the
renderer does not care how a kernel speaks:

- `packages/kernel-dsh/src/harness-history.ts` projects runtime events into
  transcript rows and paginates from the newest message backwards.
- Every conversation belongs to the kernel recorded on it. `chat.open`,
  `chat.send`, `chat.stop` and `session.fork` ask `KernelRouter.statusOf(sessionId)`
  for that kernel's state — lifecycle used to belong to one process, and asking the
  default kernel instead would refuse a turn that could run. An unready kernel yields
  an empty page the window explains rather than a second engine: sending a message
  while it is down is refused, so a turn can never land somewhere the next boot
  cannot read. `sessions.pi_session_id` survives from the pre-kernel layout and is
  never written; nothing reads it.
- The app keeps `pictorId -> runtimeId` in `<DSH_HOME>/pictor-sessions.json`. A
  miss means the runtime never created that conversation, so there is no history
  to subscribe to.
- Branching is `session/fork`: the runtime copies the event prefix into a new
  session and returns its id. The app creates the Pictor conversation and adopts
  that id, so the branch opens with the inherited history and then diverges.
- **Rewind is a branch plus a judgement.** The log is append-only and there is no
  `session/rewind`, so 回到这里 forks at the boundary before a turn and archives the
  conversation that was left (`session.rewind` in the main process does both, in that
  order). Archiving is the judgement — the old tail is not deleted, it is filed, and
  un-archiving is one click away. Files are never restored: `dsh-session-checkpoint-policy`
  makes the _log_ durable before a request, not the workspace, so a confirmation that
  promised file rollback would be inventing a feature. A branch that exists with an
  archive that failed reports `archived: false` instead of undoing the branch.
- The cut is an inclusive event `seq`, and the runtime copies whole turns. A
  message therefore carries the boundary it forks at: an answer keeps its own
  event, a question keeps where the _previous_ turn ended (that is what re-asking
  means). History rows carry their seq from the log; a row the window streamed
  learns it from `turn/start` and `turn/end` on the event bridge.
- The tree is Pictor's own: `sessions.parent_id` plus a pure `familyTree`, drawn
  in a dialog. The runtime knows the prefix, not the family.
- `sessions.parent_id` records what a branch was copied from. It lives in Pictor,
  not the runtime: the runtime hands back a new session id with no lineage, and
  only the app knows which conversations are related. The column is
  `ON DELETE SET NULL`, because deleting a parent must not remove its branches.
- The runtime names a conversation after its first prompt (`session/title`: a
  fallback first, the generated name later). `main` adopts it while the row still
  carries Pictor's placeholder, and keeps replacing names the runtime itself
  produced; a title a person typed is never touched. The sidebar refreshes on
  `pictor:workspace.changed`.
- Events are normalised in `main` and forwarded to the renderer over one IPC
  channel (`pictor:chat.event`). Runtime status travels on its own channel
  (`pictor:harness.status`) so a window can re-read a transcript that was opened
  before the runtime was up.
- Tool approval is a seam, not a policy. The request arrives as an
  `approval/request` waterfall on the application event stream, and the app answers
  it over `$events/result`; a request nobody answers settles as `unavailable`. It is
  only raised by an _escalation_: the sandbox denies a write outside the workspace,
  the tool reports that a wider retry is available, and the retry that names
  `sandbox_permissions` + `justification` becomes the question. A plain out-of-policy
  call is simply denied, which is why the card can never appear for it.
- Images ride beside the text as content parts and are refused by the runtime for a
  model that did not declare image input. That capability lives on the model entry
  and is declared in the service dialog (图片输入 / 推理 / 上下文窗口 / 最大输出),
  because almost no endpoint reports it. `fetchModels` takes what an endpoint
  volunteers and leaves the rest `null` — "unknown" stays distinct from "text
  only" — and refreshing a listing merges by id, so what a person typed survives.
- 试运行 runs one throwaway turn through the runtime (`HarnessService.probe`)
  instead of a second client, so the check a user runs proves the path a
  conversation takes. The probe session is never registered with Pictor.

### Model configuration

`@pictor/model-config` owns the settings contract:

- `ModelProtocol` uses the runtime's own vocabulary (`openai-completions`,
  `openai-responses`, `anthropic-messages`), so a saved service reaches the kernel
  without a translation table.
- Non-secret values go through `MetadataStore` into SQLite under the `pi.*` keys,
  a namespace kept from the first layout.
- `auth.json` holds keys per service with `0600` permissions; only the main
  process reads it, and the bridge exposes `hasApiKey` instead of the value.
- Keys are stored per service, so several services can be configured at once.
  Choosing a model in the composer is a (service, model) pair — `useModel` writes
  both in one go, so a switch restarts the runtime once on the service that was
  picked rather than twice with the previous model in between.
- The runtime receives its key in `PICTOR_LLM_API_KEY` at boot and resolves it per
  request, so the secret never lands in the profile patch.
- The app pins one runtime version (`RUNTIME_PACKAGE`). `HarnessStatus` reports the
  version the launcher on disk declares next to the pinned one, and the runtime page
  says which of the two it is looking at: `unknown` when the launcher is a hand-
  pointed checkout without a readable manifest, so nobody is nagged about a version
  they chose themselves.
- The runtime reads its route, model, key and sandbox mode once, at boot, so a
  saved change restarts it (`HarnessService.applySettings`) instead of waiting for
  someone to press a button. A fingerprint of those four values decides whether a
  restart is needed at all, and a turn that is already streaming is never cut: the
  change waits for `turn/end` and lands before the next message.
- cc-switch access is read-only and implemented in Rust (`ccswitch.scan` /
  `ccswitch.read`); the scan response never contains a key.

### Storage

SQLite holds projects, sessions, plugin records and settings. Conversation
transcripts do not live there: the runtime owns its own session log and is the
only place a transcript is read from.

## Adding code

- Headless feature: `packages/<feature>/src`, exported through its `index.ts`.
- Plugin: `plugins/<name>` with a `package.json` whose `pictor` field carries the
  manifest, `src/`, and an esbuild bundle in `dist/`. The directory is optional; an
  empty install simply has no plugins. See `plugins/README.md`.
- Panel contribution: `contributes('panels', { id, title, command })` adds one
  entry to the side panel. Panels are data only — opening one runs a command, so
  plugins never ship renderer code. `tools` is reserved for the agent-facing
  capability surface; an agent tool may open a panel, but a panel is not a tool.
- Tool guard: `contributes('toolGuards', { id, tools?, decide })` polices agent
  tool calls before they run. Guards run in contribution order, the first deny
  wins, and a guard that throws fails closed.
  The app writes a small package into the profile (`node_modules/pictor-guard`) and mounts
  it with `{ insert: [...] }` — a user-layer entry without `insert` is read as a
  patch to an existing id and the plugin silently never loads. The plugin asks
  `ToolGuardServer` over loopback for every `tools/pre-execute` call and turns the
  answer into a `deny` gate; an unreachable bridge denies, because a guard that
  cannot be consulted fails closed.
- A new wire protocol: add it to `ModelProtocol`, teach the connection probe its
  endpoint and headers, and let the patch generator pass it through. Nothing else
  in the app needs to know.
- Tests sit next to the implementation as `*.test.ts`; cross-module behaviour is
  tested through the public seam (client, engine, plugin host, patch builder).
