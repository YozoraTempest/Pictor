# Pictor

Pictor is an agent-native local development environment. This repository is the
new implementation: an Electron shell, a Rust host core that owns SQLite, and a
TypeScript application core shared by every frontend. Agent work runs on
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (dsh), which
the app installs and boots as its runtime.

> Status: runnable app. Projects, sessions, plugins, model services, cc-switch
> import, endpoint probes and a streaming agent chat backed by the dsh runtime
> are implemented. Packaging is not.

## Requirements

- Node.js `22.22.2` or newer (see `.nvmrc`)
- pnpm `10` or newer
- Rust `1.80` or newer with Cargo

## Quick start

```bash
pnpm install
pnpm deps:prepare     # downloads the Electron runtime (once)
pnpm dev              # builds host-core (debug), then starts Electron
```

`pnpm dev` uses the normal per-user profile. `pnpm build` produces the JS bundles
and the release host-core binary.

The agent runtime is installed from inside the app (**Settings › Runtime**); it is
an npm package unpacked into the profile, so no global install is involved.

## Verification

```bash
pnpm verify           # format + typecheck + lint + JS tests + Rust tests
pnpm test:e2e         # end-to-end specs against a built app (needs a display)
pnpm pack:dir         # packaged app in dist/<platform>-unpacked, for a smoke test
pnpm pack:dist        # installer (AppImage / nsis / dmg) in dist/
pnpm test:js
pnpm test:rust
pnpm build
```

`pnpm verify` is the gate used by CI.

> Network note: if `crates.io` is unreachable in your environment, point Cargo at
> a mirror for the session, for example:
> `cargo --config 'source.crates-io.replace-with="mirror"' --config 'source.mirror.registry="sparse+https://rsproxy.cn/index/"' test -p pictor-host-core`

## Layout

```text
apps/desktop/          Electron main, preload and React renderer
crates/host-core/      Rust sidecar: SQLite schema, migrations, NDJSON JSON-RPC
packages/shared/       Serializable domain model and error codes
packages/racp/         NDJSON JSON-RPC framing, client and stdio transport
packages/host-client/  Typed client for the host core
packages/application/  ApplicationHost, Command Engine, Profile lock, events
packages/plugin-sdk/   Manifest, Module and Contribution contract
packages/plugin-host/  Discovery, SemVer resolution, lifecycle, installer
packages/harness/      dsh transport: unary calls, session stream, follow frames
packages/agent-runtime/AgentRuntime contract, Pi adapter, JSONL projection
```

## How it fits together

- `ApplicationHost` is frontend-agnostic. It owns commands and events, and calls
  the `MetadataStore` interface.
- The Rust sidecar is the only owner of SQLite. Electron talks to it over
  newline-delimited JSON-RPC on stdio; `packages/racp` keeps the transport
  swappable for a future WebSocket host.
- Plugins are discovered from `plugins/*`, validated against the SDK manifest,
  resolved with SemVer, activated in dependency order and disposed in reverse.
  A plugin that fails to activate is reported and does not block the others.
- The renderer only sees the narrow `window.pictor` bridge; no Node or Electron
  object crosses the context bridge, and the window runs with sandbox, context
  isolation, no Node integration and a restrictive CSP.

## Runtime

The app does not speak to a model directly. It boots dsh from
`<userData>/harness-runtime`, points it at a profile it owns, and talks to it over
the runtime's own HTTP and WebSocket API.

- **Profile.** `<DSH_HOME>/profiles/pictor` holds a `package.json` (written once;
  the bundle list lives there) and a `cordis.patch.yml`.
- **Patch.** The patch is regenerated on every boot from the settings page: one
  model route named `pictor` carrying the selected wire protocol, its endpoint and
  its models, plus the default model pointing at that route. The DeepSeek-specific
  route is switched off because its protocol cannot be configured.
- **Protocols.** A route declares one of `openai-completions`,
  `openai-responses` or `anthropic-messages`. The protocol decides the request
  shape and the endpoint inside the runtime, so no URL rewriting happens here.
- **Credentials.** The route resolves its key from `PICTOR_LLM_API_KEY` per
  request; the value is injected into the runtime process and never written to the
  patch. `DEEPSEEK_API_KEY` is passed as well because the `web_search` tool reads
  it through its own client.
