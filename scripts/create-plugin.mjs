import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { stdout } from 'node:process'

const name = process.argv[2]
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  throw new Error('Usage: npm run plugin:new -- <kebab-case-plugin>')
}

const directory = resolve('plugins', name)
if (
  await access(directory).then(
    () => true,
    () => false,
  )
) {
  throw new Error(`Plugin already exists: plugins/${name}`)
}

const packageMetadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const pluginId = `pictor.${name}`
const manifest = {
  id: pluginId,
  name: name
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' '),
  version: packageMetadata.version,
  engines: { pictor: `^${packageMetadata.version}` },
  dependencies: {},
  modules: { host: './dist/host.js', gui: './dist/gui.js' },
}
const files = {
  'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  'host.ts': `import { defineModule } from '@pictor/plugin-sdk/module'\nimport { pluginEntrypoint, type HostPluginContext } from '@pictor/plugin-sdk/plugin'\n\nexport default pluginEntrypoint<HostPluginContext>(() => [\n  defineModule({ id: '${pluginId}.host', activate() {} }),\n])\n`,
  'gui.ts': `import { createElement } from 'react'\nimport { defineModule } from '@pictor/plugin-sdk/module'\nimport { pluginEntrypoint, type GuiPluginContext } from '@pictor/plugin-sdk/plugin'\n\nexport default pluginEntrypoint<GuiPluginContext>(() => [\n  defineModule({ id: '${pluginId}.gui', activate() {\n    createElement('div', null)\n  } }),\n])\n`,
  [`${name}.test.ts`]: `// @vitest-environment node\n\nimport { expect, it } from 'vitest'\n\nimport { pluginManifestSchema } from '@pictor/plugin-sdk/manifest'\nimport manifest from './manifest.json'\n\nit('defines the ${name} Plugin package', () => {\n  expect(pluginManifestSchema.parse(manifest).id).toBe('${pluginId}')\n})\n`,
}

await mkdir(directory, { recursive: true })
await Promise.all(
  Object.entries(files).map(([file, content]) =>
    writeFile(resolve(directory, file), content, 'utf8'),
  ),
)

stdout.write(
  `Created plugins/${name}. Run npm run test:plugin -- ${name} and npm run build:plugins.\n`,
)
