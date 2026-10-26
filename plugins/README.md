# Plugins

A plugin is one npm package. It can contribute panels, tool guards, skills, a whole
kernel, or several of those — and installing it is one act, not one per contribution.

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
| `panels`     | `{ id, title, icon?, command }`           | A side-panel entry that runs a command                  |
| `commands`   | `{ id, description?, result? }`           | Registers a command in the app's command engine         |
| `toolGuards` | `{ id, title, decide(context) }` (module) | Decides allow/deny for a tool call                      |
| `toolViews`  | `{ tool, … }`                             | How a tool call is presented in the transcript          |
| `skills`     | `{ name, description, body, whenToUse? }` | A skill the agent can load on demand                    |
| `kernel`     | `{ main, label? }`                        | A cordis plugin that provides one `kernel.<id>` service |

`main` is the **UI** entry (`activate`). A kernel's entry is `main` inside the
`kernel` contribution — they are two different files, and a plugin may provide
either, both, or neither.

## What a kernel can reach

A kernel plugin declares what it needs with `inject`, and that list is shown on the
plugin's row before anyone installs it:

```js
export const inject = ['pictor.models', 'pictor.rules']

export class MyKernel extends Service {
  constructor(ctx) {
    super(ctx, 'kernel.mine')
  }
  // …the KernelDriver contract: start, prompt, history, events, settings, diagnosis
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

Both mount immediately: the kernel half is started, the UI half activated. No restart.

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
