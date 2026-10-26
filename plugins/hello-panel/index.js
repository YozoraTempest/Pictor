/**
 * 一个面板插件长什么样。
 *
 * 这个文件跑在主进程里，和宿主同权限。它**不交 React**：`views` 的 `data` 返回一段
 * 描述（blocks），窗口逐块校验后用自己的组件画出来；`panels` 只是外面那圈框 ——
 * 标题、图标，以及它渲染哪个视图。
 *
 * 想改成自己的：换掉 id 的命名空间，块随你增减，`data` 里读你想读的东西。
 */

/** 每次读取加一。note 会写着这是第几次，好让「刷新」这件事看得见。 */
let reads = 0

export function activate(context) {
  context.contribute('views', {
    id: 'pictor.example.hello.today',
    title: '示例视图',
    description: '一个视图能说的所有块，以及它拿得到的上下文',
    icon: 'puzzle',
    data: ({ sessionId, dataDirectory, pluginId }) => {
      reads += 1

      return {
        blocks: [
          { kind: 'badge', label: `第 ${String(reads)} 次读取`, tone: 'accent' },
          { kind: 'heading', text: '内容是插件说的，画的是窗口' },
          {
            kind: 'text',
            text:
              '视图返回的是描述，不是组件。窗口先逐块校验，再用自己的组件画，' +
              '所以打开一个面板不会把插件的 React 加载进来。\n' +
              '一段话里的换行会保留。',
          },
          { kind: 'divider' },
          { kind: 'heading', text: '九种块' },
          {
            kind: 'list',
            ordered: true,
            items: [
              'heading / text / markdown',
              'list / keyValue / table',
              'code / badge / divider',
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
              "context.contribute('views', {\n" +
              "  id: 'acme.today',\n" +
              "  data: () => ({ blocks: [{ kind: 'text', text: '…' }] }),\n" +
              '})',
          },
          {
            kind: 'markdown',
            text: '`markdown` 块用的是会话里同一个渲染器，所以**强调**和 `行内代码` 都照常。',
          },
        ],
        // 画在块下面 —— 限制说明该待的地方。
        note:
          `第 ${String(reads)} 次读取 · ${new Date().toLocaleTimeString('zh-CN')} · ` +
          '视图只在打开和按刷新时读取，不会自己轮询',
      }
    },
  })

  context.contribute('panels', {
    id: 'pictor.example.hello.panel',
    title: '示例面板',
    description: '一个视图能说什么',
    icon: 'puzzle',
    view: 'pictor.example.hello.today',
  })

  context.logger.info('example panel contributed')
}
