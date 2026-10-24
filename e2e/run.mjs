import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { launch } from './harness.mjs'

/**
 * Runs every spec against one launched app.
 *
 * One app for the whole run keeps the suite fast; each spec is responsible for
 * leaving the profile usable for the next, which is why they build their own data
 * rather than relying on a fixture.
 *
 * A spec may return `{ skip: reason }` when the machine cannot host it — the
 * chat spec needs the DeepSeek runtime, which e2e never installs itself. A skip
 * is visible in the summary, and `PICTOR_E2E_STRICT=1` turns it into a failure so
 * CI cannot quietly lose the coverage it pays for.
 */
const SPECS = join(import.meta.dirname, 'specs')
const strict = process.env['PICTOR_E2E_STRICT'] === '1'

const only = process.argv[2]
const files = (await readdir(SPECS)).filter((file) => file.endsWith('.mjs')).sort()
const selected = only === undefined ? files : files.filter((file) => file.includes(only))

if (selected.length === 0) {
  console.error(`e2e: no spec matches ${only ?? '(all)'}`)
  process.exit(1)
}

const app = await launch()
let failed = 0
let skipped = 0

try {
  for (const file of selected) {
    const spec = (await import(join(SPECS, file))).default
    const started = Date.now()
    try {
      const outcome = await spec.run(app.page, app)
      if (outcome !== undefined && typeof outcome.skip === 'string') {
        skipped += 1
        console.log(`skip ${spec.name} — ${outcome.skip}`)
        if (strict) {
          failed += 1
          console.error(`FAIL ${spec.name}: skipped in strict mode`)
        }
        continue
      }
      console.log(`ok   ${spec.name} (${String(Date.now() - started)}ms)`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${spec.name}`)
      console.error(error instanceof Error ? error.stack : error)
      // A screenshot is the only way to see what the window looked like.
      const shot = join(process.env['PI_SCRATCH_DIR'] ?? '.', `e2e-${spec.name}.png`)
      await app.page.screenshot({ path: shot }).catch(() => undefined)
      console.error(`     screenshot: ${shot}`)
    }
  }
} finally {
  await app.close()
}

const summary = [`${String(selected.length - failed - skipped)} passed`]
if (skipped > 0) summary.push(`${String(skipped)} skipped`)
if (failed > 0) summary.push(`${String(failed)} failed`)
console.log(`\n${summary.join(', ')}`)
process.exit(failed === 0 ? 0 : 1)
