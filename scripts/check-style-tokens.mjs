#!/usr/bin/env node
/**
 * Style guard: keeps the renderer on the design-token scale.
 *
 * - TSX may not use arbitrary typography/radius/shadow utilities such as
 *   `text-[13px]`, `rounded-[10px]`, `leading-[1.2]`, `tracking-[0.2em]`,
 *   `font-[600]` or `shadow-[0_1px_2px_rgba(0,0,0,.4)]`.
 * - CSS may not hard-code colours, font sizes or radii; those live in
 *   `styles/tokens.css` and are referenced through custom properties.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const styleRoot = join(projectRoot, 'apps/desktop/src/renderer/src')
const TOKENS_FILE = join('styles', 'tokens.css')

const ARBITRARY_UTILITY = /\b(?:text|rounded|leading|tracking|font|shadow)-\[/
const CSS_RULES = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, message: '硬编码颜色，请改用 color token' },
  { pattern: /\b(?:rgb|rgba|hsl|hsla)\(/, message: '硬编码颜色，请改用 color token' },
  { pattern: /font-size:\s*[0-9.]/, message: '硬编码字号，请改用 --text-* token' },
  {
    pattern: /border-radius:\s*(?!\s*(?:50%|999|var\(--radius-))/,
    message: '硬编码圆角，请改用 --radius-* token',
  },
]

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return collect(path)
      return /\.(?:css|tsx?)$/.test(entry.name) ? [path] : []
    }),
  )
  return files.flat()
}

function scanFile(path, source) {
  const relativePath = relative(projectRoot, path)
  const isCss = path.endsWith('.css')
  const isTokens = relativePath === join('apps/desktop/src/renderer/src', TOKENS_FILE)
  const violations = []

  source.split('\n').forEach((line, index) => {
    const lineNumber = index + 1

    if (isCss) {
      if (isTokens) return
      for (const rule of CSS_RULES) {
        if (rule.pattern.test(line)) {
          violations.push(`${relativePath}:${lineNumber}: ${rule.message}`)
        }
      }
      return
    }

    if (ARBITRARY_UTILITY.test(line)) {
      violations.push(
        `${relativePath}:${lineNumber}: 使用任意值工具类，请改用 design token（text-*, rounded-*, leading-*, tracking-*, font-*, shadow-*）`,
      )
    }
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
      violations.push(`${relativePath}:${lineNumber}: 硬编码颜色，请改用 color token`)
    }
  })

  return violations
}

const files = await collect(styleRoot)
const results = await Promise.all(
  files.map(async (path) => scanFile(path, await readFile(path, 'utf8'))),
)
const violations = results.flat()

if (violations.length > 0) {
  console.error(`样式守卫发现 ${violations.length} 处违规：\n`)
  for (const violation of violations) console.error(`  ${violation}`)
  console.error('')
  process.exit(1)
}

console.log(`样式守卫通过（${files.length} 个文件）`)
