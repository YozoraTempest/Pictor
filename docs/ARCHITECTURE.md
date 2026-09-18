# 架构约束

本文只保留贡献者修改代码时必须遵守的当前结构和依赖规则。产品方向、完整领域模型、架构决策
依据、替代方案和迁移历史由维护者的 Trilium「开源项目知识库 / Pictor」维护。

## 核心原则

- `ApplicationHost` 是 Web GUI、Desktop GUI、TUI 和 CLI 共用的无界面应用核心，拥有一个 Profile 的状态、Plugin
  组合、Runtime 协调和 Command Engine。
- Frontend 只负责交互与适配，不复制应用能力。浏览器 GUI 是默认开发入口，通过本机 Node Web
  Host 连接 `ApplicationHost`；Electron、CLI 和 TUI 保留各自的 Composition root。
- Plugin 是安装、版本、启停和移除单元；Module 是一个 Plugin 在单个进程中的执行单元；
  Contribution 是 Plugin 通过公开 Interface 提供的可组合值。
- Core GUI 只保留 GUI Host、Workbench slot、Pictor Shell、诊断和恢复入口。产品 GUI 属于可移除
  Plugin。
- Pi JSONL 是 Agent 会话历史的唯一权威。Pictor 只保存导航元数据、Pi Session identity、active
  leaf 和可重建的 Session Projection。
- 跨进程或跨 Plugin 调用必须通过明确、可序列化的 contract；不得直接导入另一边的实现。

## 源码地图

应用源码统一位于 `src/`：

```text
src/
├── application/ 无 Frontend 依赖的 Application Host、共享 Node Application、生命周期端口和装配
├── commands/    Command Engine、Command Client 和 Core commands
├── cli/         非交互 Node CLI Frontend
├── tui/         Node TUI Host、Terminal 和公开 Contribution
├── gui/         GUI Host、Workbench slot、Pictor Shell 和 GUI contract
├── kernel/      单个 Plugin 内的 Module 生命周期、Token 和 Contribution
├── plugin/      Manifest、Registry、依赖规划和进程级 Plugin Host
├── modules/     按 Feature 聚合的 Headless contract、Host 和 domain 能力
├── node/        Frontend 共用的 Node 持久化、Plugin Store 和平台适配
├── web-host/    本机 HTTP/WS Host、认证、文件传输和 GUI Composition root
├── web-client/  共享 GUI bridge、HTTP/WS transport 和 Web 文件选择适配
├── main/        DesktopHost、窗口/平台 capability、安全设置和 Electron Composition root
├── preload/     只暴露 PlatformFilePicker 的 Electron adapter
├── renderer/    Web 与 Desktop 共用且统一使用 Web transport 的 React Renderer
├── runtime/     独立 Node Agent Runtime Host、监管和 Pi adapter
└── shared/      跨进程可序列化模型与协议
```

仓库级区域：

```text
packages/plugin-sdk/  Plugin 作者使用的私有 workspace Interface
plugins/              Bundled Plugin 源码
scripts/              构建、脚手架、打包和发布验证
tests/                Vitest 全局测试基础设施
```

## 关键边界

### Application Host 与 Frontend

`ApplicationHost` 不导入 Electron、React、Renderer、Preload 或 TUI 实现。它在获得
`FrontendLock` 后初始化 Repository 与 Plugin Store，装配 Runtime、Host Plugin、Module Router
和 Command Engine；失败时释放已获得的资源，关闭时按相反顺序清理。

`createNodeApplication` 统一装配 Web 与 Desktop 使用的 RuntimeSupervisor、ApplicationHost、Host
Plugin 和事件发布。`Web Host` 是两个 GUI 的唯一业务 adapter，负责静态资源、HTTP command/module
调用、WS 事件、认证和 Web 文件工作流。`DesktopHost` 在 Electron Main 内启动同一 Web Host 并加载
其本机 URL，只负责窗口、单实例锁、原生文件 capability、外链、Updater 与安全设置。Preload 不提供
CommandClient 或 ModuleTransport。所有 Frontend 使用同一个 Profile 文件锁；CLI/TUI 的冲突
退出码固定为 `4`。当前不运行常驻 daemon，一个 Profile 同时只允许一个 Frontend 持有。

