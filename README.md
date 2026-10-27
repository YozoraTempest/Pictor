# Pictor

Pictor is an agent-native local development environment. This repository is the
new implementation: an Electron shell, a Rust host core that owns SQLite, and a
TypeScript application core shared by every frontend.

Agent work runs on [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)
(dsh): one engine, not a choice of engines. `@vulonlok/harness-dsh` speaks its
JSON-RPC, `@vulonlok/kernel-dsh` turns it into sessions, permissions, jobs and
skills, and the window drives that through one object. A conversation records the
engine that ran it; there is no second one to switch to.

> Status: runnable app. Projects, sessions, plugins, model services, cc-switch
> import, endpoint probes, streaming chat, dsh plugins, tool rules and approvals,
> skills, branching and a three-column shell are implemented. Installers are
> produced; nothing checks for a newer release.

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
npm package unpacked into the profile, so no global install is involved.

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
  src/main/kernel/     the engine host: mounting dsh, and the contract it is given
packages/kernel-sdk/   the contract: what an engine is, and what it may reach
packages/kernel-dsh/   the dsh engine, as its own package
crates/host-core/      Rust sidecar: SQLite schema, migrations, NDJSON JSON-RPC
packages/shared/       Serializable domain model, error codes, Pi provider mapping
packages/racp/         NDJSON JSON-RPC framing, client and stdio transport
packages/host-client/  Typed client for the host core
packages/application/  ApplicationHost, Command Engine, Profile lock, events
packages/model-config/ Provider records, auth storage, endpoint probing
packages/plugin-sdk/   Manifest, Module and Contribution contract
packages/plugin-host/  Discovery, SemVer resolution, lifecycle, installer
packages/harness/      dsh transport: unary calls, session stream, follow frames
plugins/               Bundled plugins, and how to write one
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
  A plugin is a cordis plugin — `export const inject` plus `export function apply` — so
  the same package installs into Pictor and into dsh, and one that injects a service this
  host lacks stays mounted and waiting rather than being called broken. Installing,
  removing, switching off and **editing** a plugin are all live: saving a file reloads it.
  The one cost of the last is stated in 拓展 › 插件: a reload leaves the old module in
  memory, so a restart is still the only clean slate.
- The renderer only sees the narrow `window.pictor` bridge; no Node or Electron
  object crosses the context bridge, and the window runs with sandbox, context
  isolation, no Node integration and a restrictive CSP.

## The engine

Pictor owns no agent loop. `KernelDriver` (`packages/kernel-sdk/src/driver.ts`) is
what the main process may assume about the engine it drives: lifecycle, one turn,
history, events, settings, diagnosis. `DshHarness` (`apps/desktop/src/main/kernel/
dsh.ts`) is that one engine: it forwards, and the capability checks it keeps are
about what _this_ build of dsh offers, not about picking between backends.

A conversation records the engine that ran it. There is no second engine to switch
to — the rail carries home, one page for the engine, extensions and settings. Home is
where a conversation starts, and the only place the choice of kernel is offered. Home
deliberately lists no conversations of its own — a conversation is found again on the
engine's page, or through the search palette.

### dsh

`packages/kernel-dsh` is the engine: a server process booted with a profile Pictor
owns, over the runtime's own HTTP and WebSocket API, with `packages/harness-dsh`
speaking its JSON-RPC. What it can do travels as `KernelCapabilities`, and the window
draws a control only where those say it exists: no approval switch when dsh decides
for itself, no model picker when no provider is configured. Anything the engine
cannot express is answered honestly — `null`, an empty page, a thrown error — instead
of being faked.

### How the engine is mounted

The engine is a **cordis plugin** that provides exactly one service named
`kernel.dsh` (`apps/desktop/src/main/kernel/host.ts`). `startEngine` provides the host
services it may reach, imports `@vulonlok/kernel-dsh`, and mounts it into the plugin
runtime's own tree — so a plugin can `inject` a host service and the engine can read a
contribution point, and `inject` means the same thing on both sides.

The engine is a **package**: `packages/kernel-dsh` depends on `@vulonlok/kernel-sdk` for
the contract and on `@vulonlok/shared` for the vocabulary, and on nothing else here. The
SDK holds the driver interface, the plugin shape, the host services a plugin may inject,
and the engine-facing types. `apps/desktop/src/shared/bridge.ts` re-exports them, so the
window imports one module and never a package name.

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
- The **right panel** lists what can be opened there. A plugin panel is a frame around a
  `views` contribution: the plugin answers with blocks — headings, lists, tables, code —
  and the window draws them with components it owns, so opening a panel never loads a
  plugin's React into the window. A view is read on open and on refresh, never on a timer,
  and states in its own `note` when it was read.
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
- **Search** (the magnifier in the title bar, or Ctrl/Cmd+K) opens a palette over
  every kernel's conversations — the way to reach one that is not on the page in
  front of you. It matches conversation titles and project names, opens the pick on
  Enter on the page of the kernel that ran it, and includes archived conversations
  labelled as such.
- **Branching** works from the menu (latest completed turn) and from any message:
  hovering an answer offers 从这条回答分叉, hovering a question offers 在这一问之前分叉.
  The branch records where it came from — the row carries a branch mark and the title
  says `分支自 …`. The **branch tree** draws every conversation that shares a lineage.
