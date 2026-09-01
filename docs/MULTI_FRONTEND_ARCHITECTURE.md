# Pictor 0.4 多 Frontend 架构

本文是 Pictor 0.4 重构的目标契约，也是 `ASTRA-47` 下各阶段的共同输入。它基于
`develop@eaf04f6` 的 0.3.0 代码和验证结果；[`ARCHITECTURE.md`](ARCHITECTURE.md) 在迁移完成前仍是
当前实现的说明。某一阶段只能把自己负责的目标变为“当前”，不得提前实现或假定后续阶段。

## 决策摘要

- `Kernel` 只指现有的 `ModuleKernel`：它管理一个 Plugin 在一个进程内的 Module DAG，不拥有应用、
  命令、窗口或产品 UI。
- `Application Host` 是 Headless 深模块，拥有一个 Profile 的应用生命周期、状态、Plugin 装配和
  Runtime 编排；它不导入 Electron、React 或 TUI。
- `Command Engine` 是 Frontend 执行 Pictor 应用能力的唯一 Interface；GUI、TUI、CLI 不直接调用
  Repository、Plugin Manager 或 Runtime 实现。
- GUI、TUI、CLI 都是 Frontend。GUI Host 只内置 Workbench slot 与 Pictor Shell；所有产品级 GUI
  均由 Plugin 拥有。
- Pictor Shell 是图形化、轻量级的 Pictor Command 界面，不是 Recovery Console、终端模拟器或
  Agent 工具入口。
- 0.4 不增加常驻 daemon。除 `--help`、`--version` 等不打开 Profile 的纯查询外，一个 Profile
  同时只允许一个 Frontend 持有写锁。
- 0.4 保持 `data-v1`、Pi JSONL、凭据、Plugin Registry、支持平台及 Stable/Nightly 发布语义。

这些决定由 [ADR-0006](adr/0006-headless-application-host-and-multi-frontend.md) 记录。

## 目标结构

```text
GUI launcher ── Desktop Adapter ──┐
CLI launcher ── Node Adapter ─────┼── Application Host ── Command Engine
TUI launcher ── Terminal Adapter ─┘          │                  │
                                            ├── Plugin Store / Plugin Host
                                            ├── Agent Workspace
                                            ├── Runtime Coordinator
                                            └── data-v1 / Profile lock

GUI Renderer ── GUI Host ── Workbench slot ── pictor.workbench.delegate
                  └──────── Pictor Shell ──── recovery-safe Pictor Commands

TUI process ─── TUI Host ──────────────────── pictor.tui.delegate
Runtime utility process ───────────────────── Runtime Plugin Host / Pi
```

依赖只沿箭头指向。Frontend Adapter 可以依赖 Application Host Interface；Application Host 不能反向
依赖任何 Frontend。GUI/TUI Plugin 只能通过公开 Contribution 和 Command Client 组合，不能导入 Host
私有实现。

## 深模块与 Interface

| Module           | 对外 Interface                                                               | 拥有的复杂性                                                            | 明确不拥有                                       |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Application Host | `start`、`stop`，以及启动后返回的 Command Client、Plugin Catalog 和 App Info | Profile 锁、Repository、Plugin 生命周期、Runtime 生命周期、启动失败清理 | Electron 窗口、React、终端渲染、命令行解析       |
| Command Engine   | `list`、`execute`、`cancel`、`subscribe`                                     | 命令注册、输入校验、执行上下文、取消、进度、结构化结果和错误            | IPC、CLI 格式化、GUI 组件、TUI 组件              |
| Plugin System    | 现有安装、Registry、依赖计划、进程级激活 Interface                           | Store、Bundled 恢复、SemVer、故障隔离、每 Plugin 的 Module Kernel       | 产品 UI 选择、命令语法、Agent 会话语义           |
| Agent Workspace  | Project、Session、Settings、Runtime intent 与 event                          | `data-v1` 协调、Session 事务、Pi identity 与投影                        | 文件选择器、GUI modal、CLI/TUI 展示              |
| GUI Host         | Workbench Contribution、Shell 状态和 Host 级 overlay                         | Renderer Plugin 装载、Workbench 选择、无插件和失败恢复                  | Delegate 工作台、图形 Plugin Manager、设置业务页 |
| TUI Host         | TUI Application Contribution                                                 | terminal 生命周期、退出与终态恢复                                       | 第二套 Agent Runtime、Pi 子进程、GUI Bridge      |

