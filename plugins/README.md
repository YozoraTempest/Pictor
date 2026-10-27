# Plugins

A plugin is one npm package. It can contribute panels and the views behind them, tool
guards, skills, a whole kernel, or several of those — and installing it is one act, not
one per contribution.

This directory holds the example the tests install (`fake-kernel`). What ships with
the app is discovered from here; what a person installs lives under
`<profile>/plugins/`.

## The smallest plugin

A plugin is a **cordis plugin**. That is not an implementation detail: it is why the same
package installs into Pictor and into dsh, and why unloading one undoes everything it
registered without either app keeping a list.

```js
// index.js
export const name = 'pictor-hello'

/** What this plugin needs. Cordis starts it once every name here exists. */
export const inject = ['pictor']

export function apply(ctx) {
  // `ctx.effect` ties the registration to this plugin's lifetime: unload the plugin and
  // the panel goes with it.
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'acme.hello.view',
      title: '你好',
      data: () => ({ blocks: [{ kind: 'text', text: '你好' }] }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.panels({ id: 'acme.hello.panel', title: '你好', view: 'acme.hello.view' }),
  )
}
```

```json
{
  "name": "@acme/pictor-hello",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "pictor": {
    "id": "acme.hello",
    "engines": { "pictor": ">=0.0.0" },
    "contributes": [
      { "point": "skills", "value": { "name": "hello", "description": "…", "body": "# …" } }
    ]
  }
}
```

The `pictor` block is **optional**. It exists so the settings page can describe a plugin
before starting it — an id that is stable across renames, an engine range to check against
the running app, and the points it claims. Without it the package is a plain cordis
plugin: its id is its npm name, nothing is promised in JSON, and everything it needs is in
`inject`.

Ready-made metadata (`contributes`) is still read from the `pictor` block: a skill is a
file written before the runtime scans, so it can be described without running code.

## Installing a plugin from the other side

dsh plugins are cordis plugins too, so a package written for dsh installs here and answers
one question: can this host supply what it injects?

- `inject: ['tools']` — a dsh service. Pictor has no such service, so the plugin stays
  **mounted and waiting**, and the settings page reports it as skipped. Not a failure:
  the moment something provides `tools`, cordis starts it.
- `inject: ['pictor']` — this app's contribution surface. Runs here, and cannot run in
  dsh for the same reason.

That is the honest shape of "one plugin, two hosts": the loading contract is shared, the
service surface is not. A plugin that uses neither — a kernel, or something that only
registers a tool — runs in both.

## Contribution points

Every point is a function on the `pictor` service. Each returns a disposer, and the ones
inside `ctx.effect` are undone when the plugin unloads.

| Call                          | Payload                                   | What it does                                   |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `ctx.pictor.panels(...)`      | `{ id, title, icon?, view }`              | A row in the right column's launcher           |
| `ctx.pictor.slots(...)`       | `{ slot, key?, title, icon?, view }`      | A seat anywhere the window reserves one        |
| `ctx.pictor.views(...)`       | `{ id, title, data(context), icon? }`     | What a panel draws: blocks, not renderer code  |
| `ctx.pictor.toolGuards(...)`  | `{ id, title, tools?, decide(context) }`  | Decides allow/deny **before** a call runs      |
| `ctx.pictor.toolHooks(...)`   | `{ id, title?, tools?, after(context) }`  | Reacts **after** a call settled: note or fail  |
| `ctx.pictor.toolViews(...)`   | `{ id, tools, label?, icon? }`            | How a tool call is presented in the transcript |
| `ctx.pictor.skills(...)`      | `{ name, description, body, whenToUse? }` | A skill the agent can load on demand           |
| `pictor.contributes` `kernel` | `{ main, label? }`                        | A second entry that provides `kernel.<id>`     |

### Slots: where a seat goes

`panels` answers one question — which row appears in the right column. A window has more
places than that, so they are named after dsh's slots and a contribution picks one:

