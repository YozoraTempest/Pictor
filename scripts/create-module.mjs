import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { stdout } from 'node:process'

const name = process.argv[2]
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  throw new Error('Usage: npm run module:new -- <kebab-case-module>')
}

const identifier = name.replace(/-([a-z0-9])/g, (_match, value) => value.toUpperCase())
const directory = resolve('src', 'modules', name)
if (
  await access(directory).then(
    () => true,
    () => false,
  )
) {
  throw new Error(`Module already exists: src/modules/${name}`)
}

const files = {
  'shared.ts': `export const ${identifier}Id = '${name}'\n`,
  'main.ts': `import { defineModule } from '../../kernel/module.js'\n\nimport { ${identifier}Id } from './shared.js'\n\nexport const ${identifier}MainModule = defineModule({\n  id: \`${'${'}${identifier}Id}.main\`,\n  activate() {},\n})\n`,
  'renderer.ts': `import { defineModule } from '../../kernel/module.js'\n\nimport { ${identifier}Id } from './shared.js'\n\nexport const ${identifier}RendererModule = defineModule({\n  id: \`${'${'}${identifier}Id}.renderer\`,\n  activate() {},\n})\n`,
  [`${name}.test.ts`]: `// @vitest-environment node\n\nimport { expect, it } from 'vitest'\n\nimport { ModuleKernel } from '../../kernel/kernel.js'\nimport { ${identifier}MainModule } from './main.js'\n\nit('activates the ${name} Main Module', async () => {\n  const kernel = new ModuleKernel()\n  await expect(kernel.start([${identifier}MainModule])).resolves.toBeUndefined()\n  await kernel.stop()\n})\n`,
}

await mkdir(directory, { recursive: true })
await Promise.all(
  Object.entries(files).map(([file, content]) =>
    writeFile(resolve(directory, file), content, 'utf8'),
  ),
)

stdout.write(
  `Created src/modules/${name}. Register the Main and Renderer Modules in the explicit catalogs.\n`,
)
