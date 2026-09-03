# 测试与 CI

本文只保留贡献者需要执行的验证命令和 CI 契约。测试取舍、历史门禁设计和发行证据由维护者的
Trilium「开源项目知识库 / Pictor」维护。

## 环境

使用 `.nvmrc` 与 `package.json` 固定的 Node.js/npm 版本。首次检出或 Electron 版本变化后运行：

```bash
npm ci
npm run deps:prepare
npm run deps:verify
```

`npm ci` 只安装锁定的 Node 依赖；Electron runtime 由 `deps:prepare` 显式下载并由
`deps:verify` 检查。使用代理时设置 `ELECTRON_GET_USE_PROXY=true`。自动化测试必须使用独立临时
user-data，不访问真实用户目录、模型服务或凭据。

## 日常命令

| 目的                           | 命令                            |
| ------------------------------ | ------------------------------- |
| 格式、类型、Lint 与全部 Vitest | `npm run verify:fast`           |
| 单个 Feature                   | `npm run test:module -- <name>` |
| 单个 Plugin                    | `npm run test:plugin -- <name>` |
| Plugin SDK                     | `npm run test:sdk`              |
| 单元测试                       | `npm run test:unit`             |
| 集成测试                       | `npm run test:integration`      |
| Watch 模式                     | `npm run test:watch`            |
| PR 级本地验收                  | `npm run verify:pr`             |
| 当前平台发布验收               | `npm run verify:release`        |

聚合命令的边界：

```text
verify:fast    静态检查 + 全部 Vitest
verify:pr      verify:fast + 一次完整 distribution build + 核心 Electron smoke
verify:release verify:fast + 同一 distribution 上的完整 E2E + 当前平台打包和黑盒验收
```

`*:run` 命令只消费已有产物；`test:e2e`、`package` 等便捷命令会自行构建。聚合命令应复用叶子
命令，不能重复构建同一快照。

## 分层规则

- `*.test.ts(x)` 与实现同层，验证纯逻辑、组件或一个公开 Interface。
- `*.integration.test.ts` 只用于跨真实 Module、Plugin、Runtime 或协议边界的行为。
- `e2e/*.spec.ts` 只保留必须由真实 Electron、utility process、Renderer 或重启生命周期证明的
  组装行为。
- 打包脚本验证发布物结构、launcher、Fuse、Profile 锁与安装生命周期，不重复富 DOM 行为。

测试必须通过公开 Interface 观察结果，不得导入私有实现或用不安全类型强转穿透边界。Feature
专用 fixture 负责创建和清理自己的 user-data、项目、端点与进程；不同用例不得共享可变状态。

## E2E 边界

E2E 不是业务规则的主要验证层。当前只保留以下跨边界证据：

- Windows Shell：Main、Preload、Renderer、Bridge、sandbox 和基础界面可组装。
- 核心 Delegate smoke：从用户 Plugin Store 动态加载 Runtime Plugin，经真实 Pi SDK 与 utility
  process 完成一次确定性委托。
- 中断和启动恢复：跨进程退出后的状态与持久化行为。
- 原生 Pi Extension：Tool 与 RPC UI 的完整往返。
- Plugin 生命周期：关键移除、恢复和重启路径。

Fork/Clone、Import/Export、Tree、Compaction、消息、图片、协议变体和持久化边界优先在 Runtime、
Coordinator、Controller、Projection 或 Repository seam 中使用 Vitest 验证。新增 E2E 必须证明
目标风险无法由更低层的确定性测试覆盖。

Smoke 标题使用 `@smoke`。本地直接运行已有构建：

```bash
npm run test:e2e:smoke:run
npm run test:e2e:run
```

Windows 默认隐藏测试窗口；Linux CI 使用 Xvfb。本地 Linux 调试可设置
`PICTOR_E2E_NO_FOCUS=0` 恢复普通聚焦。测试必须等待明确 UI/协议终态，不使用固定延时证明业务
完成。

## CI 门禁

普通 Pull Request 和 `develop` push 使用四项稳定检查：

| 检查                   | 内容                                         |
| ---------------------- | -------------------------------------------- |
| `Quality`              | Workflow、分支/发布元数据、格式、类型与 Lint |
| `Unit and integration` | 全部 Vitest                                  |
| `Windows acceptance`   | 构建应用并运行 Windows Shell smoke           |
| `Linux acceptance`     | 构建应用并运行单一 Delegate smoke            |

基础 CI 不根据手写源码路径改变 required checks。触及依赖、Plugin SDK、Plugin、Frontend、构建、
打包或 Workflow 的 PR 另外触发非 required 的 `Package CI`，通过共享
`package-desktop.yml` 构建和验收 Windows NSIS、Arch Pacman 与 AppImage。

Nightly 与 Release 复用同一桌面打包 Workflow，并在 Linux job 运行完整保留 E2E。它们不复制
普通源码 CI 已完成的静态检查和 Vitest，只有所有平台产物通过后才由单一 publish job 发布附件。

## 发布包验收

所有正式打包必须先运行：

```bash
npm run build:distribution
```

它清理旧产物并构建同一源码快照的 GUI、CLI、TUI 与 Bundled Plugin。平台命令为：

```bash
npm run package:windows:build
npm run package:linux:build
npm run package:verify
```

`package:verify` 消费已有包，不重建。它验证真实 launcher、GUI page target、CLI/TUI、Profile
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
- Vitest 最多使用 4 个 worker；Electron E2E 在 CI 中使用单 worker。
- 关闭与恢复场景必须设置明确上限，并在失败时清理完整进程树。
- Playwright 失败证据写入 `test-results/`，CI 仅在失败时上传并保留 7 天。
- 行为变化必须更新最接近其稳定 seam 的测试；纯重构不得无理由删除断言。
- API Key、完整用户数据和真实项目内容不得进入日志、fixture 或 CI artifact。
