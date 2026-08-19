# 当前代码架构

本文描述 Pictor 当前已经实现的代码结构和依赖规则。Main 和 Renderer 已经由可安装 Plugin Host
装配，Updater 是首个真实 Bundled Plugin；尚未迁移的业务能力仍位于 Core 启动链路中，后续按
纵向切片迁移，不能把这些兼容代码当作最终结构。

## 源码域

应用源码统一位于 `src/`：

```text
src/
├── kernel/     纯 TypeScript Module 生命周期、Token、Contribution 和 Contract Router
├── plugin/     Manifest、Registry、Plugin 依赖规划和进程级 Plugin Host
├── modules/    按 Feature 聚合的新代码及 Main/Renderer/Runtime 入口
├── main/       Electron Main、Plugin Store、既有 IPC、持久化和 Runtime 监管
├── preload/    Desktop bridge 的 Electron adapter
├── renderer/   React 界面
├── runtime/    独立 Agent Runtime Host、Pi adapter 和项目工具
└── shared/     跨进程可序列化模型与协议
```

`main`、`preload`、`renderer` 和 `runtime` 分别对应不同的运行环境。`modules/<feature>/` 可以
并列保存该 Feature 的共享 contract 和可选进程入口，以提高修改 locality；跨进程调用仍必须
经过共享 contract，不能直接导入另一个进程的实现。

`kernel` 不依赖 Electron、React、Pi 或业务模型。它只按 Token 依赖排序并激活一个 Plugin 在
当前进程中的 Module，保存 Provider，收集 Contribution，并在关闭时逆序释放 Disposable。

`plugin` 定义安装和组合 seam：Manifest 声明 Pictor engine、SemVer 依赖、进程 Module 入口和
Pi 资源；Registry 保存用户期望状态；依赖规划计算拓扑顺序与阻塞原因；每个 Plugin 在每个进程
拥有独立 Module Kernel。Main 的 `plugins/PluginStore` 管理用户目录中的安装副本、Registry、
Bundled 恢复源和独立数据目录。第一版按重启应用生效，不实现热卸载、复杂依赖求解、签名链或
细粒度权限矩阵。

`e2e/` 保存 Electron 用户场景，`scripts/` 保存构建和发布验证，`tests/` 只保存 Vitest 全局
测试基础设施。这些工程文件不属于应用源码，不迁入 `src/`。

## 共享协议

- `domain.ts`：Project、Session、Run、Message 和 Tool 等持久化模型。
- `model.ts`：模型端点设置、连接测试和模型发现语义。
- `desktop-bridge.ts`：Renderer 与 Main 之间的请求、结果和 `PictorBridge` interface。
- `runtime-protocol.ts`：Main 与 Runtime Host 之间的 command、host message 和 Runtime event。
- `path-identity.ts`：Windows 与 Linux 的项目路径身份语义，不读取文件系统。
- `errors.ts`：可跨进程表达的错误代码和 `PictorError`。
- `ipc-result.ts`：把失败转换为可序列化 IPC result，不依赖 Electron。
- `secret-redaction.ts`：Session、Runtime event 和 Pi transcript 的凭据脱敏。
- `modules/updater/shared.ts`：应用信息、更新语义和 Updater Module contract。

不要重新增加一个导出所有共享内容的总入口。调用者应直接依赖自己使用的协议 module，使
interface 保持可见且范围明确。

## 依赖方向

```text
Renderer -> Desktop bridge / Module contract -> Preload adapter -> IPC -> Main
Main -> Runtime protocol -> Runtime Plugin Host -> Pi Agent Runtime Plugin
Main / Preload / Renderer / Runtime -> Shared
Main / Renderer / Runtime -> Plugin Host -> per-plugin Kernel
Kernel -X-> Electron / React / Pi / 业务实现
Shared -X-> 任何进程实现
Runtime -X-> Main / Preload / Renderer
Renderer -X-> Electron / Node / 其他进程实现
```

ESLint 对进程方向执行静态检查。`tsconfig.node.json` 覆盖 Main、Preload、Runtime、Kernel、
Node Module 入口、Shared 和 E2E；`tsconfig.web.json` 覆盖 Renderer、Kernel、Renderer Module
入口、Shared 和 Web 测试基础设施。

Main 与 Renderer 分别从用户 Plugin Store 动态加载当前进程的 Plugin 入口。跨进程 Feature 通过固定的
`module:invoke` / `module:event` Electron transport 通信，输入和结果只在进程 seam 校验；同一
进程内的 Module 调用依赖 TypeScript。Updater 的独立 ESM 包在构建时进入 Bundled 恢复源，首次
启动复制到用户 Store 后运行；其 Main 入口贡献 contract handler，Renderer 入口提供
`UpdaterClient` 并向 `settings.sections` 贡献“关于”页面。

Plugin 是安装、版本和依赖组合单元；Module 只属于一个 Plugin 的单个进程入口；Contribution 是
Plugin 通过 SDK 公开的可组合值。Plugin Host 管理 Plugin DAG，Module Kernel 只管理一个 Plugin
的内部 DAG，两者不能合并成同一层依赖图。独立 Renderer bundle 复用 Core 提供的 React/JSX
runtime，不携带第二套 React 实例。

`RuntimeCoordinator` 拥有自身需要的窄 persistence 和 Runtime host interface。现有
`AppRepository` 与 `RuntimeSupervisor` 直接满足它们；测试使用 in-memory adapter，不依赖具体
实现类型。不要为整个持久化模块添加只有一个 production adapter 的抽象。