CLI 只处理参数、Command 路由、text/JSON 输出、取消和退出码。TUI Host 只处理 Terminal、信号、
Plugin Composition 与清理；Delegate 交互属于 `pictor.tui.delegate`，不属于 Core TUI。

### Command Engine

Frontend 通过不可变的 `CommandClient` 发现、执行、取消和观察 Pictor Command。Registry、handler、
权限上下文、事件历史和取消实现留在 Engine 内部。Browser 与 Electron Renderer 都使用 HTTP 承载
一元调用、WS 承载事件和历史重放。Electron 的窄 IPC 只承载 `PlatformFilePicker`。Renderer 不直接
访问 Repository、Plugin Manager、Node Host 或 Electron Main 实现。

### Plugin、Module 与 SDK

Plugin Host 管理 Plugin 依赖图和隔离；每个 Plugin 在每个进程拥有独立 Module Kernel。Kernel 只
负责依赖排序、Provider、Contribution 和逆序释放，不承担安装、权限、沙箱或版本求解。两层依赖图
不得合并。

Bundled Plugin 的恢复源随应用发布，但安装副本与第三方 Plugin 遵循同一启停、移除和数据保留
生命周期。`packages/plugin-sdk` 只暴露 Module、contract、entrypoint、Manifest 和少量稳定
Contribution Point，不得导入 `src/`、Electron、React、Pi 或产品实现。SDK 当前不是公开 npm
兼容承诺。

Host 与 GUI 从用户 Plugin Store 动态加载各自入口。独立 GUI bundle 复用 Core 提供的 React/JSX
runtime，不携带第二套 React。Plugin GUI 样式必须按 Plugin identity 安装，并在释放时移除。

### Agent Workspace 与 Pi Runtime

`pictor.agent-workspace` 提供 Project、Session、Settings 和 Runtime intent/event contract；
Delegate GUI/TUI 只消费公开 Client。Model Provider 通过 `model.providers` Contribution 注册，Pi
Runtime 不硬编码供应商。

Web/Desktop 的 Pi Runtime 在独立 Node 子进程中运行；TUI 使用 in-process Runtime Host。原生 Pi Extension、
Package、Skill、Prompt 和 Tool 交给 Pi ResourceLoader 与 ExtensionRunner 解析，Pictor 不维护第二套
格式或工具包装。

Session Tree、导航、Compaction、Fork、Clone、Import 和 Export 都必须以已绑定的 Pi JSONL 为源。
Renderer 不重建 parent graph，也不把流式事件保存成第二份历史。所有持久化、投影重建、active
leaf 和 replacement transaction 都通过 Runtime/Repository 的公开 seam 完成。

### Distribution 与安全边界

`npm run build:distribution` 是发布包的唯一完整构建入口：清理旧产物后构建共享 Web GUI、Electron
Main/Preload、CLI、TUI 和全部 Bundled Plugin，再写入同一源码快照的 build identity。Electron 不
再生成第二份 Renderer。`package:*`、Nightly 和
Release 只能消费该完整产物。

公开入口固定为 `pictor`、`pictor cli ...` 和 `pictor tui ...`。打包后的 CLI/TUI 使用包内 Electron
Node adapter，不依赖系统 Node。Electron `runAsNode` fuse 因此保持启用；launcher 限制正常入口，
但不是安全沙箱。Renderer 必须保持 sandbox、context isolation、限制性 CSP，且不能访问 Node 或
原始 Electron API。

Pictor 不为 Pi 原生文件与 Shell 工具增加第二套项目路径守卫或命令审批。它们以当前用户权限运行；
需要更强隔离时使用操作系统或容器能力。API Key 不得进入 Renderer、Session、Pi JSONL、日志或
测试证据。

Web Host 只绑定 `127.0.0.1`。首次启动 URL 使用一次性随机 Token 换取 `HttpOnly`、`SameSite=Strict`
Cookie；API 写请求和 WebSocket 必须通过精确的 Host、Origin 与 Fetch Metadata 校验。一个 Host/Profile
只允许一个活跃 GUI lease，同一浏览器 Client 重连可以替换旧连接。Plugin 静态资源和 SPA 文件必须
限制在各自根目录内，上传、导出临时文件使用私有权限、随机名称、一次性下载票据和过期清理。该边界
只支持本机单用户开发，不形成远程访问、多租户或常驻 daemon 承诺。

