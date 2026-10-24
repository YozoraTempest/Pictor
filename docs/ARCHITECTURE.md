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

`ApplicationHost` registers core commands and exposes `list()`/`execute()`.
Plugin commands are registered into the same engine after activation, so callers
do not distinguish their origin.

Plugin lifecycle: discovery -> manifest validation -> engine check -> dependency
resolution -> topological order -> activation -> reverse disposal. Failures are
isolated per plugin and surfaced in the plugin report.

### Runtime (dsh)

`apps/desktop/src/main/harness-service.ts` owns the runtime lifecycle, and
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

### Chat

The runtime is the only owner of a transcript; the renderer does not care how it
speaks:

- `apps/desktop/src/main/harness-history.ts` projects runtime events into
  transcript rows and paginates from the newest message backwards.
- Every conversation belongs to the runtime. `chat.open` always answers with a
  `harness:` path, and an unready runtime yields an empty page the window explains
  rather than a second engine: sending a message while it is down is refused, so a
  turn can never land somewhere the next boot cannot read. `sessions.pi_session_id`
  survives from the pre-runtime layout and is never written; nothing reads it.
- The app keeps `pictorId -> runtimeId` in `<DSH_HOME>/pictor-sessions.json`. A
  miss means the runtime never created that conversation, so there is no history
  to subscribe to.
- Branching is `session/fork`: the runtime copies the event prefix into a new
  session and returns its id. The app creates the Pictor conversation and adopts
  that id, so the branch opens with the inherited history and then diverges.
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
- Plugin: `plugins/<name>` with `manifest.json`, `src/`, and an esbuild bundle in
  `dist/`. The directory is optional; an empty install simply has no plugins.
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
