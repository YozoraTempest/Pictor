# Pictor

Pictor is an agent-native local development environment. This repository is the
new implementation: an Electron shell, a Rust host core that owns SQLite, and a
TypeScript application core shared by every frontend.

> Status: runnable scaffold with a working chat loop. Projects, sessions,
> plugins, model settings, cc-switch import, endpoint probes and a streaming
> agent chat backed by Pi JSONL are implemented.

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

## Verification

```bash
pnpm verify           # format + typecheck + lint + JS tests + Rust tests
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
packages/agent-runtime/AgentRuntime contract, Pi adapter, JSONL projection
plugins/hello-workbench/Bundled reference plugin
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
  object crosses the context bridge, and the window runs with sandbox, context isolation, no Node
  integration and a restrictive CSP.

## Chat

Selecting a session opens its Pi JSONL transcript and a composer:

- Messages stream token by token; tool executions appear as separate rows.
- The transcript is paginated: the newest 50 messages load first and **Load older
  messages** prepends earlier pages.
- One Pi session is active at a time; switching Pictor sessions disposes the
  previous agent and opens the bound JSONL.
- The first open creates `<userData>/pi/sessions/<projectId>/<sessionId>.jsonl`
  and stores its path in the session's `piSessionId` column.
- Tool calls execute with the current user's permissions. A `beforeToolCall`
  interceptor seam exists for a future approval plugin; the built-in policy is
  allow-all, so install only trusted projects and extensions.

## Model settings

Open **Model settings** in the top bar:

- Service name, Base URL, API style (`Chat Completions` or `Responses`), model id
  and API key.
- **Fetch models** queries `GET <baseUrl>/models`.
- **Test connection** sends one minimal completion.
- **Import from cc-switch** scans `~/.cc-switch/cc-switch.db` for `app_type = 'pi'`
  providers and can copy the stored key.
- **Run agent** executes one Pi SDK turn with tools disabled and shows the
  streamed text.

Storage rules:

- Non-secret settings live in SQLite (`pi.*` keys).
- The API key is written to `<userData>/auth.json` with `0600` permissions and is
  never returned to the renderer; the UI only sees `hasApiKey`.
- `<userData>/pi/models.json` references the key as `$PICTOR_PROVIDER_API_KEY`;
  the value is injected into the process only for the duration of a run.

Override discovery for tests with `PICTOR_CCSWITCH_DB` (database path) and
`PICTOR_USER_DATA` (profile directory).

## Current scope

Implemented: profile locking, project/session metadata, plugin lifecycle,
command dispatch, model settings with cc-switch import, endpoint discovery and
connection test, streaming chat with Pi JSONL persistence and paginated recovery,
three-column shell UI.

Not yet implemented: session tree/navigation, built-in tool approval (the seam is
ready; approval belongs to a plugin), remote hosts, packaging/auto-update,
end-to-end UI tests. Plugin modules run in-process; there is no per-plugin
process sandbox yet.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