## 领域语言

- **Application Host**：一个 Profile 的无界面应用能力所有者。不要称为 Core Host 或 GUI Kernel。
- **Frontend**：连接 Application Host 的 GUI、TUI 或 CLI 交互方式。
- **Web Host**：绑定本机回环地址、向浏览器暴露受认证 HTTP/WS transport 的 Node GUI adapter。
- **GUI Host**：只承载 Workbench Plugin 或 Pictor Shell 的最小图形宿主。
- **Pictor Shell**：无 Workbench 可用时提供诊断和恢复命令的内置轻量 GUI。
- **Pictor Command**：通过 Command Engine 向不同 Frontend 一致暴露的应用操作。
- **Plugin**：可独立安装、版本化、启停或移除的产品能力。
- **Bundled Plugin**：恢复源随包发布、安装副本仍遵循普通生命周期的 Plugin。
- **Module**：只属于一个 Plugin 和一个进程的执行单元。
- **Profile**：推荐一组根 Plugin 的产品形态，不覆盖用户明确移除选择。
- **Workbench Plugin**：向 GUI Host 的 Workbench slot 贡献一个产品 GUI 的 Plugin。
- **Native Pi Extension**：保持 Pi 原格式安装和执行的 Extension，不转换成 Pictor Plugin。
- **Pi Session History**：由 Pi JSONL 保存的完整树、Compaction、usage 与 Extension 状态。
- **Session Projection**：从 Pi Session History 重建的桌面展示与导航模型，不是历史来源。
- **Supported Distribution**：发布原生资产并维护明确验收基线的 Linux 发行版。
- **Portable Linux Asset**：不承诺通用发行版兼容性的便携 AppImage。

## 依赖方向

```text
Renderer -> GUI/Module contract -> Web bridge -> HTTP/WS -> Web Host
Renderer -> PlatformFilePicker -> Preload adapter -> narrow IPC -> DesktopHost
Bundled Plugin -> Plugin SDK / 明确的产品 contract
CLI/TUI -> Application Host ports / Command Client
Web Host / DesktopHost -> Node Application -> Application Host -> Runtime / Plugin Host / Repository
Application Host -> Command Engine -> Core 或 Plugin command
Runtime Host -> Runtime protocol -> Runtime Plugin Host
Web Host / Web Client / Main / Preload / Renderer / Runtime -> Shared

Kernel -X-> Electron / React / Pi / 业务实现
Plugin SDK -X-> src / Electron / React / Pi / 产品实现
Shared -X-> 任何进程实现
Runtime -X-> Main / Preload / Renderer
Renderer -X-> Electron / Node / 其他进程实现
Node -X-> Electron / Renderer
```

ESLint 与 TypeScript 项目边界负责静态检查。不要新增导出全部协议的总入口；调用者应直接依赖它
使用的 contract module。

## 新代码放置

- Headless 生命周期、Application Host 与共享 Node Application 装配：`src/application/`。
- Command Engine 与公开 Command contract：`src/commands/`。
- Plugin 安装、Manifest、Registry 和依赖规划：`src/plugin/`；Store 与恢复源：`src/node/plugins/`。
- Node 持久化、Secret Store 和平台探测：`src/node/`；不得放入 Electron `src/main/`。
- 新 Headless Feature：`src/modules/<feature>/`；产品 GUI：对应的 `plugins/<plugin>/`。
- GUI Host 和公开 GUI contract：`src/gui/`；共享 GUI transport：`src/web-host/` 与 `src/web-client/`；
  Electron 窗口与平台 capability adapter：`src/main/` 与 `src/preload/`。
- Runtime protocol 的 Host/adapter：`src/runtime/`；可序列化 schema：对应的 `src/shared/` module。
- Plugin 可移植 Interface：`packages/plugin-sdk/`，不得反向依赖产品实现。
- 单元测试与实现同层；跨真实模块或协议的测试使用 `*.integration.test.ts`。仓库不维护 E2E
  测试，未经维护者针对具体场景明确批准不得新增。

不要按文件大小提取模糊的 `utils/`、`common/` 或 `services/`。只有出现稳定 Interface、真实变化点
或明显 locality 收益时才建立新模块。
