export interface CliHelpDocument {
  readonly usage: string
  readonly options: readonly string[]
  readonly commands: readonly string[]
  readonly notes: readonly string[]
}

export const CLI_HELP: CliHelpDocument = Object.freeze({
  usage: 'pictor [options] <command>',
  options: Object.freeze([
    '--json, --output <format>      输出 text 或一个 JSON 文档',
    '--user-data-dir <path>         使用指定的 user-data/profile 目录',
    '--profile <default|developer> 选择 Plugin Profile',
    '--safe-mode                    不激活 Plugin Module',
    '-h, --help                     显示帮助',
    '-v, --version                  显示版本',
  ]),
  commands: Object.freeze([
    'help [topic]                   显示 CLI 用法',
    'version                        显示版本',
    'doctor                         运行应用诊断',
    'plugin list                    列出 Plugin、Extension 和 Package',
    'plugin install --source <source> --path <path>',
    'plugin install --source pi-package-spec --spec <spec>',
    'plugin enable --kind <kind> --id <id>',
    'plugin disable --kind <kind> --id <id>',
    'plugin remove --kind <kind> --id <id> [--delete-data]',
    'plugin restore --id <id>',
    'ui list|install|enable|disable|restore  plugin.* 的 CLI 语义别名',
  ]),
  notes: Object.freeze([
    'source: local | development | pi-extension | pi-package | pi-package-spec',
    'kind: pictor-plugin | pi-extension | pi-package',
    '除 help/version 外的命令会独占当前 Profile，退出时释放锁。',
    'CLI 不启动 Electron；Agent Runtime-only 操作在 CLI 中明确返回不可用错误。',
  ]),
})

export function formatHelp(document: CliHelpDocument = CLI_HELP): string {
  return [
    `Usage: ${document.usage}`,
    '',
    'Options:',
    ...document.options,
    '',
    'Commands:',
    ...document.commands,
    '',
    'Notes:',
    ...document.notes,
    '',
  ].join('\n')
}