`RuntimeSupervisor` 只启动 utility process 并传入已安装 Plugin 的 Runtime catalog。utility
process 自己运行 Plugin Host，从用户 Store 动态导入 Runtime 入口，并通过 `agent.runtimes`
Contribution 选择 Provider。`pictor.pi-agent-runtime` 使用 Pi `AgentSessionRuntime` 管理当前
`AgentSession` 及其可替换生命周期；Main 不静态 import Pi adapter。Pi 所需 WASM 与 Runtime
bundle 一同进入 Store，Node 内置模块保持外部导入，npm 实现依赖内联到 bundle。

`pictor.pi-extension-host` 依赖 `pictor.pi-agent-runtime`，但不包装 Pi Extension。Plugin Store
把原生 Extension 与 Pi Package 作为独立 Registry entry 保存，Runtime 入口只贡献原生资源路径；
Pi `DefaultResourceLoader`、Jiti virtual modules 和 ExtensionRunner 负责加载原文件、注册 Tool、
Command 与事件。未知 Tool 映射为通用 `custom` Tool event。`ExtensionUiBroker` 以 RPC mode 把
select/confirm/input/editor 映射到 Renderer modal，把 notify/status/文本 widget 映射到会话 UI；
raw terminal input、TUI Component、theme、header/footer/editor 等能力明确返回 unavailable。

Core Renderer 只渲染不可卸载的 `CoreShell` 和 Plugin Manager。`pictor.agent-workspace` 通过
`shell.applications` Contribution 提供 Project、Session 与 Conversation GUI；移除或阻塞该
Plugin 时，CoreShell 显示空 Plugin Manager，而不是让 Renderer bootstrap 因缺少业务 Provider
失败。设置页 Contribution 只在 Agent Workspace 存在时组合到该应用中。

`AppRepository` 是 Main 进程的工作区状态入口，只协调 Project、Settings、导航选择和持久化
初始化。Session 文件路径、schema 读写、凭据脱敏、损坏隔离、异常退出恢复及 Pi resume 安全
集中在内部 `SessionPersistence` module；它直接使用本地文件系统和现有凭据迁移函数，不增加
通用 Repository、DAO 或存储 provider。相关测试通过真实临时目录验证该 module 的可观察行为。

`command-interpreter.ts` 在 Main 进程识别当前平台可用的 Bash，并把解析后的绝对路径作为
Runtime 启动配置传入 utility process。Runtime 不重新猜测用户环境；`BashCommandExecutor`
只负责固定参数执行、输出和进程生命周期。Windows 使用 Git for Windows 的 Bash 并终止进程
树；Linux 将每条命令放入独立 POSIX 进程组，在停止或超时时终止整个组。这个窄配置边界保留
了以后更换 Command Interpreter 的变化点，而不把通用 Shell 抽象扩散到工具协议。

`linux-distribution.ts` 只在 Main 进程读取本机 `/etc/os-release`，把原生 Arch 或不受支持
Linux 映射为共享平台信息。Updater 在 Arch 选择原生 Pacman 资产，在其他 Linux 选择便携
AppImage；原始 os-release 内容不进入 IPC、持久化或日志。

Runtime 的 `ProjectPathGuard` 按宿主文件系统的大小写语义做真实路径边界检查。共享的项目路径
身份仅用于持久化去重：Windows 忽略大小写，Linux 保留大小写。符号链接解析和越界拒绝仍只
位于 Runtime 文件系统边界，不能用字符串路径身份函数替代。

Renderer 的 `App` 只负责页面布局、Settings 和界面级 modal 编排，并从 Renderer Kernel 接收
Updater Interface 与设置页 Contribution。内部
`useWorkspaceController` 通过注入的 `PictorBridge` 管理 workspace snapshot、当前 Session、导航
竞态、Runtime event reconcile 与 Run/Project/Session intent；测试使用窄 bridge fake 直接验证
异步状态和事件顺序。不要在 UI 组件中重新实现刷新顺序，也不要为此引入第二套全局 store。

## 新代码放置

- Module 生命周期、Token、Contribution 和通用 contract 路由：`src/kernel/`。
- Plugin Manifest、Registry schema、依赖规划与隔离 Host：`src/plugin/`。
- Plugin Store、安装副本和 Bundled 恢复：`src/main/plugins/`。
- 新增业务 Feature：`src/modules/<feature>/`，按需要创建 `shared.ts`、`main.ts`、
  `renderer.tsx` 或 `runtime.ts`。
- Electron 生命周期、窗口、安全或 IPC adapter：`src/main/`。
- 本地状态、凭据和数据迁移：`src/main/persistence/`。
- Agent Run 的监管、持久化和广播编排：`src/main/runtime/`。
- Pi SDK、命令审批、项目路径守卫和 Agent 工具：`src/runtime/`。
- 工作区与 Session 视图：`src/renderer/workspace/`。
- 仍未迁移的设置视图：`src/renderer/settings/`。
- 无业务语义且可复用的视图元素：`src/renderer/ui/`。
- 跨进程 schema 或类型：放入对应的 `src/shared/` 协议 module。

使用 `npm run plugin:new -- <name>` 生成 Manifest、Main/Renderer 入口和测试骨架；
`npm run build:plugins` 将 `plugins/` 中的包构建到本地 Bundled 恢复源。`npm run module:new --
<name>` 只用于已有 Plugin 内部尚未迁移的 Module 源码，不会安装或登记 Plugin。

不要创建模糊的 `utils/`、`common/` 或 `services/`。文件较大不是拆分理由；只有出现更小且稳定的
interface、真实变化点或明显 locality 收益时才提取 module。

## 测试位置

单元测试与实现文件同层，使用 `*.test.ts(x)`；跨真实模块或进程协议的测试使用
`*.integration.test.ts`；Electron 用户场景放在 `e2e/`。测试应通过 module interface 验证可见
结果，不导入私有实现或使用不安全类型强转绕过 interface。
