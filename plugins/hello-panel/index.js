/**
 * 一个插件长什么样。
 *
 * 这是 cordis 插件：`name`、`inject`、`apply` 三个导出。和 dsh 的插件同形，所以同一个
 * 包两边都装得上——区别只在它 inject 的服务哪边有。这里 inject 的是 `pictor`，
 * 那是 Pictor 提供的贡献入口；换成 dsh 的服务名，同一个文件就属于那边。
 *
 * 不交 React：`views` 的 `data` 返回一段描述（blocks），窗口逐块校验后用自己的组件画；
 * `panels` 只是外面那圈框 —— 标题、图标，以及它渲染哪个视图。
 *
 * 想改成自己的：换掉 id 的命名空间，块随你增减，`data` 里读你想读的东西。
 */

export const name = 'hello-panel'

/** 贡献点都在 `pictor` 这个服务上，所以只声明它一个。 */
export const inject = ['pictor']

/** 每次读取加一。note 会写着这是第几次，好让「刷新」这件事看得见。 */
let reads = 0

/** 按钮按了多少次；插件自己的状态，跨读取保留。 */
let presses = 0

export function apply(ctx) {
  // `ctx.effect` 交出的是「这个插件活着期间有效」的注册：卸载插件时 cordis 调用它，
  // 面板和视图一起消失，不需要谁记着去删。
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.today',
      title: '示例视图',
      description: '一个视图能说的所有块，以及它拿得到的上下文',
      icon: 'puzzle',
      data: ({ sessionId, dataDirectory, pluginId }) => {
        reads += 1

        return {
          blocks: [
            { kind: 'badge', label: `第 ${reads} 次读取`, tone: 'accent' },
            {
              kind: 'button',
              label: `按一下（已按 ${presses} 次）`,
              action: 'press',
              tone: 'accent',
            },
            { kind: 'heading', text: '内容是插件说的，画的是窗口' },
            {
              kind: 'text',
              text:
                '视图返回的是描述，不是组件。窗口先逐块校验，再用自己的组件画，' +
                '所以打开一个面板不会把插件的 React 加载进来。\n' +
                '一段话里的换行会保留。',
            },
            { kind: 'divider' },
            { kind: 'heading', text: '十种块' },
            {
              kind: 'list',
              ordered: true,
              items: [
                'heading / text / markdown',
                'list / keyValue / table',
                'code / badge / divider',
                'button —— 唯一能按的一块',
              ],
            },
            {
              kind: 'keyValue',
              rows: [
                { label: '插件', value: pluginId },
                { label: '会话', value: sessionId ?? '没有打开的会话' },
                { label: '数据目录', value: dataDirectory },
              ],
            },
            {
              kind: 'table',
              columns: ['块', '用来放什么'],
              rows: [
                ['text', '一段话，换行保留'],
                ['markdown', '和会话里同一套渲染'],
                ['table', '每行的格子数必须和列数一致'],
              ],
            },
            {
              kind: 'code',
              language: 'js',
              text:
                "export const inject = ['pictor']\n" +
                'export function apply(ctx) {\n' +
                "  ctx.effect(() => ctx.pictor.panels({ id: 'acme.today', title: '今日', view: 'acme.view' }))\n" +
                '}',
            },
            {
              kind: 'markdown',
              text: '`markdown` 块用的是会话里同一个渲染器，所以**强调**和 `行内代码` 都照常。',
            },
          ],
          // 画在块下面 —— 限制说明该待的地方。
          note:
            `第 ${reads} 次读取 · ${new Date().toLocaleTimeString('zh-CN')} · ` +
            '视图只在打开和按刷新时读取，不会自己轮询',
        }
      },
      // 点击回到这里，在主进程、插件旁边执行，答案是一段新的描述。按下去的那一刻窗口
      // 就把这颗按钮禁掉，所以同一颗按钮不会被按两次。
      onAction: ({ action }) => {
        if (action !== 'press') return undefined
        presses += 1
        return {
          blocks: [
            { kind: 'badge', label: `已按 ${presses} 次`, tone: 'accent' },
            {
              kind: 'button',
              label: `再按一下（已按 ${presses} 次）`,
              action: 'press',
              tone: 'accent',
            },
            { kind: 'text', text: '这一块是点击之后重新描述出来的：插件没有画任何东西。' },
          ],
        }
      },
    }),
  )

  // A seat in the title bar: small enough that the bar keeps its height, and it says
  // what the whole plugin is rather than repeating a panel.
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.leading',
      title: '标题栏座位',
      data: () => ({ blocks: [{ kind: 'text', text: '示例插件已启用' }] }),
    }),
  )

  // A seat under the columns: the strip exists only while something occupies it.
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.bottom',
      title: '底部横条',
      data: () => ({
        blocks: [
          {
            kind: 'text',
            text: '这是 shell.bottom：三栏之下的一条，空着的时候不占高度。',
          },
        ],
      }),
    }),
  )

  // The left column's top strip, the right column, and the floating layer. Between them
  // and the two above, every slot this app has is occupied by the example — which is how
  // a person can see what each one looks like before writing their own.
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.side',
      title: '左栏座位',
      data: () => ({ blocks: [{ kind: 'text', text: 'shell 的 sidebar：会话列表之上的一条。' }] }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'sidebar',
      title: '左栏座位',
      icon: 'messages-square',
      view: 'pictor.example.hello.side',
    }),
  )

  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.right',
      title: '右栏座位',
      data: () => ({
        blocks: [
          { kind: 'heading', text: 'rightbar' },
          { kind: 'text', text: '占用右栏时，面板列表往里退一步，点「返回」还能回来。' },
        ],
      }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'rightbar',
      title: '右栏座位',
      icon: 'settings',
      view: 'pictor.example.hello.right',
    }),
  )

  ctx.effect(() =>
    ctx.pictor.views({
      id: 'pictor.example.hello.float',
      title: '浮动座位',
      data: () => ({
        blocks: [{ kind: 'text', text: 'shell.overlay：浮在所有栏之上，不挡点击。' }],
      }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'shell.overlay',
      key: 'example',
      title: '浮动座位',
      icon: 'puzzle',
      view: 'pictor.example.hello.float',
    }),
  )

  // A panel is a seat in the right column; a page takes a key of the centre. Both are
  // slots, named the way dsh names them.
  ctx.effect(() =>
    ctx.pictor.panels({
      id: 'pictor.example.hello.panel',
      title: '示例面板',
      description: '一个视图能说什么',
      icon: 'puzzle',
      view: 'pictor.example.hello.today',
    }),
  )

  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'main',
      key: 'example',
      title: '示例页面',
      description: '中间那块也能被插件占一页',
      icon: 'blocks',
      view: 'pictor.example.hello.today',
    }),
  )

  // Three of the smaller seats, so the strip, the title bar and the floating layer all
  // have something in them the moment this plugin is on.
  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'shell.leading',
      title: '示例插件',
      icon: 'puzzle',
      view: 'pictor.example.hello.leading',
    }),
  )
  ctx.effect(() =>
    ctx.pictor.slots({
      slot: 'shell.bottom',
      title: '底部横条',
      view: 'pictor.example.hello.bottom',
    }),
  )

  ctx.logger?.info?.('example panel contributed')
}
