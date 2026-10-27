# 写一个 Pictor 插件

Pictor 的插件是一个 npm 包，形态是 **cordis 插件**：导出 `name`、`inject`、`apply(ctx)`。
它不交 React，也不碰窗口的 DOM —— 它**描述**内容，窗口用自己的组件画；需要真正的界面时，
它交一个前端包，窗口把它跑在沙箱 iframe 里。

判断标准只有一条：**插件说，窗口画。** 任何时候你想把组件、函数或 HTML 传进去，先回来读这一句。

## 放在哪

开发目录（不存在就创建）：

```
{{DEVELOPMENT_DIRECTORY}}
```

一个子目录一个插件。放进去就自动挂载，删掉就自动卸下 —— **不需要重启**，也不需要安装。

规则：

- 目录名和 `package.json` 的 `name` 要能当 npm 包名用（小写、连字符）。
- 同 id 的插件只能有一个；重复会被拒绝，先挂上的那个继续工作。
- 插件**在主进程里运行**，能读写本机文件、发网络请求。写之前想一遍这是不是你要的。

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

/** 只声明真正用的服务；缺了会挂但等待，不会失败。 */
export const inject = ['pictor']

export function apply(ctx) {
  // ctx.effect 交出「插件活着期间有效」的注册：卸载时 cordis 调它，面板和视图一起消失。
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'me.my-first.view',
      title: '我的视图',
      data: ({ sessionId, pluginId }) => ({
        blocks: [
          { kind: 'heading', text: '你好' },
          { kind: 'text', text: `会话：${sessionId ?? '没有打开的会话'}` },
        ],
        note: `由 ${pluginId} 提供`,
      }),
    }),
  )

  ctx.effect(() =>
    ctx.pictor.panels({ id: 'me.my-first.panel', title: '我的面板', view: 'me.my-first.view' }),
  )
}
```

写完保存，等约一秒：**拓展 → 插件** 里出现这一行，右栏面板列表里出现「我的面板」。
挂载失败会在这页写明原因（找不到入口、JSON 语法错、重复 id），照那句话改。

## 检查它是不是真的在跑

按顺序：

1. **拓展 → 插件**：行在不在、贡献点计数对不对、有没有失败原因。
2. 打开面板，看内容 —— 那是插件真实运行的结果，不是预览。
3. 改一行 `text`，保存，看它变不变（改文件即重载）。
4. 座位类的内容（侧栏、标题栏、底部、浮层）没有面板入口，直接看窗口对应位置。

不要写 HTML 预览文件或截图脚本：装好的插件就是预览。

## 视图块（`data` 的返回值）

`data` 在面板打开和点刷新时被调用，返回 `{ blocks, note? }`。十种块：

| 块         | 载荷                                                        |
| ---------- | ----------------------------------------------------------- |
| `heading`  | `{ text }`                                                  |
| `text`     | `{ text }`，换行保留                                        |
| `markdown` | `{ text }`，和会话同一套渲染                                |
| `list`     | `{ items, ordered? }`                                       |
| `keyValue` | `{ rows: [{ label, value }] }`                              |
| `table`    | `{ columns, rows }`，每行格子数必须等于列数                 |
| `code`     | `{ text, language? }`                                       |
| `badge`    | `{ label, tone? }`，tone 为 `neutral/accent/danger/success` |
| `button`   | `{ label, action, value?, tone? }`                          |
| `divider`  | 无                                                          |

上限：200 块、单段文本 20000 字符、列表 200 项、表格 200×12。**超出会被整块拒绝**，
不会画一半 —— 所以数字别算错。

`note` 画在块下面，用来说限制（「读取于 12:00」「只在打开时读取」）。

## 按钮：消息，不是回调

`button` 只带一个 `action` id，不带函数。点了以后送到主进程的 `onAction`，回来的是一段新描述：

```js
ctx.pictor.views({
  id: 'me.build.view',
  title: '构建',
  data: () => ({ blocks: [{ kind: 'button', label: '重新构建', action: 'rebuild' }] }),
  onAction: ({ action, value }) => {
    if (action !== 'rebuild') return undefined
    return { blocks: [{ kind: 'text', text: `重建了 ${value ?? '全部'}` }] }
  },
})
```

- 返回新描述 → 替换当前内容；返回 `undefined` → 内容不动（点击生效但不闪）。
- 没写 `onAction` 的视图被点了会报错，报错里带视图名 —— 这是故意的：死按钮看起来像坏窗口。
- 点击在飞时那颗按钮被禁掉，双击不会跑两次。

## 自己的前端（`frame`）

块表达不了的东西（画布、图表、带拖拽的看板）就交一个前端包。`data` 与 `frame` **二选一**：

```js
ctx.pictor.views({
  id: 'me.board.view',
  title: '看板',
  frame: { entry: 'client.js', styles: 'client.css' },
  respond: ({ action, sessionId }) => {
    if (action !== 'load') throw new Error(`不认识的消息：${action}`)
    return { cards: [], sessionId }
  },
})
```

```js
// client.js —— 普通 ES 模块，自己的 DOM、自己的样式、自己的状态
const api = window.pictorFrame
api.onInit(({ sessionId, theme }) => {
  document.body.style.background = theme.bg // bg/surface/border/text/muted/accent
})
document.querySelector('#reload').addEventListener('click', async () => {
  const answer = await api.request('load') // 到 respond，答案或它抛出的原文
  render(answer)
})
```

**帧里没有**：网络（CSP `connect-src 'none'`）、`localStorage`（origin 不透明）、Node、
主窗口的 DOM 或 bridge、第二份 HTML（文档和 CSP 是 Pictor 写的）、插件目录以外的文件。
答案必须是 JSON 且小于 64 KiB；`undefined` 到帧里是 `null`。

尺寸由窗口决定：面板里的帧填满右栏，座位里的帧固定高度、内部滚动。刷新按钮是重挂，
帧自己保留的状态不会留到「刷新之后」。

## 座位：六个位置

`panels` 只管右栏列表。窗口别的位置用 `slots`：

| slot            | 位置                                                     | key  |
| --------------- | -------------------------------------------------------- | ---- |
| `main`          | 中间那块；`conversation` 是会话本身，其余 key 是插件页面 | 必填 |
| `sidebar`       | 左栏顶部，会话列表之上                                   | 无   |
| `rightbar`      | 右栏顶部（列表仍然在下面）                               | 无   |
| `shell.bottom`  | 三栏下面的一条；空着不占高度                             | 无   |
| `shell.overlay` | 浮层，整体点击穿透，只有 `button` 能点                   | 必填 |
| `shell.leading` | 标题栏左侧                                               | 无   |

```js
ctx.pictor.slots({ slot: 'sidebar', title: '今日', icon: 'calendar', view: 'me.today.view' })
```

同一个格子只能有一个主人，第二个注册会被拒绝。`main` 的 key `conversation` 是保留的。

## 其它贡献点

```js
// 工具调用在会话里怎么显示
ctx.pictor.toolViews({ id: 'me.fetch.view', tools: ['mcp__github__*'], label: 'GitHub' })

