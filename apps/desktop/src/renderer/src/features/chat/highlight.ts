import type { HighlighterCore } from 'shiki/core'

const THEME = 'github-dark-default'

/**
 * Grammars are loaded on demand so the renderer never ships the full Shiki
 * bundle. Unknown languages fall back to a plain, unhighlighted block.
 */
const LOADERS = {
  bash: () => import('shiki/langs/bash.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}

type Lang = keyof typeof LOADERS

const ALIASES: Record<string, Lang> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  jsonc: 'json',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  docker: 'dockerfile',
  gql: 'graphql',
  htm: 'html',
}

let core: Promise<HighlighterCore> | null = null
const loaded = new Set<Lang>()

/** Shiki itself is code-split; nothing is fetched until the first code block. */
function getCore(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-dark-default.mjs'),
    ])

    return createHighlighterCore({
      themes: [theme.default],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()

  return core
}

export function normalizeLanguage(raw: string | null): Lang | null {
  if (raw === null) return null

  const key = raw
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
  if (key.length === 0) return null
  if (Object.hasOwn(LOADERS, key)) return key as Lang
  return ALIASES[key] ?? null
}

/** Returns highlighted HTML, or null when the language is unknown or fails. */
export async function highlight(code: string, language: string | null): Promise<string | null> {
  const lang = normalizeLanguage(language)
  if (lang === null) return null

  try {
    const highlighter = await getCore()
    if (!loaded.has(lang)) {
      const grammar = await LOADERS[lang]()
      await highlighter.loadLanguage(grammar.default)
      loaded.add(lang)
    }

    return highlighter.codeToHtml(code, { lang, theme: THEME })
  } catch {
    return null
  }
}
