import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 开发指南，作为技能出货。
 *
 * 这不是示例插件，是给 agent 看的手册：它自己就是「技能贡献点」的用法示例——`apply` 里
 * 注册一个技能，正文从同目录的 `SKILL.md` 读，插件卸载时 cordis 把写出去的技能文件一起撤掉。
 *
 * 为什么要写成插件而不是硬编码：技能是随 API 演进的东西，跟着仓库走、能在拓展页里关掉、
 * 关掉后文件真的消失 —— 这三点都和插件生命周期一致。
 *
 * 正文里带上了开发目录的绝对路径：agent 读技能时手上不一定有别的上下文，写错地方比不写更糟。
 */

export const name = 'pictor-guide'

export const inject = ['pictor']

/**
 * 技能正文，开发目录的实际位置填进去。
 *
 * 导出而不是就地算：测试要拿同一个函数和主进程那边算出来的路径对一次，否则手册和代码会各说
 * 一套 —— 手册照样读得通，而 agent 写的插件落在没人监听的地方。
 */
export function skillBody(home = homedir(), environment = process.env) {
  const template = readFileSync(fileURLToPath(new URL('./SKILL.md', import.meta.url)), 'utf8')
  // Same rule as the app computes: an explicit location wins, otherwise the person's own
  // directory. Kept in step by a test in the app, because a manual that names the wrong
  // folder is worse than no manual.
  const override = environment.PICTOR_DEVELOPMENT_PLUGINS
  const directory =
    override !== undefined && override.length > 0
      ? resolve(override)
      : join(home, 'Pictor', 'plugins')
  return template.replaceAll('{{DEVELOPMENT_DIRECTORY}}', directory)
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.pictor.skills({
      name: 'pictor-plugin-development',
      description:
        '写、改、调试一个 Pictor 插件：视图块、按钮与动作、带前端的帧视图、插槽座位、工具守卫与钩子、技能。用户说「做一个插件」「加个面板」「让它显示…」时用。',
      whenToUse:
        '用户要在 Pictor 里新增或修改插件能力时；也包括「我想让侧栏/标题栏/右栏多一个东西」这类请求。',
      body: skillBody(),
    }),
  )
}
