# 写 Pictor 插件

插件是 cordis 插件（`name` / `inject` / `apply`）加一个 `pictor` 字段。插件说，窗口画：交描述，不交组件。

## 位置

```
{{DEVELOPMENT_DIRECTORY}}
```

一个子目录一个插件。放进来自动挂载，删掉自动卸下，不用重启。

## 最小插件

```
{{DEVELOPMENT_DIRECTORY}}/my-first/
  package.json
  index.js
```

```json
{
  "name": "@me/pictor-my-first",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "index.js",
  "pictor": { "id": "me.my-first", "engines": { "pictor": ">=0.0.0" } }
}
```

```js
export const name = 'pictor-my-first'
export const inject = ['pictor']

export function apply(ctx) {
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'me.my-first.view',
      title: '我的视图',
      data: ({ sessionId }) => ({
        blocks: [{ kind: 'text', text: `会话：${sessionId ?? '无'}` }],
      }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.panels({ id: 'me.my-first.panel', title: '我的面板', view: 'me.my-first.view' }),
  )
}
```

`ctx.effect(...)` 的注册随插件卸载一起撤销。

## 验证

1. 拓展 → 插件：行在不在、贡献计数、失败原因。
2. 打开面板看内容。
3. 改一行保存，看它变。
4. 座位类（侧栏、标题栏、底部、浮层）没有入口，直接看窗口。

挂载失败的原因写在第 1 步那一页。不要写 HTML 预览或截图脚本，装好的插件就是预览。

## 块

`data` 返回 `{ blocks, note? }`，在打开和刷新时调用。

| 块                          | 载荷                                    |
| --------------------------- | --------------------------------------- |
| `heading` `text` `markdown` | `{ text }`                              |
| `list`                      | `{ items, ordered? }`                   |
| `keyValue`                  | `{ rows: [{ label, value }] }`          |
| `table`                     | `{ columns, rows }`，每行格子数必须相等 |
| `code`                      | `{ text, language? }`                   |
| `badge`                     | `{ label, tone? }`                      |
| `button`                    | `{ label, action, value?, tone? }`      |
| `divider`                   | 无                                      |

`tone`：`neutral` / `accent` / `danger` / `success`。上限：200 块、文本 20000 字符、列表 200 项、表格 200×12；超了整块拒绝。`note` 画在块下面，放限制说明。

## 按钮

```js
ctx.pictor.views({
  id: 'me.build.view',
  title: '构建',
  data: () => ({ blocks: [{ kind: 'button', label: '重建', action: 'rebuild' }] }),
  onAction: ({ action, value }) =>
    action === 'rebuild'
      ? { blocks: [{ kind: 'text', text: `重建 ${value ?? '全部'}` }] }
      : undefined,
})
```

返回新描述就替换；返回 `undefined` 内容不动。没写 `onAction` 被点会报错。点击在飞时按钮禁用。

## 自己的前端

`data` 与 `frame` 二选一；`respond` 只配 `frame`。

```js
ctx.pictor.views({
  id: 'me.board.view',
  title: '看板',
  frame: { entry: 'client.js', styles: 'client.css' },
  respond: ({ action }) => {
    if (action !== 'load') throw new Error(`不认识的消息：${action}`)
    return { cards: [] }
  },
})
```

```js
// client.js，普通 ES 模块
const api = window.pictorFrame
api.onInit(({ theme }) => {
  document.body.style.background = theme.bg
})
const answer = await api.request('load') // 到 respond；失败抛它的原文
```

帧里没有：网络、`localStorage`、Node、主窗口 DOM/bridge、自定义 HTML 文档、插件目录外的文件。答复必须是 JSON 且 < 64 KiB，`undefined` 到帧里是 `null`。尺寸由窗口定，刷新是重挂。

## 座位

| slot            | 位置                      | key  |
| --------------- | ------------------------- | ---- |
| `main`          | 中间；`conversation` 保留 | 必填 |
| `sidebar`       | 左栏顶部                  | 无   |
| `rightbar`      | 右栏顶部                  | 无   |
| `shell.bottom`  | 三栏下方，空着不占高      | 无   |
| `shell.overlay` | 浮层，只有 `button` 能点  | 必填 |
| `shell.leading` | 标题栏左侧                | 无   |

```js
ctx.pictor.slots({ slot: 'sidebar', title: '今日', icon: 'calendar', view: 'me.today.view' })
```

一个格子一个主人，重复注册被拒绝。

## 其它贡献点

```js
ctx.pictor.toolViews({ id: 'me.gh', tools: ['mcp__github__*'], label: 'GitHub' })
ctx.pictor.toolGuards({
  id: 'me.no-publish',
  tools: ['bash'],
  decide: () => ({ decision: 'allow' }),
})
ctx.pictor.toolHooks({
  id: 'me.note',
  tools: ['bash'],
  after: ({ ok }) => (ok ? undefined : { note: '失败了' }),
})
ctx.pictor.skills({ name: 'my-skill', description: '什么时候用', body: '# 正文' })
```

`decide` 返回 `{ decision: 'allow' }` 或 `{ decision: 'deny', reason }`；`after` 返回 `{ note }` 或 `{ fail }`，不放行也不阻断原调用。工具名：精确名或前缀 `mcp__github__*`。

## 规则

- id 全小写带命名空间（`me.x.y`），重复会被拒绝。
- 图标用 Lucide 名，不认识的回落到默认。
- 抛错要具体：`new Error('读不到 ~/.gitconfig')`。
- 自己的文件用视图上下文里的 `dataDirectory`，不要写 `~/.config/pictor`。
- 块的 `kind` 是闭集，不要留注释掉的块。

## 版本化

插件目录是普通目录，Pictor 不介入版本控制。
