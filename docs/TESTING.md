# 测试规范

本规范定义 Pictor 的测试分层、命令边界和 CI 门禁。目标是让日常反馈保持快速，同时把真实
Electron、utility process、打包和发行版生命周期等高成本验证留在需要它们的阶段。

## 环境准备

使用 `.nvmrc` 声明的 Node.js 版本和 `package.json` 声明的 npm 版本。首次检出或 Electron
版本变化后运行：

```bash
npm ci
npm run deps:prepare
npm run deps:verify
```

`npm ci` 只恢复锁定的 Node 依赖。Electron 43 不再通过依赖安装脚本下载运行时，
`deps:prepare` 显式下载与 npm 包版本匹配的 Electron，`deps:verify` 检查其可执行文件是否存在。
通过 HTTP(S) 代理下载时，设置 `ELECTRON_GET_USE_PROXY=true`，让 Electron 下载器读取标准代理
环境变量。依赖升级时应同时查看 `npm approve-scripts --allow-scripts-pending --json`，逐项审查
安装脚本，不得为了消除提示而批量放行。

应用开发与测试使用独立进程：`npm run dev` 只运行 electron-vite watch/HMR，`npm run test:watch`
单独运行 Vitest。开发模式使用 `pictor-dev` userData，自动化测试继续使用独占临时目录。

## 测试分层

| 层级           | 命令                                                | 覆盖范围                                      | 运行时机                        |
| -------------- | --------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| 静态检查       | `npm run check:format`、`check:types`、`check:lint` | 格式、类型、Lint                              | 本地提交前、每个 PR             |
| Module 测试    | `npm run test:module -- <name>`                     | 单个 Feature 目录                             | 对应 Feature 开发循环           |
| Plugin 测试    | `npm run test:plugin -- <name>`                     | 单个 Plugin 或 `host` 底座                    | Plugin 开发循环                 |
| 单元测试       | `npm run test:unit`                                 | 纯函数、组件、服务边界                        | 开发循环、每个 PR               |
| 集成测试       | `npm run test:integration`                          | Pi adapter 与运行时协议集成                   | 修改运行时边界时、每个 PR       |
| Vitest 全量    | `npm test`                                          | 单元与集成测试一次完成                        | 本地提交前、每个 PR             |
| E2E Smoke      | `npm run test:e2e:smoke:run`                        | 桌面启动、Chat 委托闭环                       | Windows/Linux PR，复用 `out/`   |
| E2E Full       | `npm run test:e2e:run`                              | 全部桌面用户场景                              | `develop`、正式发布、本地发布前 |
| Windows 包验证 | `npm run package:verify:windows`                    | NSIS、ASAR、x64 PE                            | 正式发布、本地发布前            |
| Linux 包验证   | `npm run package:verify:linux`                      | Pacman/AppImage、桌面入口、ASAR、x64 ELF      | `develop`、正式发布、本地发布前 |
| Linux 包启动   | `npm run package:verify:linux:launch`               | 打包后 Main、Preload、Renderer 终态与平台信息 | `develop`、正式发布、桌面验收   |

聚合命令：

```bash
npm run verify:fast     # 静态检查 + Vitest 全量
npm run verify:pr       # verify:fast + 一次构建 + E2E Smoke
npm run verify:release  # verify:fast + 一次构建 + E2E Full + 当前平台打包校验
```

`*:run` 是只消费已有产物的叶子命令，不负责构建。`test:e2e`、`test:e2e:smoke`、`package`
等便捷命令会自行构建，适合独立调用。聚合命令必须调用叶子命令，避免重复构建或重复测试。

## 用例放置

- 与实现同层的 `*.test.ts(x)` 默认属于单元测试。
- Kernel 测试通过公开 Interface 验证依赖排序、Provider、Contribution 和逆序释放；Feature 测试
  通过 Module Interface 或 contract router 验证，不读取 Kernel 内部状态。
- Plugin 测试通过 Manifest、Registry、依赖规划、Plugin Host 或 Plugin Store 的公开 Interface
  验证。必须覆盖拓扑顺序、完整循环链、缺失/禁用/版本不兼容依赖、激活失败隔离、零 Plugin、
  安全模式、Bundled 删除后不自动恢复，以及代码与数据的独立删除语义。