Interface 是调用者和测试共同跨越的 seam。Application Host 只从装配根接收 `RuntimeHost`、
`EventPublisher`、`UserData`、`AppInfo` 和 `FrontendLock`；这些端口同时有生产 Adapter 和测试
Adapter，属于真实 seam。除此之外不为单一文件系统实现机械增加 Repository/DAO 层。

Agent Workspace 的 import/export、项目注册和图片读取使用显式路径；取消由 Desktop Adapter 以
`null` 返回。GUI picker 不进入 Workspace core，而通过模块拥有的 `AgentWorkspaceFilePicker` 窄
port 连接，CLI/TUI 可以直接调用同一组路径接口。

## 进程与 Adapter

| Frontend      | Composition root         | Application Host                                                                 | Command transport                                 | UI Plugin 入口                                   |
| ------------- | ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| GUI           | Electron Main + Renderer | Electron Main 内运行；DesktopHost Adapter 提供窗口、dialog、App Info 和 userData | Preload 暴露窄 Command Client，IPC 只作 transport | `modules.gui` 在沙箱 Renderer 中运行             |
| CLI           | `src/cli`                | 与 CLI 同进程运行                                                                | in-process Client                                 | 无；CLI 对结构化结果做通用 text/JSON 格式化      |
| TUI           | `src/tui`                | 与 TUI Host 同进程运行                                                           | in-process Client                                 | `modules.tui`，首个实现复用 Pi `InteractiveMode` |
| Agent Runtime | Electron utility process | 不运行                                                                           | 现有 Runtime protocol                             | `modules.runtime`                                |

Electron Main 仍是 GUI 的 Composition root，但不再等同于 Application Host。`src/main/index.ts` 最终只
负责 Electron 协议、窗口、安全策略、原生选择器和 Desktop Adapter 装配。CLI/TUI 的正式打包入口由
Stage 10 决定；在安全评估完成前，不预设必须开启 `ELECTRON_RUN_AS_NODE`。

## Command Engine 契约

Command Engine 对 Frontend 暴露四个操作：

1. `list(filter?)` 返回调用者可见命令的稳定标识、说明、输入 schema 和执行属性。
2. `execute(commandId, input, context)` 返回 execution identity，所有输入先在 Engine seam 校验。
3. `cancel(executionId)` 请求取消可取消执行；终态仍由执行事件确认。
4. `subscribe(executionId?, listener)` 观察 started、progress、output、completed、failed、cancelled。

命令结果必须可序列化，并能被 GUI、TUI 和 CLI 在不理解内部实现的情况下呈现。CLI 退出码从稳定错误
分类映射，GUI/TUI 只渲染同一分类，不自行解释异常字符串。注册表是 Command Engine 的内部 seam；
Plugin 通过 Host activation context 注册命令，不能取得可变注册表、覆盖 Core 命令或绕过输入校验。
Engine 和 Preload 只保留有界执行事件历史；活动执行不会被终态保留驱逐，终态按进入终态的顺序
从最旧记录开始驱逐。`execute` 返回前到达的事件必须可按 execution identity 重放，取消与晚到完成
竞态仍只能产生一个终态。

首批 Core 命令至少覆盖：

- `app.info`、`app.doctor`；
- `plugin.list`、`plugin.install`、`plugin.enable`、`plugin.disable`、`plugin.remove`、
  `plugin.restore`；
- `ui.list`、`ui.activate`；
- Profile 与安全模式诊断。

Pictor Shell 只列出标记为 recovery-safe 的 Core 命令。它不复用 CLI parser 或 TUI renderer，也不
暴露 `bash`、PowerShell、PTY、Pi Tool 或任意进程执行；CLI/TUI/Pictor Shell 的复用点是 Command
Engine，而不是彼此的实现。

Stage 4 的当前迁移切片建立 `src/commands` Headless Engine，并由 Application Host 在其生命周期内
拥有和释放它。该切片已接通 `app.info`、`app.doctor` 与 Plugin Manager 的 Core commands，以及
Electron GUI 的 Command transport；它不实现 CLI/TUI、GUI Host、Pictor Shell、Workbench 拆分或
Manifest 0.4。Command Engine 的 registry、handler 和权限判定保持内部，Frontend 只接收稳定的
`CommandClient` 与不可变、可序列化的 contract 值。

## Frontend 契约

### GUI Host 与 Pictor Shell

GUI Host 对 Workbench Contribution 使用确定性选择：

- 零个可用 Workbench：显示 Pictor Shell；
- 恰好一个：显示该 Workbench；
- 多个：不任意选择，显示带冲突诊断的 Pictor Shell；
- 唯一 Workbench 加载失败：隔离失败 Plugin，显示 Pictor Shell；
- 安全模式：忽略所有 Plugin，直接显示 Pictor Shell。