| Slot            | Kind     | Where it is drawn                                                                                                |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `main`          | `keyed`  | The centre. `conversation` is reserved for the transcript; any other key is a page you open from the panel list. |
| `sidebar`       | `single` | Top of the left column, above the conversation list.                                                             |
| `rightbar`      | `single` | Above the right column's launcher (the launcher stays visible).                                                  |
| `shell.bottom`  | `single` | Full-width strip under the three columns; takes no height when empty.                                            |
| `shell.overlay` | `list`   | Floating layer at the top right, click-through.                                                                  |
| `shell.leading` | `single` | Title bar, left of the view's own buttons.                                                                       |

`root` is not on the list on purpose: it is the frame itself, and a second entry there
would replace the application. Asking for it is an error, not a silent no-op.

```js
ctx.effect(() =>
  ctx.pictor.slots({ slot: 'main', key: 'today', title: '今日', view: 'acme.today' }),
)
```

Two rules make a seat safe to grant:

- **One seat per cell.** A `single` slot takes no key; a `keyed` or `list` slot requires
  one. Two plugins claiming the same cell is refused, and the first keeps working — dsh
  lets a higher priority shadow the other, which turns "why did my panel change" into a
  hunt.
- **A seat cannot block the app.** `views` blocks are display-only, so nothing in a slot
  needs a click; the floating layer and its seats are click-through. A badge that covers a
  button is worse than no badge.

`rightbar` is the one place Pictor and dsh differ in meaning: in dsh the occupant replaces
the right column, here it sits above the launcher. That column is where every other panel
is found, so a takeover would hide them.

### A panel is a view

A `panels` entry is a frame — an id, a title, an icon — and `view` names the `views`
entry whose content it shows. A panel naming a view nobody contributed is reported and
dropped when the plugin loads, so the launcher never offers a row that opens nothing.

The view answers with **blocks**; the window draws them with components it owns:

| Block      | Payload                                    |
| ---------- | ------------------------------------------ |
| `heading`  | `{ text }`                                 |
| `text`     | `{ text }` — line breaks kept              |
| `markdown` | `{ text }` — the transcript's renderer     |
| `list`     | `{ items, ordered? }`                      |
| `keyValue` | `{ rows: [{ label, value }] }`             |
| `table`    | `{ columns, rows }` — every row same width |
| `code`     | `{ text, language? }`                      |
| `badge`    | `{ label, tone? }`                         |
| `divider`  | —                                          |

```js
export const inject = ['pictor']

export function apply(ctx) {
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'acme.today',
      title: '今日',
      // Called when the panel opens and when the reader asks for a refresh — never on a
      // timer. `sessionId` is the conversation it was opened over, or null;
      // `dataDirectory` is a folder of the plugin's own.
      data: async ({ sessionId, dataDirectory }) => ({
        blocks: [
          { kind: 'heading', text: '今天要做的' },
          { kind: 'list', items: ['读代码', '写补丁'], ordered: true },
        ],
        // Drawn under the blocks, where limitations belong.
        note: `读取于 ${new Date().toLocaleTimeString('zh-CN')}`,
      }),
    }),
  )
  ctx.effect(() => ctx.pictor.panels({ id: 'acme.today.panel', title: '今日', view: 'acme.today' }))
}
```

**Why a description and not a component.** The alternative is running a plugin's React
inside the window with the app's own privileges, and making every plugin track the
workbench's UI as it changes. Blocks are checked one at a time before anything is drawn,
so a shape this build does not know is refused with the plugin's name in the message
instead of quietly disappearing from the panel. A block the vocabulary cannot express is
a request for a rendering engine — the honest answer is that this is not one.

### Naming a tool

Every point that names a tool takes the same two forms: an exact name (`bash`,
`mcp__github__create_issue`) or a namespace prefix ending in `*` (`mcp__github__*`). An
exact name always beats a prefix, and the longer prefix beats the shorter one — so one
view can dress a whole MCP server while a single tool from it still reads differently.

### Guards decide, hooks react

The split follows what a kernel can actually do. dsh's pre-execute decision is
`allow | deny | cancel | ask` and nothing else — it excludes input rewriting on purpose —
while both kernels let a post-execution step replace or annotate the result. So:

- **`toolGuards`** run before the call and **fail closed**: a guard that cannot be reached
  refuses, because a policy that silently disappears was never a policy.
