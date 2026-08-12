# 测试规范

本规范定义 Pictor 的测试分层、命令边界和 CI 门禁。目标是让日常反馈保持快速，同时把真实
Electron、utility process、打包等高成本验证留在需要它们的阶段。

## 环境准备

使用 `.nvmrc` 声明的 Node.js 版本和 `package.json` 声明的 npm 版本。首次检出或 Electron
版本变化后运行：

```powershell
npm ci
npm run deps:prepare
npm run deps:verify
```

`npm ci` 只恢复锁定的 Node 依赖。Electron 43 不再通过依赖安装脚本下载运行时，
`deps:prepare` 显式下载与 npm 包版本匹配的 Electron，`deps:verify` 检查其可执行文件是否存在。
通过 HTTP(S) 代理下载时，先在当前 PowerShell 会话设置
`$env:ELECTRON_GET_USE_PROXY = 'true'`，让 Electron 下载器读取标准代理环境变量。
依赖升级时应同时查看 `npm approve-scripts --allow-scripts-pending --json`，逐项审查安装脚本，
不得为了消除提示而批量放行。

## 测试分层

| 层级        | 命令                                                | 覆盖范围                    | 运行时机                        |
| ----------- | --------------------------------------------------- | --------------------------- | ------------------------------- |
| 静态检查    | `npm run check:format`、`check:types`、`check:lint` | 格式、类型、Lint            | 本地提交前、每个 PR             |
| 单元测试    | `npm run test:unit`                                 | 纯函数、组件、服务边界      | 开发循环、每个 PR               |
| 集成测试    | `npm run test:integration`                          | Pi adapter 与运行时协议集成 | 修改运行时边界时、每个 PR       |
| Vitest 全量 | `npm test`                                          | 单元与集成测试一次完成      | 本地提交前、每个 PR             |
| E2E Smoke   | `npm run test:e2e:smoke:run`                        | 桌面启动、Chat 委托闭环     | PR，复用已构建的 `out/`         |
| E2E Full    | `npm run test:e2e:run`                              | 六个桌面用户场景            | `develop`、正式发布、本地发布前 |
| 包验证      | `npm run package:verify`                            | 安装包、ASAR、x64 PE 结构   | 正式发布、本地发布前            |

聚合命令：

```powershell
npm run verify:fast     # 静态检查 + Vitest 全量
npm run verify:pr       # verify:fast + 一次构建 + E2E Smoke
npm run verify:release  # verify:fast + 一次构建 + E2E Full + 打包校验
```

`*:run` 是只消费已有产物的叶子命令，不负责构建。`test:e2e`、`test:e2e:smoke`、`package`
等便捷命令会自行构建，适合独立调用。聚合命令必须调用叶子命令，避免重复构建或重复测试。

## 用例放置

- 与实现同层的 `*.test.ts(x)` 默认属于单元测试。
- 只有跨越真实模块或进程边界的用例使用 `*.integration.test.ts`。
- Electron 用户场景放在 `e2e/*.spec.ts`，每个文件描述一个完整行为，不按页面或组件拆分。
- 公共确定性服务、测试凭据和协议响应生成器放在 `e2e/support.ts`；不要在场景之间共享可变状态。
- Smoke 用例在标题中添加 `@smoke`。只有“应用能启动”和“一条核心委托链路能完成”进入
  Smoke；设置迁移、故障恢复、第二协议和中断恢复属于 Full。
- 测试不得访问真实模型、用户目录或网络服务。E2E 必须使用 `testInfo.outputPath()` 隔离数据，
  并在 `finally` 中关闭 Electron 和本地服务。
- Main、Preload、Renderer、Runtime 和 Shared 的测试归属及允许依赖方向见
  [`ARCHITECTURE.md`](ARCHITECTURE.md)。测试不得用不安全类型强转穿透 module interface。

## 稳定性规则

- 不用固定延时等待业务状态；优先使用可见状态、事件或 `expect.poll`。
- 不通过提高全局重试掩盖失败。出现不稳定测试时，先记录失败证据和根因，再修复或临时隔离。
- Electron E2E 在 CI 中保持单 worker，避免共享桌面资源和用户数据竞争。
- 失败证据写入 Playwright `test-results/`，CI 仅在失败时上传，保留 7 天。
- 变更行为必须同步更新对应层的测试；仅重构时不得无理由删除既有断言。

## CI 门禁

PR 并行运行质量检查和 Vitest 全量，通过后在 Windows 上构建一次并执行 E2E Smoke。推送
`develop` 时执行 E2E Full。合并到 `main` 后，Release 工作流会再次执行完整验证、Windows
打包与结构校验，并创建版本标签和 GitHub Release。分支保护应要求 `Quality`、
`Unit and integration` 和 `Windows acceptance` 三个检查。

安装程序的真实安装、首次启动、卸载和签名仍属于发布验收，不由 `package:verify` 代替。