- 核心委托 Smoke 必须通过从用户 Store 动态加载的 Runtime Plugin 完成真实 Pi SDK 与 utility
  process 闭环；Main 构建产物中不得依赖静态 Pi adapter 启动路径。
- Native Pi Extension 集成必须至少使用一个上游未修改示例，验证 Store 安装、Runtime bundle 的
  Jiti virtual module 解析、动态 Tool、通用 Tool card 和结果；另用 RPC UI Extension 验证 dialog
  event/response 在 Renderer 与 utility process 之间完整往返。
- Pi Runtime 集成覆盖原生 queue event、Session stats、Skills/Prompt resource path 和凭据脱敏；
  E2E 必须看到由真实 Pi Session 产生的 token usage，而不是 Renderer 计算的替代值。
- Pi Session 投影测试使用真实 JSONL 形态覆盖 parent/branch、compaction、Tool、usage 和终态错误；
  相同 JSONL 必须产生稳定投影。持久化测试必须覆盖首次 identity 绑定、重启重建、已有 Pi identity
  的 schema v1 迁移，以及无 Pi JSONL 的 v1 只读归档，不能用旧平面消息自动制造新上下文。
- 零 Plugin E2E 先通过真实 Store 将全部 Bundled Plugin 标记为 `removed`，重启后只能由 Core
  Shell 提供 Plugin Manager；安全模式使用同一 Core Shell，但不改变用户 Registry。
- `npm run plugin:new -- <name>` 生成的包必须立即能由 `npm run test:plugin -- <name>` 独立测试，
  并能被 `npm run build:plugins` 构建；Plugin 测试不要求启动开发服务器。
- 只有跨越真实模块或进程边界的用例使用 `*.integration.test.ts`。
- Electron 用户场景放在 `e2e/*.spec.ts`，每个文件描述一个完整行为，不按页面或组件拆分。
- 公共确定性服务、测试凭据和协议响应生成器放在 `e2e/support.ts`；不要在场景之间共享可变状态。
- Smoke 用例在标题中添加 `@smoke`。单一核心委托场景同时验证应用启动、Renderer 隔离和完整
  委托链路；独立 Shell、设置迁移、故障恢复、第二协议和中断恢复属于 Full。
- 测试不得访问真实模型、用户目录或网络服务。E2E 必须使用 `testInfo.outputPath()` 隔离数据，
  并在 `finally` 中关闭 Electron 和本地服务。验证退出生命周期的场景必须给关闭等待设置明确
  上限，超时后终止测试进程并报告退出失败，不能消耗整个场景超时。
- 目标桌面验收可设置 `PICTOR_E2E_EXECUTABLE`，让核心委托 Smoke 直接启动已安装或已解包的
  发布应用；变量未设置时继续使用仓库构建产物。
- Main、Preload、Renderer、Runtime 和 Shared 的测试归属及允许依赖方向见
  [`ARCHITECTURE.md`](ARCHITECTURE.md)。测试不得用不安全类型强转穿透 module interface。

## Linux 专项回归

- 路径守卫必须在大小写敏感文件系统上拒绝绝对路径大小写兄弟目录和符号链接逃逸；`/Repo`
  与 `/repo` 可以注册为不同项目。Windows 路径身份继续忽略大小写。
- Bash 发现覆盖 `PICTOR_BASH_PATH`、`PATH` 和受支持平台的固定候选；Main 必须传递经过
  `realpath` 验证的绝对普通可执行文件。缺少 Bash 只禁用命令工具，不阻止应用启动。
- 命令环境必须移除 `BASH_ENV`、`ENV`、导出的 Bash 函数和其他隐式启动变量，避免审批框未
  展示的脚本先于获批命令运行。
- 命令执行覆盖用户停止和超时；两种情况都要证明外层 Bash 及后台/孙进程不再存活。
- 更新资产选择覆盖 Windows NSIS、Arch pacman、便携 AppImage、错误平台/架构/版本、非官方 URL
  和无匹配资产回退。