Pictor Shell 必须能只靠 Core 命令完成 GUI Plugin 的列出、安装、启用、禁用、恢复与诊断闭环。
图形 Plugin Manager 是 `pictor.gui.plugin-manager`，不是 GUI Host 的不可删除部分。

### Delegate Workbench

`pictor.agent-workspace` 在迁移后只提供 Headless Project、Session、Settings 与 Runtime contract。
`pictor.workbench.delegate` 依赖它并拥有 AgentWorkspace、Conversation、Sidebar、Settings、Session
Tree、Composer、Extension UI 和相关样式。禁用或删除 Workbench 不删除 Workspace 数据；GUI 回到
Pictor Shell，CLI 仍能调用 Headless 能力。默认 Profile 推荐该 Workbench，但不得覆盖用户的显式
移除选择。

### TUI

`pictor.tui.delegate` 通过 TUI Host 复用当前依赖
`@earendil-works/pi-coding-agent@0.84.1` 公开导出的 `InteractiveMode`、
`AgentSessionRuntime` 和交互组件。它注入 Pictor 的 Provider、资源、Extension、命令与 Session
identity；不得启动 `pi` 子进程、复制 Agent Runtime 或建立第二份会话历史。

### CLI

CLI 是通用 Command Frontend。首期提供 `help`、`doctor`、`plugin`、`ui` 命令族、text/JSON 输出和
稳定退出码；产品 Plugin 通过 Host 命令扩展 CLI 能力，不增加 `modules.cli`，直到出现确实需要
自定义 CLI 渲染且无法由结构化结果表达的第二个实现。

## Plugin Manifest 0.4

0.4 的进程入口统一表达运行位置，而不是 Electron 名称：

```json
{
  "engines": { "pictor": "^0.4.0" },
  "modules": {
    "host": "./dist/host.js",
    "gui": "./dist/gui.js",
    "tui": "./dist/tui.js",
    "runtime": "./dist/runtime.js"
  }
}
```

- `host` 替代 `main`，运行在 Headless Application Host 所在进程；不得导入 Electron。
- `gui` 替代 `renderer`，运行在 GUI Renderer。
- `tui` 运行在 TUI Host；不得假设 DOM 或 Electron。
- `runtime` 语义不变，运行在 Agent Runtime utility process。
- Plugin 可以省略任意不需要的入口，纯 Pi resource Plugin 仍不需要空 Module。
- 每个 Plugin 的每个活跃进程入口仍拥有独立 Module Kernel；Plugin DAG 与 Module DAG 不合并。

所有 Bundled Plugin 在一次合并中切换 Manifest、Loader、SDK 和恢复源。0.3 Plugin 的
`engines.pictor: ^0.3.0` 本来就不接受 0.4.0：其包、Registry 状态和数据目录继续保留，但状态为
blocked，并给出升级到 Manifest 0.4 的原因。Pictor 不把 `main` 猜成 `host`，也不把 `renderer`
猜成 `gui`。

## Profile 生命周期与并发

打开 Profile 数据前，Application Host 获取由 Frontend Adapter 提供的排他锁；失败时返回持锁
Frontend 与 Profile identity 的结构化冲突，不继续初始化 Repository、Plugin 或 Runtime。GUI/TUI
持有锁直到退出，访问 Profile 的 CLI 命令只在命令进程生命周期内持有。`--help`、`--version` 等
纯查询不打开 Profile，因此不竞争锁。

0.4 不支持 GUI、TUI 或多个 CLI 同时写同一 Profile，也不引入只读附着模式。需要并发多客户端时，
应另行设计 daemon、认证、事件重放、崩溃恢复和协议版本；不能把文件锁扩张成半套服务器。

## 兼容性边界

| 契约            | 0.3 基线                                   | 0.4 要求                                                |
| --------------- | ------------------------------------------ | ------------------------------------------------------- |
| 普通状态        | `userData/data-v1/state.json`，schema v1   | 原路径和 schema 可读；没有实际字段需求时不迁移          |
| Session         | `data-v1/sessions/*.json`，schema v2       | 保持可读写；Frontend 不拥有格式                         |
| Agent 历史      | Pi JSONL 唯一 authority                    | 不改写、不复制；GUI/TUI/CLI 共享 identity 与 Projection |
| 凭据            | 独立 `auth.json`，不进入 Renderer/历史     | 路径、脱敏与权限语义保持                                |
| Plugin Registry | `userData/plugin-registry.json`，schema v1 | 保持条目与数据；0.3 Plugin 明确 blocked，不自动改写     |
| Plugin Manifest | `main`/`renderer`/`runtime`                | 0.4 原子切换为 `host`/`gui`/`tui`/`runtime`             |
| 默认 GUI 启动   | `pictor` 打开 Electron                     | 保持；没有 Workbench 时进入 Pictor Shell                |
| 发布平台        | Windows 11 x64、Arch x64、便携 Linux x64   | 不扩大支持承诺；三种 Frontend 随同一安装包交付          |
| 更新            | Stable 与滚动 Nightly                      | 通道、源码 SHA 和原子发布语义保持                       |

