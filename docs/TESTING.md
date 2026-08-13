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

## 测试分层

| 层级           | 命令                                                | 覆盖范围                                   | 运行时机                        |
| -------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------- |
| 静态检查       | `npm run check:format`、`check:types`、`check:lint` | 格式、类型、Lint                           | 本地提交前、每个 PR             |
| 单元测试       | `npm run test:unit`                                 | 纯函数、组件、服务边界                     | 开发循环、每个 PR               |
| 集成测试       | `npm run test:integration`                          | Pi adapter 与运行时协议集成                | 修改运行时边界时、每个 PR       |
| Vitest 全量    | `npm test`                                          | 单元与集成测试一次完成                     | 本地提交前、每个 PR             |
| E2E Smoke      | `npm run test:e2e:smoke:run`                        | 桌面启动、Chat 委托闭环                    | Windows/Linux PR，复用 `out/`   |
| E2E Full       | `npm run test:e2e:run`                              | 全部桌面用户场景                           | `develop`、正式发布、本地发布前 |
| Windows 包验证 | `npm run package:verify:windows`                    | NSIS、ASAR、x64 PE                         | 正式发布、本地发布前            |
| Linux 包验证   | `npm run package:verify:linux`                      | deb/pacman 元数据、桌面入口、ASAR、x64 ELF | 正式发布、本地发布前            |
| Linux 包启动   | `npm run package:verify:linux:launch`               | 打包后 Main、Preload、Renderer、平台信息   | 正式发布、目标桌面验收          |

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
- 只有跨越真实模块或进程边界的用例使用 `*.integration.test.ts`。
- Electron 用户场景放在 `e2e/*.spec.ts`，每个文件描述一个完整行为，不按页面或组件拆分。
- 公共确定性服务、测试凭据和协议响应生成器放在 `e2e/support.ts`；不要在场景之间共享可变状态。
- Smoke 用例在标题中添加 `@smoke`。只有“应用能启动”和“一条核心委托链路能完成”进入
  Smoke；设置迁移、故障恢复、第二协议和中断恢复属于 Full。
- 测试不得访问真实模型、用户目录或网络服务。E2E 必须使用 `testInfo.outputPath()` 隔离数据，
  并在 `finally` 中关闭 Electron 和本地服务。
- Main、Preload、Renderer、Runtime 和 Shared 的测试归属及允许依赖方向见
  [`ARCHITECTURE.md`](ARCHITECTURE.md)。测试不得用不安全类型强转穿透 module interface。

## Linux 专项回归

- 路径守卫必须在大小写敏感文件系统上拒绝绝对路径大小写兄弟目录和符号链接逃逸；`/Repo`
  与 `/repo` 可以注册为不同项目。Windows 路径身份继续忽略大小写。
- Bash 发现覆盖 `PICTOR_BASH_PATH`、`PATH` 和受支持平台的固定候选。缺少 Bash 只禁用命令工具，
  不阻止应用启动。
- 命令执行覆盖用户停止和超时；两种情况都要证明外层 Bash 及后台/孙进程不再存活。
- 更新资产选择覆盖 Windows NSIS、Ubuntu deb、Arch pacman、错误平台/架构/版本、非官方 URL、
  不受支持发行版和无匹配资产回退。
- API Key 在 Unix 写入后验证权限为 `0600`，且不得进入 Renderer、Session 或测试证据。

## 发行版验收

| 基线                 | 自动化证据                                       | 发布前桌面证据                                 |
| -------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Windows 11 x64       | Windows hosted runner，Smoke/Full、NSIS 结构验证 | 安装、启动、卸载                               |
| Ubuntu 24.04 LTS x64 | `ubuntu-24.04` + Xvfb，Smoke/Full、deb 安装/移除 | 真实 GNOME Wayland 会话启动与核心委托          |
| 原生 Arch Linux x64  | `archlinux:base` 包生命周期、结构验证            | 发布快照日期的 niri Wayland 会话启动与核心委托 |

Arch 衍生版和 Ubuntu 衍生版不是替代验收环境。Wayland 桌面证据允许 Electron 使用 XWayland，
但必须记录发行版、架构、内核、桌面会话、Bash 版本、产物摘要和验收日期。发布包安装/移除不得
删除既有用户数据；用户数据清理由独立、明确的手工步骤验证。

## 稳定性规则

- 不用固定延时等待业务状态；优先使用可见状态、事件或 `expect.poll`。
- 不通过提高全局重试掩盖失败。出现不稳定测试时，先记录失败证据和根因，再修复或临时隔离。
- Electron E2E 在 CI 中保持单 worker，避免共享桌面资源和用户数据竞争。
- Linux hosted runner 通过 `xvfb-run -a` 提供确定性显示服务；它不代替真实 Wayland 发布证据。
- Windows E2E 可以隐藏窗口；Linux E2E 必须让窗口进入当前显示服务的合成器，否则隐藏的
  Wayland 窗口不会产生 Playwright actionability 所需的帧。CI 窗口只显示在 Xvfb 虚拟屏幕。
- 失败证据写入 Playwright `test-results/`，CI 仅在失败时上传，保留 7 天。
- 变更行为必须同步更新对应层的测试；仅重构时不得无理由删除既有断言。

## CI 门禁

PR 并行运行质量检查和 Vitest 全量，通过后分别执行 `Windows acceptance` 与独立的
`Linux acceptance`。两端都构建一次并执行 E2E Smoke；推送 `develop` 时执行 E2E Full。
Linux acceptance 固定使用 Ubuntu 24.04 hosted runner 和 Xvfb。

合并到 `main` 后，Release 工作流在 Windows 与 Ubuntu runner 上并行执行完整验证，分别生成
Windows NSIS、Ubuntu deb 和 Arch pacman。Ubuntu runner 通过 `apt` 验证 deb 安装/移除，Arch
容器通过 `pacman` 验证 pacman 包安装/移除。所有构建成功后，单一 publish job 才创建标签与
GitHub Release，避免只发布部分平台资产。

分支保护应要求 `Quality`、`Unit and integration`、`Windows acceptance` 和
`Linux acceptance` 四个检查。结构校验和容器生命周期不代替真实目标桌面验收、签名或净机证据。
