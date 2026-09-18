# 测试与 CI

本文只保留贡献者需要执行的验证命令和 CI 契约。测试取舍、历史门禁设计和发行证据由维护者的
Trilium「开源项目知识库 / Pictor」维护。

## 环境

使用 `.nvmrc` 与 `package.json` 固定的 Node.js/npm 版本。首次检出运行：

```bash
npm ci
```

只有维护 Electron 薄壳或桌面打包时才需要额外运行：

```bash
npm run deps:prepare
npm run deps:verify
```

`npm ci` 只安装锁定的 Node 依赖；Electron runtime 由 `deps:prepare` 显式下载并由
`deps:verify` 检查。使用代理时设置 `ELECTRON_GET_USE_PROXY=true`。自动化测试必须使用独立临时
user-data，不访问真实用户目录、模型服务或凭据。

## 日常命令

| 目的                          | 命令                            |
| ----------------------------- | ------------------------------- |
| 格式、类型、Lint 与全部测试域 | `npm run verify:fast`           |
| 全部测试域                    | `npm test`                      |
| Pictor Core                   | `npm run test:core`             |
| 全部 Bundled Plugins          | `npm run test:plugins`          |
| 单个 Feature                  | `npm run test:module -- <name>` |
| 单个 Plugin                   | `npm run test:plugin -- <name>` |
| Plugin SDK                    | `npm run test:sdk`              |
| Core 单元测试                 | `npm run test:unit`             |
| Core 集成测试                 | `npm run test:integration`      |
| Core Watch 模式               | `npm run test:watch`            |
| Plugin Watch 模式             | `npm run test:plugins:watch`    |
| Web 创造模式定向验证          | `npm run test:web`              |
| Web 开发与生产构建验收        | `npm run verify:web`            |
| 可安装 Web 包黑盒验收         | `npm run package:web`           |
| PR 级本地验收                 | `npm run verify:pr`             |
| 可选的当前平台发布预检        | `npm run verify:release`        |

测试按所有权分为三个互斥域：

- Core 测试验证 `src/` 中的 Kernel、Application、Frontend、Plugin Host 基础设施和 Adapter，不
  收集具体产品 Plugin 或 Plugin SDK 测试。
- Plugin 测试验证 `plugins/` 中的 Bundled Plugin、Plugin 源码约束和真实组装。Manifest、CLI 与
  TUI 组装验收复用一次临时 Bundled Plugin 构建。
- Plugin SDK 测试由 `packages/plugin-sdk` 自己的 Vitest 配置收集。

`npm test` 顺序执行三个域；单独运行 `test:core` 不会构建 Bundled Plugin。

聚合命令的边界：

```text
verify:fast    静态检查 + Core + Bundled Plugins + Plugin SDK
verify:web     verify:fast + Bundled Plugin/Web Client/Web Host 构建
verify:pr      verify:fast + 共享 Web GUI、Electron Main/Preload 与全部 Frontend distribution build
verify:release verify:fast + 同一 distribution 上的当前平台打包和黑盒验收
```

`package:web:verify` 与 `package:verify` 都只消费已有产物；`package:web` 和 `package` 等便捷命令会
自行构建。聚合命令应复用叶子命令，不能重复构建同一快照。

`test:web` 只覆盖 Web 连接恢复、Host generation、创造模式 watcher 和开发监督器参数等稳定 seam；
Plugin Manager 的创造模式界面仍由 `test:plugins` 验证。开发闭环的人工 smoke 使用
`npm run dev -- --no-open`，确认固定端口启动、一次 Plugin 源码改动触发原子构建与 Host 重启、原有
浏览器 Session 在重启后继续可用。该 smoke 不新增 E2E Runner。

## 分层规则

- `*.test.ts(x)` 与实现同层，验证纯逻辑、组件或一个公开 Interface。
- `*.integration.test.ts` 只用于跨真实 Module、Plugin、Runtime 或协议边界的行为。
- 打包脚本验证发布物结构、launcher、Fuse、Profile 锁与安装生命周期，不重复富 DOM 行为。

测试必须通过公开 Interface 观察结果，不得导入私有实现或用不安全类型强转穿透边界。Feature
专用 fixture 负责创建和清理自己的 user-data、项目、端点与进程；不同用例不得共享可变状态。

## E2E 政策

