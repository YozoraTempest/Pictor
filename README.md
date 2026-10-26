# Pictor

Pictor is an agent-native local development environment. This repository is the
new implementation: an Electron shell, a Rust host core that owns SQLite, and a
TypeScript application core shared by every frontend.

Agent work runs on a **kernel**. Two ship — [DeepSeek
Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (dsh), the default, and
[Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) — and a third
can be installed as a plugin without rebuilding the app. A conversation belongs to
the kernel that started it; switching kernels opens a branch rather than rewriting
one.

> Status: runnable app. Projects, sessions, plugins, model services, cc-switch
> import, endpoint probes, streaming chat, two kernels with installable kernel
> plugins, tool rules and approvals, skills, branching and a three-column shell are
> implemented. Installers are produced; nothing checks for a newer release.

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

The dsh runtime is installed from inside the app (**设置 › DSH › 运行时**); it is an
npm package unpacked into the profile, so no global install is involved. Pi is
expected on the machine already — the app points at a `pi` binary it can find, or
`PICTOR_PI_BIN`.

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

`pnpm verify` is the gate used by CI, together with a packaging job that checks the
sidecar actually made it into the bundle.

> Network note: if `crates.io` is unreachable in your environment, point Cargo at
> a mirror for the session, for example:
> `cargo --config 'source.crates-io.replace-with="mirror"' --config 'source.mirror.registry="sparse+https://rsproxy.cn/index/"' test -p pictor-host-core`

## Layout

```text
apps/desktop/          Electron main, preload and React renderer
  src/main/kernel/     the kernel contract, both built-in kernels, the host, installer
crates/host-core/      Rust sidecar: SQLite schema, migrations, NDJSON JSON-RPC
packages/shared/       Serializable domain model, error codes, Pi provider mapping
packages/racp/         NDJSON JSON-RPC framing, client and stdio transport
packages/host-client/  Typed client for the host core
packages/application/  ApplicationHost, Command Engine, Profile lock, events
packages/model-config/ Provider records, auth storage, endpoint probing
packages/plugin-sdk/   Manifest, Module and Contribution contract
packages/plugin-host/  Discovery, SemVer resolution, lifecycle, installer
packages/harness/      dsh transport: unary calls, session stream, follow frames
plugins/               Bundled plugins, a sample kernel plugin, and how to write one
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

## Kernels

Pictor owns no agent loop. `KernelDriver` (`apps/desktop/src/main/kernel/driver.ts`)
is everything the rest of the main process may assume about one: lifecycle, one
turn, history, events, settings, diagnosis. `KernelRouter` sends each call to the
kernel that owns the conversation and **never falls back** — history handed to a
kernel that never produced it would be a lie about where it came from.

A conversation records its kernel when it is created. Choosing another kernel is a
**branch**: the new conversation names the new kernel and points back at the one it
came from, so a conversation never silently changes what ran it. The rail carries
one page per kernel; the home page is the only place the choice is offered.

### Two built-in kernels

- **dsh** (`kernel/dsh-driver.ts`) — the default. A server process booted with a
  profile Pictor owns, over the runtime's own HTTP and WebSocket API.
- **Pi** (`kernel/pi-rpc-driver.ts`) — an RPC child per conversation: `pi --mode rpc`
  speaks JSONL commands on stdin and streams the same events over stdout,
  translated by `kernel/pi-events.ts` into the durable events and chunks the window
  already renders. The child runs on the app's own runtime
  (`ELECTRON_RUN_AS_NODE`), because Pi needs Node 22.19 or newer.

What a kernel can do travels with it as `KernelCapabilities`, and the window draws a
control only where the conversation's kernel says it exists: no sandbox switch for a
kernel without a sandbox, no model picker for one that has none. Anything a kernel
cannot express is answered honestly — `null`, an empty page, a thrown error — instead
of being faked.

### Kernel plugins

Every kernel is a **cordis plugin** that provides exactly one service named
`kernel.<id>` (`kernel/host.ts`). The built-ins are `kernel/dsh-kernel.ts` and
`kernel/pi-kernel.ts`; an installed one is a plugin under `<profile>/plugins` that
points at it from `pictor.contributes` — either a copied directory or a package in
its `node_modules`, named by `installed.json`. `startKernelHost` mounts them in
order, watches `internal/service` for what they publish, and hands the resulting map
to `KernelRouter` — nothing enumerates plugins by hand.

The map is live: installing a plugin mounts its kernel without a restart, and
removing one takes it out of the picker at once. Installing and mounting are deliberately two
steps (`kernel/installer.ts` owns the disk, the host owns the mount), so a copy that
succeeds and a mount that fails leaves a kernel on disk _with a reason_, which the
settings page shows, instead of a rollback that hides what went wrong.

What a plugin may reach is a service, and the `inject` list it declares is the
sentence the settings page shows a person: `pictor.models`, `pictor.rules`,
`pictor.guard`, `pictor.permission`, `pictor.workspace`, `pictor.userdata`,
`pictor.settings`. A capability declared `true` with no method behind it is refused at
mount time, so the window never draws a control the kernel cannot answer.

Built-in and installed kernels take the same road: both arrive as a `KernelEntry`
(`{ load: () => Promise<plugin> }`) and mount through one function, so shipping a
built-in as its own package is a change of one closure. `pictor.settings` is how a
kernel remembers a setting it declared — it reads the profile's settings and writes
back through the same store, so the file that assembles the kernels never spells out
their keys.

The container lives in the **main process only**. The runtime stays a child process:
cordis has no cross-process semantics, and the tool-guard bridge is only fail-closed
because the kernel lives on the other side of it.

### dsh, in detail

- **Profile.** `<DSH_HOME>/profiles/pictor` holds a `package.json` (written once;
  the bundle list lives there) and a `cordis.patch.yml`.
- **Patch.** Regenerated on every boot from the settings page: one model route named
  `pictor` carrying the selected wire protocol, its endpoint and its models, the
  default model pointing at that route, and a `pictor-guard` plugin inserted so tool
  guards can be consulted. The DeepSeek-specific routes are switched off because
  their protocol cannot be configured.
- **Protocols.** A route declares one of `openai-completions`, `openai-responses` or
  `anthropic-messages`, and that decides the request shape and endpoint inside the
  runtime.
- **Credentials.** The route resolves its key from `PICTOR_LLM_API_KEY` per request;
  the value is injected into the runtime process and never written to the patch.
  `DEEPSEEK_API_KEY` is passed as well because `web_search` reads it through its own
  client.
- **Transport.** Unary calls are `POST /api/<endpoint>`; the live transcript is a
  WebSocket subscription on `/api/remote.mux`, which replays an opening window and
  then streams.
- **Sessions.** The runtime owns conversation transcripts. The app keeps the mapping
  from its own session ids to runtime ids in `<DSH_HOME>/pictor-sessions.json`. There
  is no second store, so a turn never lands somewhere the next boot cannot read.

### Pi, in detail

- **Isolation.** Pi runs with `PI_CODING_AGENT_DIR=<profile>/pi-home`, so the only
  models it sees are the ones Pictor registers. **设置 › Pi › 运行时** has a switch
  that gives Pi its own `~/.pi/agent` back; the page states what that costs.
- **One configuration.** Pictor's services are registered into Pi as
  `pictor-<slug>` providers over the guard bridge's loopback socket, so one address,
  key and model list serves both kernels. The key never reaches a file on disk.
- **Dialogs.** `ctx.ui.confirm` becomes an approval card; `select`, `input` and
  `editor` become the question card — options, free text, and a seeded multi-line
  field. `notify` becomes the banner, marked with the kernel that sent it; terminal
  surfaces (`setStatus`, `setWidget`, `setTitle`) are neither drawn nor answered,
  and `custom` does not exist in RPC mode at all.
- **Asking.** Pi ships no model-facing asking tool, so Pictor's extension registers
  `ask_user_question` under dsh's name — `draft` included — so a Pi conversation can
  ask, not only answer.

## Chat

Selecting a session opens its transcript and a composer:

- Text streams token by token; the model's reasoning streams into its own collapsible
  row above the answer. The composer's capability row carries the permission switch,
  the context ring, the kernel, the model and its reasoning level, and Send.
- **Images** can be pasted or dropped in; they are sent as content blocks and refused
  by name before the turn if the model cannot see them.
- **Tool executions** appear as rows with a presenter per tool (command and output for
  `bash`, file content for `read`, a diff for `edit`). Long output is collapsed; a
  plugin can add a presenter with a `toolViews` contribution.
- **Context usage** is the ring beside the model: used tokens against what the model
  reports. Clicking it opens the breakdown per message.
- **Reasoning effort** shows only the levels the model declares, in the platform's own
  names; `omit` means the parameter is not sent at all. A level the model clamps is
  read back, so the button never claims something else.
- A conversation is named after its first prompt: the kernel titles it and the sidebar
  adopts that name. A name typed by hand is never replaced.
- Conversations live in the kernel's log, so an empty panel means one of two things: a
  fresh conversation, or a kernel that is not running. The panel says which, and
  offers to start it instead of claiming the history is gone.
- The transcript is paginated: the newest 50 messages load first and **Load older
  messages** prepends earlier pages. The opening stream window holds 200 messages.
- Several conversations can run at once; each keeps its own transcript and event
  stream.
- **Search** (the magnifier in the title bar, or Ctrl/Cmd+K) opens a palette over the
  home view: it matches conversation titles and project names, opens the pick on
  Enter, and includes archived conversations labelled as such.
- **Branching** works from the menu (latest completed turn) and from any message:
  hovering an answer offers 从这条回答分叉, hovering a question offers 在这一问之前分叉.
  The branch records where it came from — the row carries a branch mark and the title
  says `分支自 …`. The **branch tree** draws every conversation that shares a lineage.
- **Archiving is reversible**: an archived conversation keeps its menu and offers
  取消归档. Batched archiving asks first and names how many conversations it moves.
- **Waiting for an answer** is a label on the sidebar row: a conversation whose kernel
  is holding a tool call or a question says so from anywhere in the app, and the card
  offers to jump to it.
- **Skills** are offered per conversation from the slash menu; the catalog is the
  kernel's, plus whatever plugins contribute.

## Permissions and rules

Three things decide whether a tool call runs:

- **Sandbox** — `read-only`, `workspace-write` or `danger-full-access`. The default is
  a live setting (**设置 › DSH › 默认权限**), and the composer's switch changes it for
  one conversation. Only kernels with a sandbox offer it; **完全访问** asks for
  confirmation because it also stops the per-call prompt.
- **Tool rules** (**设置 › 通用 › 工具规则**) — per tool: allow, ask, or deny. A deny or
  ask rule can also match on the call's arguments (globs); allow matches by tool name
  only, because allowing every call of a tool is the one promise that is safe to make.
  Conflicts resolve deny > ask > allow.
- **Approvals** — where the kernel hands this to Pictor, the call is held in a card:
  allow once, allow this tool for the conversation, or refuse. "Allow for the
  conversation" is remembered per conversation and can be taken back from the same
  chip. It never writes a global rule.

dsh decides for itself when to ask, using its own sandbox and approval policy, so no
approval switch is drawn for it. Pi has no sandbox, so _when_ a call waits is Pictor's
decision there: a per-conversation mode (**不问** / **改动时问**) plus `ask` rules.

Guards are consulted from another process over a loopback socket, and a guard that
cannot be reached **fails closed**: the call is refused rather than allowed.

## Model settings

Open **设置 › 通用 › 模型**:

- A list of services; each has a name, Base URL, wire protocol, model id and key. One
  is active at a time and is what both kernels run with.
- Each service carries its models' capabilities: image input, reasoning levels,
  context window, output limit. Endpoints rarely report them, so the dialog asks.
- **Fetch models** queries `GET <baseUrl>/models`; **Test connection** sends one
  minimal completion in the service's protocol.
- **Import from cc-switch** scans `~/.cc-switch/cc-switch.db` for providers and adds
  the picked one as a new service.
- The model page shows, per service, whether Pi can use it (`pictor-<slug> · N 个模型`)
  and why not when it cannot.

Storage rules:

- Non-secret settings live in SQLite (`pi.*` keys).
- The API key is written to `<userData>/auth.json` with `0600` permissions and is never
  returned to the renderer; the UI only sees `hasApiKey`.
- dsh gets the key as `PICTOR_LLM_API_KEY` when it boots; it never enters the generated
  profile patch. Pi gets it over the guard bridge's loopback socket when its extension
  asks, so it never enters a file either.

Override discovery for tests with `PICTOR_CCSWITCH_DB` (database path),
`PICTOR_USER_DATA` (profile directory), `PICTOR_DSH_BIN` and `PICTOR_PI_BIN`.

## Settings

Settings is three columns: one owner per row of icons, then the owner's pages, then the
page itself.

- **通用** — 偏好 (常规, 权限), 智能体 (模型, 技能), 插件.
- **DSH** — 运行时 (status, version, install, start/stop).
- **Pi** — 运行时 (status, binary, isolation switch, session data).
- **关于** — version, data directory, licence.

Everything a plugin can add — panels, guards, skills, a whole kernel — is one page,
because a plugin is one installation. How to write one: [`plugins/README.md`](plugins/README.md).

Three save behaviours, and the page says which one it uses: live settings apply on
change, forms are saved with a button, and anything destructive asks first.

## Current scope

Implemented: profile locking, project/session metadata, plugin lifecycle with
`panels` / `toolGuards` / `toolViews` / `skills` contributions, command dispatch,
multi-service model settings with cc-switch import, endpoint discovery and connection
test, three wire protocols, two kernels behind one contract, installable kernel
plugins, tool rules and approvals, skills, streaming chat with kernel-owned
transcripts and paginated recovery, reasoning display and effort selection, context
usage, image input, branching with lineage, and a three-column shell.

Not yet implemented: remote hosts, and auto-update — installers are produced but
nothing checks for a newer release. Pi has no sandbox of its own, which is why the
sandbox switch is not drawn for it; its tool calls are governed by rules and approvals
instead. UI plugin modules run in-process; there is no per-plugin process sandbox yet.

`pnpm test:e2e` covers the flows a unit test cannot see, and sits outside `pnpm verify`
because it needs a display and a built app.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