// 调用之前的裁决：fail closed —— 守卫连不上就是不通过
ctx.pictor.toolGuards({
  id: 'me.no-publish',
  tools: ['bash'],
  decide: ({ args }) =>
    String(args.command ?? '').includes('npm publish')
      ? { decision: 'deny', reason: '发版请走 release 流程' }
      : { decision: 'allow' },
})

// 调用之后：fail open，只能加注或改判成失败，不能放行
ctx.pictor.toolHooks({
  id: 'me.note-secrets',
  tools: ['bash'],
  after: ({ ok, output }) =>
    ok && output.includes('PRIVATE KEY') ? { note: '输出里有密钥' } : undefined,
})

// 技能：写进运行时扫描的目录，`/名字` 调用
ctx.pictor.skills({ name: 'my-skill', description: '一句话说明什么时候用', body: '# 正文' })
```

工具名匹配：精确名（`bash`、`mcp__github__create_issue`）或命名空间前缀 `*`（`mcp__github__*`）。
精确优先于前缀，长前缀优先于短前缀。

## 约定

- **id 带自己的命名空间**，全小写，`me.x.y` 这样。重复 id 会被拒绝。
- **图标用 Lucide 名**（`puzzle`、`blocks`、`terminal`）；不认识的回落到默认图标。
- **失败要说清是谁**：抛 `new Error('读不到 ~/.gitconfig')`，不要抛 `'failed'`。
- **读文件前先判断存在**；插件目录之外的东西可能不在。
- **不要写进 Pictor 的 profile 目录**（`~/.config/pictor`）：那是应用数据，安装和卸载都会动它。
  要放自己东西就用 `dataDirectory`（视图上下文里有），它按插件隔离。
- **不要留死代码**：块的种类是闭集，写了不存在的 `kind` 会被拒绝，别用注释掉的块凑数。

## 保存与版本化

插件目录就是普通目录。要不要版本化、用 git 还是别的（WebDAV、同步盘），Pictor 不介入，
也不会替你做。想用 git 就自己 `git init`；这只是目录，没有隐藏结构。