- **回到这里** (hover a question) goes back to just before it: the conversation is cut
  there, opened as a branch, and the one you left is archived rather than discarded — the
  turns you walked away from stay readable and the archive is reversible. What it does
  _not_ do is roll files back: this runtime's log is append-only and its "checkpoint"
  means the log is durable, never that the workspace looked like a particular moment. The
  confirmation says so before it acts.
- **Archiving is reversible**: an archived conversation keeps its menu and offers
  取消归档. Batched archiving asks first and names how many conversations it moves.
- **Waiting for an answer** is a label on the sidebar row: a conversation whose kernel
  is holding a tool call or a question says so from anywhere in the app, and the card
  offers to jump to it.
- **Skills and commands** share the slash menu, and it says which is which. A skill is
  text the kernel injects into the turn (the catalog is the kernel's, plus whatever
  plugins contribute); a command is the kernel's own lever, sent as `/name …` instead
  of as a prompt — `compact` on both kernels, plus whatever dsh reports. A line that
  names one of them never reaches the model as prose.
- **Compaction is visible**: when a kernel replaces older context with a summary, the
  transcript gets a divider saying 上下文已压缩 together with the saving it reported, and
  the summary behind 查看摘要. It survives a reload, because each kernel's own history
  reader emits the same row.
- **Current state sits above the composer**: the agent's task list (`任务 2/5` with the
  step it is on), a 计划模式 badge while the conversation is exploring read-only, and
  `后台任务 N 个运行中` for background work. Each is collapsed until asked for, absent
  when the kernel never mentions it, and replayed from the same log on reload — so a
  reloaded conversation shows the same list, mode and roster. Stopping a job is offered
  only where the kernel can honour it.
- **Plugins can act on a finished tool call.** A `toolHooks` contribution sees
  `{ tool, args, session, ok, output }` and may append a note to what the model reads or
  turn the result into a failure that still carries the tool's output. Hooks fail open
  (they cannot grant or deny); guards keep failing closed. Whatever a hook adds is
  attributed to it, so the transcript never reads as if the tool said it.
- **A background job's output is one click away**: 输出 in the job row reads what it has
  printed — while it runs that is "so far", after it settles it is the whole thing — and
  `stderr` is marked apart from `stdout` instead of merged, because that is the part
  someone reads when something failed. If the runtime dropped earlier output, the dialog
  says so rather than presenting a tail as the beginning.
- **Delegation is visible**: when a kernel starts a subagent, a `子代理 N 个` chip appears
  above the composer with the labels it was given. 查看步骤 reads that child's own session
  and shows it in a dialog — a child is a conversation of its own, so its steps are shown
  where they happened rather than pasted into this transcript. A child that runs on an
  external provider keeps no local log, and the row says so instead of offering a read.
- **A tool can be named by namespace**: `mcp__github__*` covers every tool that server
  offers, in a guard, a hook or a view, without listing them in advance. An exact name
  always wins, then the longest prefix.
- **MCP servers** (**设置 › 通用 › 智能体 › MCP**) are one list for every kernel: stdio
  (a command and its arguments) or HTTP (an endpoint and its headers). dsh mounts each
  one from its profile patch, so an edit restarts the runtime; Pi gets the same list
  written into its `mcp.json` before it starts. Their tools appear as
  `mcp__<server>__<tool>`.

## Permissions and rules

Three things decide whether a tool call runs:

- **Sandbox** — `read-only`, `workspace-write` or `danger-full-access`. The default is
  a live setting (**设置 › DSH › 默认权限**), and the composer's switch changes it for
  one conversation. Only kernels with a sandbox offer it; **完全访问** asks for
  confirmation because it also stops the per-call prompt.
- **Tool rules** (**设置 › 通用 › 偏好 › 权限**) — per tool: allow, ask, or deny. A deny or
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

## Extensions

What can be added to the app has its own destination, one icon above settings: **拓展**,
one page with three tabs — 插件, 技能, MCP. They are not preferences, so they are not in
settings; they are also not three separate pages, because they answer one question.

- **插件** — what is installed, what it contributes, what it may reach, and the switch
  that turns it off. Everything a plugin can add — panels and the views they show, guards,
  skills, a whole kernel — is one installation, so it is one row. How to write one:
  [`plugins/README.md`](plugins/README.md).
- **技能** — the skills a conversation can load, with the switch that hides one. With no
  conversation open the tab lists what Pictor owns and what plugins brought; a
  conversation adds the filesystem and project ones the runtime finds in its working
  directory, which is why the copy changes with the mode.
- **MCP** — external tool servers, one list for both kernels, each translating it its own
  way.

## Settings

Settings is three columns: one owner per row of icons, then the owner's pages, then the
page itself.

- **通用** — 偏好 (常规, 权限), then 模型.
- **DSH** — 运行时 (status, version, install, start/stop).
- **Pi** — 运行时 (status, binary, isolation switch, session data).
- **关于** — version, data directory, licence.

Three save behaviours, and the page says which one it uses: live settings apply on
change, forms are saved with a button, and anything destructive asks first.

## Current scope

Implemented: profile locking, project/session metadata, plugin lifecycle with
`panels` / `views` / `toolGuards` / `toolHooks` / `toolViews` / `skills` contributions,
command dispatch,
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
