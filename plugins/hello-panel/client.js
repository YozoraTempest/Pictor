/**
 * 插件自己的前端。
 *
 * 这是普通网页代码：自己建 DOM、自己挂事件、自己的状态。区别只在边界 —— 它在沙箱里跑，
 * 没有同源、没有 Node、没有网，唯一出去的路是 `window.pictorFrame`。
 *
 * 三个可用的东西：
 *   pictorFrame.request(action, value) -> Promise，问主进程里的插件
 *   pictorFrame.onInit(fn)             -> 窗口连上时给它会话和配色
 *   （就这样。其余全是浏览器本来的东西。）
 */

const api = window.pictorFrame
const root = document.getElementById('root')

const title = document.createElement('h2')
title.textContent = '这个界面是插件画的'
title.className = 'title'

const note = document.createElement('p')
note.className = 'note'
note.textContent = '窗口只提供了一个沙箱和一个消息通道，剩下的每一像素都来自这个包。'

const press = document.createElement('button')
press.className = 'press'
press.textContent = '按一下'

const said = document.createElement('p')
said.className = 'said'
said.textContent = '还没有和插件说过话'

const where = document.createElement('p')
where.className = 'where'
where.textContent = '（还没收到窗口的上下文）'

press.addEventListener('click', () => {
  press.disabled = true
  // 发出去的只有名字和一句话；插件那边按自己的状态回答。
  api
    .request('press', 'frame')
    .then((answer) => {
      said.textContent = `插件说：这是第 ${answer.presses} 次`
      said.dataset.count = String(answer.presses)
    })
    .catch((error) => {
      // 插件用 thrown Error 的原文回答，所以这里能显示它自己的话。
      said.textContent = `插件拒绝了：${error.message}`
    })
    .finally(() => {
      press.disabled = false
    })
})

// 窗口连上时才会发上下文，早发没有意义 —— 这个回调也可能先于别人注册。
api.onInit((context) => {
  where.textContent = `会话：${context.sessionId ?? '没有打开的会话'}`
  document.documentElement.style.setProperty('--accent', context.theme.accent)
})

root.append(title, note, press, said, where)
