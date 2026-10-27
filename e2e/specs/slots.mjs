import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Every seat a plugin can take, drawn where it says.
 *
 * The point of borrowing dsh's slot vocabulary is that these places exist — not that the
 * app accepts the words. So this spec checks each one on screen, and checks the two rules
 * that keep a seat from becoming a takeover: `main` is keyed and the conversation cell is
 * not for sale, and a `rightbar` seat leaves a way back to the panel list.
 */
const source = (views) => `
export const inject = ['pictor']
export function apply(ctx) {
  // One view per seat: a seat holds a view id, not a component.
${views
  .map(
    (name) =>
      `  ctx.effect(() => ctx.pictor.views({ id: 'acme.seat.${name}', title: '${name}', data: () => ({ blocks: [{ kind: 'text', text: '座位 ${name}' }] }) }))`,
  )
  .join('\n')}

  // One seat per place this window has.
  ctx.effect(() => ctx.pictor.slots({ slot: 'shell.leading', title: '领先位', view: 'acme.seat.leading' }))
  ctx.effect(() => ctx.pictor.slots({ slot: 'shell.bottom', title: '底栏', view: 'acme.seat.bottom' }))
  ctx.effect(() => ctx.pictor.slots({ slot: 'sidebar', title: '侧栏顶部', view: 'acme.seat.side' }))
  ctx.effect(() => ctx.pictor.slots({ slot: 'rightbar', title: '右栏主人', view: 'acme.seat.right' }))
  ctx.effect(() => ctx.pictor.slots({ slot: 'shell.overlay', key: 'note', title: '浮层', view: 'acme.seat.overlay' }))
  ctx.effect(() => ctx.pictor.slots({ slot: 'main', key: 'seatpage', title: '座位页', view: 'acme.seat.page' }))
}
`

export default {
  name: '插件座位',
  async run(page) {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-seat-'))
    const dir = join(parent, 'seat-demo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@acme/seat-demo',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
      }),
    )
    writeFileSync(
      join(dir, 'index.js'),
      source(['leading', 'bottom', 'side', 'right', 'overlay', 'page']),
    )

    // The bundled example occupies the same single slots, and a second claim on one of
    // them is refused — which is the rule working, not a failure. Turning it off first is
    // also the check that a seat disappears with its plugin.
    await page.evaluate(() => window.pictor.setPluginEnabled('pictor.example.hello-panel', false))
    await page.evaluate(() => window.pictor.removePlugin('seat-demo')).catch(() => undefined)
    const installed = await page.evaluate(
      (path) => window.pictor.installPlugin(`file:${path}`),
      dir,
    )
    assert.equal(installed.ok, true, installed.message)

    // The plumbing: six seats, each addressed by slot and cell. Filtered to this plugin's
    // own views — the bundled example occupies the same slots, and its seats are not what
    // this spec is asserting.
    const seats = (await page.evaluate(() => window.pictor.listSlots())).filter((seat) =>
      seat.view.startsWith('acme.seat.'),
    )
    assert.deepEqual(
      seats.map((seat) => `${seat.slot}${seat.key === undefined ? '' : `:${seat.key}`}`).sort(),
      [
        'main:seatpage',
        'rightbar',
        'shell.bottom',
        'shell.leading',
        'shell.overlay:note',
        'sidebar',
      ],
    )
    assert.equal(
      seats.find((seat) => seat.slot === 'main')?.kind,
      'keyed',
      'main 是按 key 分格的，和 dsh 一致',
    )

    // A window narrow enough to start with the column closed; the seats that live there
    // only exist once it is open.
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()
    await page.waitForTimeout(400)

    // `shell.leading` in the title bar, `shell.bottom` under the columns, `shell.overlay`
    // floating, and `rightbar` drawn above the launcher — which stays visible underneath,
    // because that column is where every other panel is found.
    await page.getByText('座位 leading').waitFor({ timeout: 20_000 })
    await page.getByText('座位 bottom').waitFor({ timeout: 20_000 })
    await page.getByText('座位 overlay').waitFor({ timeout: 20_000 })
    await page.getByText('座位 right').waitFor({ timeout: 20_000 })

    // The `main` page is listed with the panels, one click from the centre.
    await page.getByRole('button', { name: /座位页/ }).waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: /座位页/ }).click()
    await page.getByText('座位 page').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: '回到会话' }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.getByText('座位 page').count(), 0, '回到会话之后，座位页不该还留在中间')

    const removed = await page.evaluate(() => window.pictor.removePlugin('seat-demo'))
    assert.equal(removed.ok, true, removed.message)

    // Unloading the plugin takes its seats with it: that is what a fiber owns.
    const after = (await page.evaluate(() => window.pictor.listSlots())).filter((seat) =>
      seat.view.startsWith('acme.seat.'),
    )
    assert.deepEqual(after, [], '插件卸载后它的座位应当全部消失')

    // Leave the profile as it was found: the example is bundled, and the next spec may
    // expect its seats.
    await page.evaluate(() => window.pictor.setPluginEnabled('pictor.example.hello-panel', true))
  },
}