0.4 的明确破坏性变化只限 Plugin Manifest/SDK 的运行位置命名和产品 GUI Contribution。任何需要
改变 `data-v1`、Pi JSONL、凭据、命令结果格式或已发布启动行为的实现，都必须停止当前阶段，提供
真实消费者证据和迁移方案后重新确认。

## 验证基线与门禁

### 0.3 起点

2026-09-01 在 `develop@eaf04f6` 的本地基线：

- 本机 Node `26.8.1`、npm `12.0.2`；CI 仍以 `.nvmrc` 和 npm `11.17.0` 为权威工具链。
- `npm run verify:pr` 通过，耗时 91.09 秒。
- Vitest：44 个 Test File、238 个 Test 全部通过，耗时 59.00 秒。
- Electron build 成功；Main 入口为 `src/main/index.ts`，另有 Runtime Host utility 入口。
- Electron `@smoke`：1 个 Delegate GUI/utility-process 场景通过，耗时 4.6 秒。
- Bundled Plugin 共 7 个；Manifest 只有 `main`、`renderer`、`runtime` 三种 Module 入口。
- CI required checks 为 Quality、Unit and integration、Windows acceptance、Linux acceptance。

本机 npm 版本差异只记录为环境事实，不改变仓库固定工具链。Agent 在报告回归前必须用仓库声明或
CI 环境复验。

### 各阶段最低门禁

| Stage | Multica Issue | 独立分支                                   | 合并前新增证据                                             |
| ----- | ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| 1     | `ASTRA-48`    | `refactor/frontend-architecture-contracts` | 文档格式、契约交叉引用、0.3 `verify:pr` 基线               |
| 2     | `ASTRA-49`    | `refactor/application-host`                | Headless Host 生命周期测试、现有 GUI E2E                   |
| 3     | `ASTRA-50`    | `refactor/headless-workspace-contract`     | 纯 Node Workspace 测试、GUI 文件选择 E2E                   |
| 4     | `ASTRA-51`    | `refactor/command-engine`                  | Engine Interface、取消/事件/错误测试、一个 GUI 生产调用    |
| 5     | `ASTRA-52`    | `refactor/cli-frontend`                    | CLI text/JSON/退出码/Profile 锁测试                        |
| 6     | `ASTRA-53`    | `refactor/gui-host-pictor-shell`           | 无 Plugin、冲突、失败、安全模式和恢复 E2E                  |
| 7     | `ASTRA-54`    | `refactor/delegate-workbench-plugin`       | Manifest 原子切换、Workbench 移除、原有 Delegate E2E       |
| 8     | `ASTRA-55`    | `refactor/gui-contribution-ownership`      | GUI Plugin 可移除、样式隔离、Shell 恢复                    |
| 9     | `ASTRA-56`    | `refactor/tui-host`                        | fake terminal 确定性测试、JSONL 跨 Frontend 一致性         |
| 10    | `ASTRA-57`    | `refactor/multi-frontend-packaging`        | NSIS/Pacman/AppImage 三入口 smoke、生命周期与 Release 门禁 |

每个 Stage 从最新 `develop` 创建分支，完成 `npm run verify:pr` 与该阶段新增证据，PR CI 全绿并合并
后，下一 Stage 才能开始。Stage 10 另执行 `npm run verify:release` 和三个目标包格式的验证。

## 外部依据

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)：Main、Renderer
  与 Utility Process 的职责和隔离。
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)：`runAsNode` 的打包期安全
  取舍，必须在 Stage 10 实证后决定。
- [Visual Studio Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)：
  可安装能力按 UI、Workspace 和运行位置选择 Host 的成熟模式。
- [Eclipse Theia Architecture](https://theia-ide.org/docs/architecture/)：同一产品以 Headless Backend
  支持 Electron 与其他 Frontend，并保持 browser/node 依赖方向。
- Pictor 锁定的 `@earendil-works/pi-coding-agent@0.84.1` 公开导出 `InteractiveMode` 与
  `AgentSessionRuntime`，Stage 9 直接以已安装类型和测试为准。