- **`toolHooks`** run after it and **fail open**: a hook cannot grant or deny anything, so
  a hook that throws costs its own contribution and nothing else.

```js
ctx.effect(() =>
  ctx.pictor.toolHooks({
    id: 'acme.no-publish',
    tools: ['bash'],
    after: ({ args, ok, output }) =>
      // `fail` turns the result into a failure that still carries what the tool printed;
      // `note` is appended to what the model reads, prefixed with this id.
      ok && String(args.command).includes('npm publish')
        ? { fail: '发版请走 release 工作流' }
        : undefined,
  }),
)
```

Watch it in the transcript: whatever a hook adds is **attributed to the hook**, so a
reader never mistakes a plugin's words for the tool's own.

`main` is the plugin's entry (`apply`). A kernel's entry is `main` inside the
`kernel` contribution — they are two different files, and a plugin may provide either,
both, or neither. A directory with neither a `pictor` block nor a `main` is not a plugin
and is ignored, so a stray package in the plugins folder cannot be mounted by accident.

## What a kernel can reach

A kernel plugin declares what it needs with `inject`, and that list is shown on the
plugin's row before anyone installs it:

```js
export const inject = ['pictor.models', 'pictor.rules']

export class MyKernel extends Service {
  constructor(ctx) {
    super(ctx, 'kernel.mine')
  }
  readonly id = 'mine'
  readonly label = '我的内核'
  // A Lucide icon name for the rail; the window owns the vocabulary, and an unknown
  // name falls back to the generic icon instead of a blank button.
  readonly icon = 'radio'
  // …the rest of the KernelDriver contract: start, prompt, history, events, settings
}
```

There is no capability you can claim without implementing it: the host refuses a
kernel that declares `permission: true` and has no `setSessionPermission`.

**A kernel gets `pictor.models`, which includes the running service's API key.** That
is not avoidable — a kernel cannot take a turn without it — and it is why installing
asks first.

## Installing

- **From a directory** — Settings › 通用 › 插件 › 从目录安装. The directory is copied
  whole, so it must bring its own dependencies.
- **From npm** — the package name (`@acme/pictor-hello@1.2.3`). npm installs it into
  `<profile>/plugins/`, so it can depend on anything.

Both mount immediately, with no restart: the kernel half is started, the UI half
activated, the skills it contributes written into the runtime's skill folder, and the
panel list, tool presenters, guards and hooks recomputed from the new set. Switching a
plugin **off** is the same act in reverse, and it is a setting, not a deletion —
switching it back on mounts it again.

One consequence worth knowing: a conversation whose kernel half you switched off reports
that kernel as missing until you switch it back. That is the same answer an uninstall
gives, and the honest one — the log is still there, the runtime is not.

## Editing without a restart

The app watches each plugin's directory. Save a file and that plugin is unloaded and
mounted again — its contributions disappear and the new code registers its own, so the
panel you are looking at is the code you just wrote.

Two things about how this works are worth knowing, because both are limits:

- **It drops and re-mounts; it does not swap modules.** Node evaluates a module once per
  URL, so the reload imports the file under a new URL (`?v=1`, `?v=2`, …). The previous
  module stays in memory. Anything the old code started that was not registered through
  `ctx.effect` keeps running. A restart is still the only clean slate.
- **dsh's own HMR is not used.** `@deepseek-ai/cordis-plugin-hmr` needs
  `--expose-internals` to reach Node's module loader; Electron refuses that flag in
  `NODE_OPTIONS` and swallows it on the command line, so the package cannot start here.
  What is left is the part that does not need Node internals.

Turn it off in 拓展 › 插件 if you would rather have a restart-per-edit model. The switch
lands on the next launch, because the watchers belong to the running process.

## Local development

Point the app at an unpacked directory by copying it in:

```bash
cp -r ./my-plugin ~/.config/pictor/plugins/my-plugin
```

Then restart the app once (discovery happens at launch); from then on, reinstalling
through the settings page picks up changes without restarting.

## Trust

Plugins run **in the main process**, with the same reach as the app: they can read and
write files, use the network, and observe tool calls. There is no process sandbox yet.
Install what you would run from a terminal.
