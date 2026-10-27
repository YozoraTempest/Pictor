# Plugins

A plugin is one npm package. It can contribute panels and the views behind them, tool
guards, skills, a whole kernel, or several of those — and installing it is one act, not
one per contribution.

This directory holds the example the tests install (`fake-kernel`). What ships with
the app is discovered from here; what a person installs lives under
`<profile>/plugins/`.

## The smallest plugin

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

```js
// index.js — optional. Omit `main` entirely if the plugin contributes no UI half.
export function activate(context) {
  context.logger.info('hello')
  // Registering through the context hands back a disposer; the host runs them in
  // reverse when the plugin is disabled or removed.
  const dispose = context.contribute('panels', { … })
}
```

`id` is dotted and stable. `version` must be semver; it is what the settings page
shows. `engines.pictor` is checked against the running app.

## Contribution points

| Point        | Payload                                   | What it does                                            |
| ------------ | ----------------------------------------- | ------------------------------------------------------- |
| `panels`     | `{ id, title, icon?, view }`              | A side-panel entry that renders a view                  |
| `views`      | `{ id, title, data(context), icon? }`     | What a panel draws: blocks, not renderer code           |
| `toolGuards` | `{ id, title, tools?, decide(context) }`  | Decides allow/deny **before** a call runs               |
| `toolHooks`  | `{ id, title?, tools?, after(context) }`  | Reacts **after** a call settled: note or fail           |
| `toolViews`  | `{ id, tools, label?, icon? }`            | How a tool call is presented in the transcript          |
| `skills`     | `{ name, description, body, whenToUse? }` | A skill the agent can load on demand                    |
| `kernel`     | `{ main, label? }`                        | A cordis plugin that provides one `kernel.<id>` service |

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
context.contribute('views', {
  id: 'acme.today',
  title: '今日',
  // Called when the panel opens and when the reader asks for a refresh — never on a
  // timer. `sessionId` is the conversation it was opened over, or null; `dataDirectory`
  // is a folder of the plugin's own.
  data: async ({ sessionId, dataDirectory }) => ({
    blocks: [
      { kind: 'heading', text: '今天要做的' },
      { kind: 'list', items: ['读代码', '写补丁'], ordered: true },
    ],
    // Drawn under the blocks, where limitations belong.
    note: `读取于 ${new Date().toLocaleTimeString('zh-CN')}`,
  }),
})
context.contribute('panels', { id: 'acme.today.panel', title: '今日', view: 'acme.today' })
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
context.contribute('toolHooks', {
  id: 'acme.no-publish',
  tools: ['bash'],
  after: ({ args, ok, output }) =>
    // `fail` turns the result into a failure that still carries what the tool printed;
    // `note` is appended to what the model reads, prefixed with this id.
    ok && String(args.command).includes('npm publish')
      ? { fail: '发版请走 release 工作流' }
      : undefined,
})
```

Watch it in the transcript: whatever a hook adds is **attributed to the hook**, so a
reader never mistakes a plugin's words for the tool's own.

`main` is the **UI** entry (`activate`). A kernel's entry is `main` inside the
`kernel` contribution — they are two different files, and a plugin may provide
either, both, or neither. A directory without a `pictor` field is not a plugin and is
ignored, so a stray package in the plugins folder cannot be mounted by accident.

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