- **Transport.** Unary calls are `POST /api/<endpoint>`; the live transcript is a
  WebSocket subscription on `/api/remote.mux` (`session/follow`), which replays an
  opening window and then streams.
- **Sessions.** The runtime owns conversation transcripts. The app keeps the
  mapping from its own session ids to runtime ids in
  `<DSH_HOME>/pictor-sessions.json`; a session that ran on Pi (before the runtime
  existed) keeps using its own log.
- **Permissions.** **Settings › Runtime** selects `read-only`,
  `workspace-write` or `danger-full-access`, which reaches the runtime as
  `DSH_PERMISSION_MODE`.
- **Approvals.** The runtime asks before an operation its policy does not cover.
  The app holds that request open in a card beside the composer and answers it
  over the runtime's own event stream, so a tool call can proceed or be refused
  instead of failing closed.

## Chat

Selecting a session opens its transcript and a composer:

- Text streams token by token; the model's reasoning streams into its own
  collapsible row above the answer.
- Images can be pasted or dropped into the composer; they are sent beside the
  text as content blocks and shown in the user's bubble.
- Tool executions appear as rows with a presenter per tool (command and output
  for `bash`, file content for `read`, a diff for `edit`).
- Conversations live in the runtime's log, so an empty panel means one of two
  things: a fresh conversation, or a runtime that is not running. The panel says
  which, and offers to start the runtime instead of claiming the history is gone.
- The transcript is paginated: the newest 50 messages load first and **Load older
  messages** prepends earlier pages. The opening stream window holds 200 messages.
- Several conversations can run at once; each keeps its own transcript and event
  stream.
- **Search** (the magnifier in the title bar, or Ctrl/Cmd+K) opens a palette over
  the home view: it matches conversation titles and project names, lists results
  newest first, and opens the pick on Enter. Archived conversations are included
  and labelled as such, since the sidebar keeps them reachable.
- A session's menu can **branch** it: the runtime copies the history up to its
  latest completed turn into a new session, which then diverges on its own. The
  branch records where it came from — the row carries a branch mark, the title
  says `分支自 …`, and the menu reopens the source.
- **Archiving is reversible**: an archived conversation keeps its menu and offers
  取消归档. Batched archiving (a whole section or project) asks first and names how
  many conversations it will move.
- Tool calls run under the runtime's sandbox policy, and a plugin can tighten it
  with a `toolGuards` guard: the runtime asks the app before every call, guards run
  in order, the first deny wins, and a denied call is shown with its reason.

## Model settings

Open **Settings › Agent › Model**:

- A list of services; each has a name, Base URL, wire protocol, model id and key.
  One is active at a time and is what the runtime boots with.
- **Fetch models** queries `GET <baseUrl>/models`.
- **Test connection** sends one minimal completion in the service's protocol.
- **Import from cc-switch** scans `~/.cc-switch/cc-switch.db` for `app_type = 'pi'`
  providers and adds the picked one as a new service.

Storage rules:

- Non-secret settings live in SQLite (`pi.*` keys).
- The API key is written to `<userData>/auth.json` with `0600` permissions and is
  never returned to the renderer; the UI only sees `hasApiKey`.
- `<userData>/pi/models.json` references the key as `$PICTOR_PROVIDER_API_KEY`;
  the value is injected into the process only for the duration of a run.

Override discovery for tests with `PICTOR_CCSWITCH_DB` (database path) and
`PICTOR_USER_DATA` (profile directory).

## Current scope

Implemented: profile locking, project/session metadata, plugin lifecycle, command
dispatch, multi-service model settings with cc-switch import, endpoint discovery
and connection test, the dsh runtime with in-app installation, three wire
protocols, streaming chat with runtime-owned transcripts and paginated recovery,
reasoning display, three-column shell UI.

Not yet implemented: a session tree (browsing every branch of one conversation in
one view, or branching at an arbitrary message), remote hosts, and
auto-update — installers are produced but nothing checks for a newer release.
Plugin modules run in-process; there is no per-plugin process sandbox yet. `pnpm test:e2e` covers the flows a unit test cannot see, and
sits outside `pnpm verify` because it needs a display and a built app.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