仓库当前不包含 E2E 测试、E2E Runner 依赖或 E2E CI 入口。未经维护者针对具体场景明确批准，
不得新增这些内容。申请新增时必须说明目标风险为何无法在 Core、Plugin、SDK 或集成测试的稳定
seam 中验证，并给出确定性的等待、清理、失败证据和 CI 成本方案。

这项限制不影响 `package:web:verify` 或 `package:verify`：它们是正式发布物的黑盒结构与启动验收，
不承担产品交互流程测试。

## CI 门禁

普通 Pull Request 和 `develop` push 使用四项稳定检查：

| 检查                   | 内容                                         |
| ---------------------- | -------------------------------------------- |
| `Quality`              | Workflow、分支/发布元数据、格式、类型与 Lint |
| `Unit and integration` | 分步执行 Core、Bundled Plugin 与 Plugin SDK  |
| `Windows acceptance`   | 在 Windows 构建 Web 应用                     |
| `Linux acceptance`     | 在 Linux 构建 Web 应用                       |

基础 CI 不下载 Electron，也不根据手写源码路径改变 required checks。触及依赖、Plugin SDK、Plugin、
Frontend、构建、打包或 Workflow 的 PR 另外触发非 required 的 `Package CI`：`package-web.yml`
在 Linux 构建包并分别于 Linux、Windows 全局安装和启动默认 Web 包，`package-desktop.yml` 继续构建
NSIS、Pacman 与 AppImage 作为兼容性证据。

普通开发 PR 使用 `development` 构建通道，不重复源码验证。`develop` 或 `hotfix/*` 指向 `main`
的发布 PR 使用 `stable` 通道并启用 `run_source_validation`，因此发布级源码与包验收在合并前
完成。路径受限的 `ci/*` 到 `main` 仍使用轻量模式，不冒充正式发布候选。

Nightly 与 Release 复用 `package-web.yml`，自动发布 Web `.tgz` 和 `SHA256SUMS`。Electron 桌面资产
不进入自动发布路径；维护者只能手动运行 `Publish desktop packages`，从已有 Release tag 的精确提交
构建并追加三个桌面资产和 `SHA256SUMS-desktop`。滚动 Nightly 被下一次自动发布整体替换后，需要重新
执行该手动 Workflow 才会再次包含桌面资产。

## 发布包验收

默认 Web 发布包使用：

```bash
npm run package:web
```

命令构建 Web Client、Host 和 Bundled Plugin，生成 `.tgz`，在仓库外的隔离 prefix 执行真实 npm
全局安装，再通过 npm 生成的真实 `pictor-web` 命令验证构建 identity、无 Electron 依赖、启动 token、
session cookie、根页面和 AppInfo HTTP API。Package CI 在 Linux 和 Windows 各执行一次该安装 smoke。

Electron 兼容打包必须先运行：

```bash
npm run build:distribution
```

它清理旧产物并构建同一源码快照的共享 Web GUI、Electron Main/Preload、CLI、TUI 与 Bundled
Plugin。Electron GUI 不再构建第二份 Renderer。手动桌面平台命令为：

```bash
npm run package:windows:build
npm run package:linux:build
npm run package:verify
```

`package:verify` 消费已有包，不重建。它验证真实 launcher、随机端口的回环 Web Host GUI page
target、CLI/TUI、Profile
排他锁、Electron Fuse 和平台包结构；Windows CI 补充 NSIS 安装/卸载，Linux CI 补充 AppImage
启动与 Arch 容器 Pacman 生命周期。

支持基线：

| 环境                    | 自动化证据                      | 补充证据                   |
| ----------------------- | ------------------------------- | -------------------------- |
| Windows 11 x64          | hosted runner Shell 与 NSIS     | 净机安装、启动和卸载       |
| 原生 Arch Linux x64     | Arch 容器包生命周期             | 发布快照上的 niri 桌面验收 |
| 其他 Linux x64 AppImage | hosted runner 结构与 Xvfb smoke | 不形成发行版兼容承诺       |

## 稳定性规则

- 使用可见状态、事件、poll 或协议响应等待结果，不用固定 sleep。
- 不提高全局重试或超时来掩盖失败；先定位根因，再修复或有期限地隔离。
- Vitest 最多使用 4 个 worker。
- 关闭与恢复场景必须设置明确上限，并在失败时清理完整进程树。
- 行为变化必须更新最接近其稳定 seam 的测试；纯重构不得无理由删除断言。
- API Key、完整用户数据和真实项目内容不得进入日志、fixture 或 CI artifact。