- Pacman 使用 `zstd` 压缩，优先缩短 develop 与 Release 的包构建反馈；不为减小附件体积改回
  明显更慢的 `xz`。
- API Key 在 Unix 写入后验证权限为 `0600`，且不得进入 Renderer、Session 或测试证据。

## 发行版验收

| 基线                    | 自动化证据                                      | 补充桌面证据                                   |
| ----------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Windows 11 x64          | Windows hosted runner，Smoke/Full、NSIS 验证    | 安装、启动、卸载                               |
| 原生 Arch Linux x64     | `archlinux:base` Pacman 生命周期、结构验证      | 发布快照日期的 niri Wayland 会话启动与核心委托 |
| 便携 AppImage（非基线） | Linux hosted runner，结构验证和 Xvfb 启动 Smoke | 不构成其他发行版兼容承诺                       |

Arch 衍生版不是替代验收环境。Arch Wayland 桌面证据允许 Electron 使用 XWayland，并记录
发行版、架构、内核、桌面会话、Bash 版本、产物摘要和验收日期。Ubuntu hosted runner 只是
构建与 AppImage Smoke 基础设施，不是 Supported Distribution。Pacman 安装/移除不得删除既有
用户数据；用户数据清理由独立、明确的手工步骤验证。

## 稳定性规则

- 不用固定延时等待业务状态；优先使用可见状态、事件或 `expect.poll`。
- 不通过提高全局重试掩盖失败。出现不稳定测试时，先记录失败证据和根因，再修复或临时隔离。
- Electron E2E 在 CI 中保持单 worker，避免共享桌面资源和用户数据竞争。
- Linux hosted runner 通过 `xvfb-run -a` 提供确定性显示服务，用于 AppImage 启动 Smoke，不
  代表该 runner 的发行版获得正式支持。
- 已安装包启动探针必须等待 Renderer 进入 `.app-shell` 或 `.fatal-state` 明确终态；不得在
  `DOMContentLoaded` 后立即采样，也不得用固定延时掩盖异步初始化。
- Windows E2E 可以隐藏窗口；Linux E2E 必须让窗口进入当前显示服务的合成器，否则隐藏的
  Wayland 窗口不会产生 Playwright actionability 所需的帧。CI 窗口只显示在 Xvfb 虚拟屏幕。
- 失败证据写入 Playwright `test-results/`，CI 仅在失败时上传，保留 7 天。
- 变更行为必须同步更新对应层的测试；仅重构时不得无理由删除既有断言。

## CI 门禁

PR 同时启动 `Quality`、`Unit and integration`、`Windows acceptance` 和 `Linux acceptance`
四项必需检查，不用静态检查串行阻塞桌面 Smoke。Quality 与全量 Vitest 在 Linux 运行，以覆盖
大小写敏感文件系统及全部 POSIX 用例；Windows 由真实 Electron Smoke 覆盖。Linux acceptance
只构建应用并执行 E2E Smoke，不重复 Vitest，也不构建发行包。推送 `develop` 时两端执行 E2E
Full，Linux 额外构建并校验 AppImage/Pacman、启动 AppImage，并在原生 Arch 容器中复用与
Release 相同的 pacman 安装、注册、移除和用户数据保留脚本。原生 niri 桌面证据仍在发布前由
Arch 工作站补充。

合并到 `main` 后，Release 工作流在 Windows 与 Linux hosted runner 上并行执行完整验证，生成
Windows NSIS、Arch pacman 和便携 AppImage。Arch 容器通过 `pacman` 验证原生包生命周期，
hosted runner 对 AppImage 执行结构与启动 Smoke。所有构建成功后，单一 publish job 才创建
标签与 GitHub Release，避免只发布部分平台资产。

分支保护应要求 `Quality`、`Unit and integration`、`Windows acceptance` 和
`Linux acceptance` 四个检查。结构校验和容器生命周期不代替签名、Windows 净机证据或 Arch
niri 桌面证据；Arch 桌面证据按发布快照记录。
