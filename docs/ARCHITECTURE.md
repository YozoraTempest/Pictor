# 当前代码架构

> 本文记录 `develop` 上运行的 0.4 Stage 9 架构。完整目标、兼容性边界和后续阶段门禁见
> [`MULTI_FRONTEND_ARCHITECTURE.md`](MULTI_FRONTEND_ARCHITECTURE.md)。GUI Plugin Manager、Updater、
> Git Changes 和 Delegate Workbench 的产品 GUI 均由各自 Plugin 拥有；Core GUI 只保留 Host、Shell、
> 诊断、公开 contract、bootstrap 与宿主样式。Node TUI Host、TUI Contribution 和 Delegate TUI
> 已在 Stage 9 落地；Stage 10 才处理三种桌面包的多入口打包。

本文描述 Pictor 当前已经实现的代码结构和依赖规则。Application Host 已从 Electron Main 的启动链
路中提取，DesktopHost 是它的 Electron 适配器；GUI Renderer 由 `src/gui` 的 GUI Host 装配，
Workbench 与恢复 Shell 通过公开 contract 组合，产品 GUI 由 Bundled Plugin 提供。尚未迁移的
业务能力仍按纵向切片保留在现有模块中，不能把兼容代码误写成后续 Stage 的最终结构。

## 源码域

应用源码统一位于 `src/`：

```text
src/
├── application/ 无 Frontend 依赖的 Application Host、生命周期端口和服务装配
├── commands/   Headless Command Engine、稳定 Client contract 和 Core commands
├── cli/        无 Electron 的 Node CLI Frontend、参数/输出/退出语义和 Headless adapters
├── tui/        无 Electron 的 Node TUI Composition root、Host、Terminal 和公开 Contribution
├── gui/        GUI Host、Workbench slot、Pictor Shell、公开 GUI contract 和 GUI Plugin 装配
├── kernel/     纯 TypeScript Module 生命周期、Token、Contribution 和 Contract Router
├── plugin/     Manifest、Registry、Plugin 依赖规划和进程级 Plugin Host
├── modules/    按 Feature 聚合的 Headless contract、Host 和 domain 能力
├── main/       DesktopHost、Electron IPC/协议、Plugin Store、持久化和 Runtime 监管
├── preload/    Desktop bridge 的 Electron adapter
├── renderer/   React 界面
├── runtime/    独立 Agent Runtime Host 和 Pi adapter
└── shared/     跨进程可序列化模型与协议
```

`main`、`preload`、`renderer` 和 `runtime` 分别对应不同的运行环境。`modules/<feature>/` 可以
保存 Headless contract、Host 或 domain 能力，但不再保存产品 React/GUI 实现；GUI 产品界面位于
`plugins/<plugin>/`。跨进程调用仍必须经过共享 contract，不能直接导入另一个进程的实现。

`application` 是当前已落地的 Headless Application Host 边界。`ApplicationHost` 不导入 Electron、
React、TUI、Renderer 或 Preload 实现；它在获得 `FrontendLock` 后初始化 `AppRepository` 和
`PluginStore`，装配 `RuntimeCoordinator`、Host `PluginHost`、`PluginManager` 与 `ModuleRouter`，
并通过 `RuntimeHost`、`EventPublisher`、`UserData` 和 `AppInfo` 端口连接 Frontend。Plugin Module
定义由 Composition root 提供，使纯 Node 测试可以使用不依赖 Electron 的定义。

`src/cli` 是 Stage 5 的 Node Frontend。`runCli(args, deps)` 只负责参数解析、Command Client 路由、
text/JSON 输出、SIGINT 取消和退出码；Profile 锁、Host 工厂、IO 与信号均通过依赖注入。Node 装配
使用 `HeadlessRuntimeHost` 和 `EventPublisher`，不加载 Electron，也不激活 GUI/Electron Plugin
入口；Runtime-only 操作返回明确的不可用错误。`ProfileFileLock` 由 CLI 和 DesktopHost 共同使用，
以 user-data/profile 路径为锁身份，并以原子文件创建和 owner token 证明释放权限。崩溃后的锁仅在
owner 元数据有效、本机 hostname 匹配且通过 `process.kill(pid, 0)` 明确证明 owner 已退出时恢复；
外部主机、活动或无法判定的进程、损坏元数据和复核失败的锁都保留。

`src/tui` 是 Stage 9 的独立 Node Composition root。`TuiHost` 是深模块：装配 TUI Plugin Kernel，
拥有 TUI terminal 生命周期、SIGINT/SIGTERM 取消、fatal/无可用 TUI 诊断和最终清理；TUI Plugin
只能实现 `TuiApplicationContribution`，通过 `AgentWorkspaceClient`、`CommandClient` 和窄的
Runtime interactive runner seam 访问应用能力。`pictor.tui.delegate` 拥有 Delegate 的 Project、
Session 和 Pi 交互，Core TUI Host 不包含这些业务分支。TUI 的 Node adapter 使用同一个
`ApplicationHost`、`ProfileFileLock`、Plugin Store/Profile、Workspace、Provider、Pi resources 和
JSONL identity；显式 `--project`/`--session` 才能定位或创建上下文，空数据目录会进入可理解的
首次使用路径。

`commands` 是当前 Stage 4 已落地的 Headless Command Engine 边界。它只向调用者提供不可变的
`CommandClient`（`list`、`execute`、`cancel`、`subscribe`）以及可序列化的 descriptor、event、
result 和 error；registry、handler、调用上下文的权限判定和 `AbortSignal` 均为 Engine 内部实现。
ApplicationHost 在完成 Plugin Host 装配后拥有 Engine，并在停止时释放它；Core commands 复用
现有 `PluginManager`，不复制 Plugin Store 或 Registry 业务逻辑。GUI 的 command transport 只负责
IPC 适配，Renderer 不直接导入 Main、Repository 或 Plugin Manager。执行事件保留有界历史：活动执行
不会被终态保留驱逐，终态按进入终态的顺序从最旧记录开始驱逐；`execute` 返回前到达的事件可按
execution identity 重放，取消和晚到完成只允许一个终态。

`src/main/desktop-host.ts` 是当前 GUI 的 DesktopHost 适配器。它创建 Electron `RuntimeSupervisor`、
safeStorage-backed `SecretStore`、`AppInfo` 和 Frontend lock，注册 App protocol、IPC、窗口与退出
流程，再把这些端口交给 Application Host；`src/main/index.ts` 只负责 Electron scheme、sandbox、
开发环境 userData 设置和 DesktopHost 装配。DesktopHost 的 Frontend lock 先获取 Electron 应用级
single-instance lock，再获取共享 `ProfileFileLock`；释放时按相反顺序执行。

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
- `desktop-bridge.ts`：GUI Host、Plugin picker 和现有 Workbench 使用的 `PictorBridge` interface。
- `app-doctor.ts`：`app.doctor` 的可序列化诊断输出 contract。
- `runtime-protocol.ts`：Main 与 Runtime Host 之间的 command、host message 和 Runtime event。
- `path-identity.ts`：Windows 与 Linux 的项目路径身份语义，不读取文件系统。
- `errors.ts`：可跨进程表达的错误代码和 `PictorError`。
- `ipc-result.ts`：把失败转换为可序列化 IPC result，不依赖 Electron。
- `secret-redaction.ts`：Session、Runtime event 和 Pi transcript 的凭据脱敏。
- `modules/updater/shared.ts`：应用构建身份、更新通道语义和 Updater Module contract。
- `modules/agent-workspace/shared.ts`：Project、Session、Settings、Runtime intent 与 event 的
  Agent Workspace Module contract。

不要重新增加一个导出所有共享内容的总入口。调用者应直接依赖自己使用的协议 module，使
interface 保持可见且范围明确。`src/gui/contract.ts` 是 GUI Plugin 使用的公开 contract；它提供
Workbench slot、带 `owner` 与稳定 `id` 的 Settings Section，以及 Section render context 中的
`CommandClient`、`GuiPluginPicker` 和 GUI Plugin status。旧的 `shell.settings-sections` 不存在，也
不保留兼容别名。

## 依赖方向

```text
Renderer -> Desktop bridge / Module contract / CommandClient -> Preload adapter -> IPC -> DesktopHost
CLI -> Application Host ports -> Command Client
TUI -> Application Host ports / ModuleTransport -> TUI Contribution
DesktopHost -> Application Host ports -> RuntimeCoordinator / PluginHost / Repository
Application Host -> Command Engine -> Core commands / Plugin command contributions
Application Host -> RuntimeHost -> RuntimeSupervisor -> Runtime protocol -> Runtime Plugin Host
Main / Preload / Renderer / Runtime -> Shared
Main / Renderer / Runtime -> Plugin Host -> per-plugin Kernel
Kernel -X-> Electron / React / Pi / 业务实现
Shared -X-> 任何进程实现
Runtime -X-> Main / Preload / Renderer
Renderer -X-> Electron / Node / 其他进程实现
```

ESLint 对进程方向执行静态检查。`tsconfig.node.json` 覆盖 Main、Preload、Runtime、Kernel、
Node Module 入口、TUI、Shared 和 E2E；`tsconfig.tui.json` 负责可执行的 TUI Node 产物；
`tsconfig.web.json` 覆盖 GUI、Kernel、GUI Module 入口、Shared 和 Web 测试基础设施。

Host 与 GUI 分别从用户 Plugin Store 动态加载当前进程的 Plugin 入口。跨进程 Feature 通过固定的
`module:invoke` / `module:event` Electron transport 通信，输入和结果只在进程 seam 校验；同一
进程内的 Module 调用依赖 TypeScript。Updater 的独立 ESM 包在 `plugins/updater` 构建时进入 Bundled 恢复源，首次
启动复制到用户 Store 后运行；其 Host 入口贡献 contract handler，GUI 入口提供
`UpdaterClient` 并向公开 `gui.settings-sections` Contribution 贡献“关于”页面。
Updater Host Module 在自身 Plugin 数据目录记忆稳定版或 Nightly 通道，默认稳定版；GUI 只消费
快照、选择通道、检查和打开四个 intent。稳定版按 SemVer 比较 Latest Release，Nightly 使用固定
Pre-release tag 与打包时嵌入的完整源码提交比较滚动快照；GitHub 地址、平台资产和打开目标的校验都
保持在该 Module 内部。
Agent Workspace 通过 Host Module 注册 `pictor.agent-workspace` contract handlers，Delegate Workbench
GUI Plugin 只消费 `AgentWorkspaceClient`；其 import/export 和项目路径接口只接收显式路径，GUI-only
选择器由 Desktop bridge 提供，并通过模块拥有的窄 `AgentWorkspaceFilePicker` port 注入 GUI；
Preload 不再逐项暴露 Workspace IPC 方法。

Plugin 是安装、版本和依赖组合单元；Module 只属于一个 Plugin 的单个进程入口；Contribution 是
Plugin 通过 SDK 公开的可组合值。Plugin Host 管理 Plugin DAG，Module Kernel 只管理一个 Plugin
的内部 DAG，两者不能合并成同一层依赖图。独立 GUI bundle 复用 Core 提供的 React/JSX
runtime，不携带第二套 React 实例。

`ApplicationHost` 在启动前先获得由 Frontend Adapter 提供的排他锁；随后并行初始化 `AppRepository`
和 `PluginStore`，根据当前 Plugin snapshot 配置 Runtime bootstrap，再启动 Host `PluginHost`。
任何启动步骤失败都会释放已获得的 lock、Runtime Host 和已创建的 Plugin Kernel。关闭时先停止
Runtime，再逆序停止 Plugin Kernel，最后释放 lock；DesktopHost 另外负责注销 IPC handler。

TUI 的 `InProcessRuntimeHost` 在 ApplicationHost 组装完成的 Runtime bootstrap 上加载 Runtime
Plugin Host；它调用 Runtime public contribution，不启动 Electron utility process。`PiAgentRuntime`
通过 `InteractiveRuntimeRunner` 封装已打开的 Pi `AgentSessionRuntime`，生产路径实际执行
`new InteractiveMode(...).run()`。TUI 不保存 transcript 或第二份 history；Pi InteractiveMode 的
session-level entry/leaf event 经 RuntimeCoordinator persistence queue 先保存 active leaf，再从
同一个 JSONL 重建并持久化 Session Projection。`inspectSessionHistory` 仍是同一 authority 的只读
Projection view。

由于 Pi 0.84.1 的 `InteractiveMode` 构造器会覆盖 `AgentSessionRuntime` 的单一 rebind callback，
TUI 传入一个只使用公开 Runtime 方法的 adapter：它保留 Pictor hook，并在底层调用前稳定拒绝
InteractiveMode 的 `/new`、`/fork`、`/clone`、`/resume` 和 `/import`。本阶段的 Session replacement
使用 TUI 启动参数或 Pictor 受支持入口；完整 replacement transaction 路由需要独立的上游
public composition seam。

`RuntimeCoordinator` 拥有自身需要的窄 persistence 和 Runtime host interface。现有
`AppRepository` 与注入的 `RuntimeHost` 直接满足它们；测试使用 in-memory adapter，不依赖具体
实现类型。不要为整个持久化模块添加只有一个 production adapter 的抽象。

DesktopHost 提供的 `RuntimeSupervisor` 只启动 utility process 并传入已安装 Plugin 的 Runtime
catalog。utility process 自己运行 Plugin Host，从用户 Store 动态导入 Runtime 入口，并通过 `agent.runtimes`
Contribution 选择 Provider。`pictor.pi-agent-runtime` 使用 Pi `AgentSessionRuntime` 管理当前
`AgentSession` 及其可替换生命周期；Main 不静态 import Pi adapter。Pi 所需 WASM 与 Runtime
bundle 一同进入 Store，Node 内置模块保持外部导入，npm 实现依赖内联到 bundle。

`pictor.pi-extension-host` 依赖 `pictor.pi-agent-runtime`，但不包装 Pi Extension。Plugin Store
把原生 Extension 与 Pi Package 作为独立 Registry entry 保存，Runtime 入口只贡献原生资源路径；
明确安装的本地 Extension 优先使用 live source path，使修改在下一次资源 reload 或 Session 重建时
生效；source 不可用时回退到 Store 副本。
Pi `DefaultResourceLoader`、`DefaultPackageManager`、Jiti virtual modules 和 ExtensionRunner 负责
解析原文件、Package Manifest、`extensions/`、项目 `.pi` 资源，注册 Tool、Command 与事件。未知
Tool 映射为通用 `custom` Tool event。`ExtensionUiBroker` 以 RPC mode 把 select/confirm/input/editor
映射到 GUI modal，把 notify/status/widget/title/composer 映射到会话 UI；raw terminal input、
TUI Component、theme、header/footer/editor 等能力明确返回 unavailable。跨进程 Module contract ID
使用完整 Plugin ID，避免不同 Plugin 的短名在 Router 中碰撞。

用户明确提交 npm/git/local spec 时，Plugin Store 调用 Pi `DefaultPackageManager` 解析和安装，再把
解析出的原生 package 复制进现有 `pi-packages/<id>` 生命周期目录；不自行实现第二套 spec parser，
也不进行后台安装。受信任 Project 的 `.pi/extensions`、Skills、Prompts 和 Context files 由 Pi
ResourceLoader 自动发现，不再由 Pictor 维护显式项目 Extension 开关或 glob。Local Development Plugin 的 Registry
source 使用 `development`，启动时直接读取 live Manifest/入口；它需要重启应用生效，但无需复制
或重新打包 Pictor。`PICTOR_PLUGIN_PROFILE=developer` 选择独立 Developer Profile identity，Profile
仍只推荐 Bundled roots，不覆盖用户删除选择。

GUI Host 的 `src/gui` 只装配不可卸载的 `GuiHostView` 与 Pictor Shell。`pictor.agent-workspace`
的 Host Module 提供 Workspace contract，`pictor.workbench.delegate` GUI Plugin 通过 `gui.workbenches` Contribution
提供 Project、Session、Conversation 和 Settings 容器，并由 GUI Plugin context 注入真实 `pluginId`；
零个或多个 Workbench、GUI Plugin 加载失败和 Workbench render throw 都回到 Shell，只有
AppInfo、Plugin bootstrap 或 GUI Host 自身 contract 失败才进入 fatal state。独立的
`pictor.gui.plugin-manager` 通过公开 Settings Section、CommandClient、GuiPluginPicker 和 GUI Plugin
status 工作；Delegate 不拥有或导入它。删除或禁用该 Plugin 后，Delegate 与模型设置仍可用，只是
对应 Settings Section 消失；Plugin 恢复仍由 Pictor Shell 的 Core command 完成。

GUI Settings Section 是产品 GUI 的唯一设置页 Contribution。Host 会按 `order`、`id`、`owner`
确定性排序，并在重复 identity 时保留字典序最小的 owner；无效 identity 或 render contract 被
过滤，不会把整个 GUI Host 推入 fatal。Delegate 只拥有 Settings modal、模型页和 Extension UI：
Extension notification 与 modal 由 Delegate 渲染。Pictor Shell 的恢复提示、Host 诊断、fatal state
和 Workbench error fallback 属于 GUI Host。当前没有第二个真实消费者，因此不增加 overlay 或
notification ContributionPoint；这项边界由 GUI contract 与 Workbench/Host 测试固定。
每个 GUI Plugin 在自己的 GUI Module 激活时通过 `installGuiPluginStyles` 安装带稳定 Plugin identity
的样式，在释放时移除；Host 进入 Shell 前会释放已激活的 GUI Plugin，因此冲突、失败和停用路径不会
把产品样式留在 Shell。

`pictor.git-changes` 是第二个跨进程 Bundled Plugin，并声明对 `pictor.agent-workspace` 的硬依赖。
Host 入口通过 Module contract 提供当前项目的 `git status`，GUI 入口贡献 Git 设置页；删除
Workspace 后 Git Changes 保持安装但进入 `blocked`，不做级联删除。

模型注册使用 `model.providers` Contribution。`pictor.model-openai-compatible` 把当前设置和凭据
注册到 Pi `ModelRuntime` 并返回可用 Model；`pictor.pi-agent-runtime` 只消费唯一的 Provider，
没有 Provider 或同时出现多个 Provider 时明确拒绝启动 Run。Workspace 不 import 模型实现。

Manifest 的 `pi.skills` 与 `pi.prompts` 直接展开为 Runtime resource path；
`pictor.agent-resources` 是首个纯资源 Plugin，不需要空 Module。打开的 Pi Session 持有这些资源，
用户请求 reload 时调用 Pi 原生 `reload()`。运行中的 Composer 通过 Runtime protocol 调用 Pi `steer()` 或 `followUp()`，
`queue_update` 与 Session stats 作为事件回到 GUI；Pictor 不自行实现第二套队列。

`AppRepository` 是 Main 进程的工作区状态入口，只协调 Project、Settings、导航选择和持久化
初始化。Pi JSONL 是 Agent conversation history 的唯一 authority；Pictor schema v2 只保存导航
元数据、Pi Session identity、active leaf cursor 和可重建的 Session Projection。Pi 原生同文件导航
只改变内存 leaf，不追加 JSONL entry，因此 cursor 负责让该选择跨 utility process 生命周期保持；
它不复制消息或取代 JSONL authority。Runtime 首次创建 Pi Session 时通过 `session.bound` 绑定
identity，多个 Pictor Run 复用同一个打开的 Pi Session；Run 通过 `session.activeLeafChanged` 更新实际 leaf，终态事件到达后由 Main 从 JSONL
重建投影；流式事件只服务当前交互，不成为第二份历史。旧 schema v1 若无法发现对应 Pi JSONL，
会被脱敏归档为只读 Legacy Session Import，不允许在缺失上下文时启动新 Run。

GUI 的 `app:select-context` 由 Runtime Coordinator 先同步 Pi Session 生命周期，再提交 Pictor
导航选择：选择 Session 会打开目标 JSONL，选择项目或清空 Session 会关闭驻留 Session。reload
和 Session Controls 都携带并校验目标 `sessionId`，不会把空闲操作应用到另一个 Session。

`inspectSessionHistory` 是 Session Tree View 的只读 Interface。它由 `SessionPersistence` 在一次
JSONL 解析中生成完整树、active leaf、selected entry 和对应 Session Projection；Renderer 只消费
结果，不重建 parent graph。选择历史节点不写 schema v2、不调用 Pi `branch()`/`navigateTree()`，
也不改变下次 Runtime resume 的 active leaf；Composer 在 selected entry 不是 active leaf 时保持
只读。普通 Session 加载和 Runtime event 不扫描树，只有用户打开 Tree View 时才执行 inspect。

Pi Session Tree Navigation 是独立的同文件 Runtime operation。Renderer 只提交 Session identity、
目标 entry 和可选 Branch Summary 指令；utility host 精确打开已绑定的 Pi JSONL、恢复当前 active
leaf cursor，并调用 Pi `navigateTree()`，保留 `session_before_tree` 取消和 `session_tree` lifecycle。
普通节点成为实际 leaf；User/Custom Message 返回的 `editorText` 进入 Composer，而 leaf 移到其父
节点；启用 summarize 时，Pi 在目标位置追加 Branch Summary。成功后 Main 持久化 Pi 返回的实际
leaf、重建同一 Session Projection 并退出历史只读状态；不创建或复制 Session。下一次 Run 同样
精确打开绑定文件并恢复 cursor，而不是按 cwd 或目录猜测最近文件。

Pi Session Compaction 是可取消的同文件 Runtime operation。Main 复用 Session operation 互斥并只为
可取消操作保存 operation/session identity；utility host 调用 Pi `compact(customInstructions)` 和
`abortCompaction()`，并把 manual/threshold/overflow 的 `compaction_start`/`compaction_end` 映射为
稳定状态事件。`session_before_compact` 可以取消或提供原生 CompactionResult，`session_compact`
观察已提交 entry。成功后 Main 保存新 active leaf 并从权威 JSONL 重建 Projection/Tree；取消或失败
不制造摘要。Branch Summary 通过同一取消 seam 调用 `abortBranchSummary()`。

Session Runtime Controls 是 schema v2 中的可选导航偏好，只保存 Thinking Level、Active Tools、
Steering/Follow-up delivery mode 和可选 Model ID override；endpoint 与凭据继续由 Model Provider
Settings 管理。每次
精确恢复 Pi Session 时，Runtime 把偏好注入 in-memory SettingsManager 和 AgentSession，Pi 负责
Thinking clamp、Tool registry 过滤和 queue delivery。Model/Thinking 的当前值从 active JSONL branch
的 change entry 或 assistant message 重建并显示，不把偏好误当作运行结果。已打开 Session 的 Model
Controls 通过 Pi `setModel()` 即时切换，失败会沿 Runtime protocol 返回 UI；Pictor title 通过 Pi
`setSessionName()` 同步；“重新加载资源”调用当前打开 Session 的原生 `reload()`，不销毁 utility
process 或另起一套资源解析器。

Pi 自动 Retry 保持启用并把 start/end 映射为脱敏状态事件；Thinking delta 与 Text delta 进入同一
assistant stream，终态仍由 JSONL thinking/text block 重建。Session Tree Label 是独立的原生 Runtime
operation，调用 `SessionManager.appendLabelChange()`，保存 Pi 返回的新 active leaf 后重建 Tree；
Pictor 不直接拼接 label JSONL。

Pi Image Message 的文件路径只存在于 Electron Main 原生选择器；Main 读取支持的图片并把 base64、
MIME 和显示名称交给 Renderer，Runtime 去掉显示名称后直接传入 Pi `prompt(..., { images })`。
Pi JSONL image block 是重启后的 authority，Projection 只重建可显示附件，不保存源路径。Composer
使用 Pi 原生 prompt expansion，因此 `registerCommand()`、Skills 和 Prompt Templates 共用同一 slash
入口；可见 `sendMessage()` 作为带稳定 completed Run 的 custom message 投影，`appendEntry()` 只在
Tree 中保留状态。Pi Runtime diagnostics 经脱敏事件进入桌面通知；Extension `registerProvider()`
继续直接作用于 Pi ModelRuntime，不转换成 Pictor Plugin 或复制 ExtensionAPI。

Pi Session Fork 是独立的 Runtime operation，不伪装成 Run。Main 先生成 operation/target Session
identity，但不写 Pictor metadata；utility host 精确打开已绑定的源 JSONL，绑定 Extension RPC UI，
调用 Pi `AgentSessionRuntime.fork(position: "at")`，完整执行 `session_before_fork`、源
`session_shutdown(reason: "fork")` 和目标 `session_start(reason: "fork")`。Pi 在其 Session 目录
创建新 JSONL；Pictor 只持久化 Pi 返回的绝对路径，不移动或重写源/目标文件。Runtime 返回 completed 后，
`AppRepository` 才绑定新 Pi identity、重建 Projection、提交新 Session 并更新导航；cancelled 不
创建 Pictor Session。Fork operation 复用现有 active-operation 与 Extension UI response 通道，不能
和 Run 并发。

Extension 触发 `newSession`、`fork` 或 `switchSession` 时，Main 在 utility process 收到 Pi
replacement 的 prepare 前写入 `session-replacement.json` journal；commit 会记录目标 JSONL
identity，完成 Session、Project 和选择状态持久化后清理 journal。取消、Pi replacement 失败或
进程退出会清理未提交的目标文件；重启时会恢复已进入 commit 阶段的事务。

Pi Session Clone 复用同一个 Runtime operation 与 Pi 原生 Fork lifecycle，但表达不同的产品意图：
Renderer 只提交源 Pictor Session identity，Main 通过 `inspectSessionHistory` 从权威 JSONL 推导
active leaf，并以 `fork(position: "at")` 复制当前完整分支。历史节点只允许 Fork，活跃叶节点只允许
Clone；两者共享并发锁、取消语义、Pi JSONL identity 和 Repository 提交事务，目标标题分别使用
`(Fork)` 与 `(Clone)` 区分。

Pi Session Import 是独立的 Project 级 Runtime operation。Renderer 只提交目标 Project identity，
Electron Main 的原生文件选择器取得源 `.jsonl` 路径；utility host 调用
`AgentSessionRuntime.importFromJsonl(source, projectRoot)`，让 Pi 复制文件并执行原生 resume
lifecycle。Pictor 只脱敏和绑定目标副本，绝不重写或移动源文件；失效或其他平台的原始 cwd 由当前
Project 根目录覆盖。Runtime completed 后 Repository 才提交新 Session，取消或失败不会留下
Pictor metadata。

Pi Session Export 是独立的 Session 级 Runtime operation。Renderer 只提交源 Session identity 和
`jsonl`/`html` 格式，保存路径始终由 Electron Main 的原生选择器取得。utility host 精确打开已绑定
的权威 JSONL，并调用 Pi 原生 `exportToJsonl` 或 `exportToHtml`；JSONL 线性化当前活跃分支，HTML
保留完整 Tree。Runtime 在临时 JSONL 副本上创建只读导出 Session，避免 Pi 初始化追加的设置 entry
改写权威历史；导出不创建 Pictor Session、不更新 Projection，目标路径也不得指向源 JSONL。
Runtime Plugin 同时携带 Pi HTML 模板和内置主题资产，避免依赖开发机的 `node_modules`。

Session 文件路径、schema 读写、凭据脱敏、损坏隔离、异常退出恢复及 Pi resume 安全集中在内部
`SessionPersistence` module；Pi JSONL 到桌面模型的映射集中在纯投影 module。它们直接使用本地
文件系统和现有凭据迁移函数，不增加通用 Repository、DAO 或存储 provider。相关测试通过真实
临时目录验证可观察行为。

Pi Runtime 直接使用 Pi SDK 提供的 `read`、`write`、`edit`、`bash`、`grep`、`find` 和 `ls`，不再
注册 Pictor 自定义工具、Bash 解释器、命令审批 Broker 或项目路径守卫。项目根目录作为 Pi 的
Session cwd，Shell、工具参数、进程生命周期和错误语义由 Pi SDK 与当前操作系统负责。

`linux-distribution.ts` 只在 Main 进程读取本机 `/etc/os-release`，把原生 Arch 或不受支持
Linux 映射为共享平台信息。Updater 在 Arch 选择原生 Pacman 资产，在其他 Linux 选择便携
AppImage；原始 os-release 内容不进入 IPC、持久化或日志。

共享的项目路径身份仅用于持久化去重：Windows 忽略大小写，Linux 保留大小写。Runtime 不把
项目路径身份误用为 Pi 文件工具的第二套访问边界。

Delegate Workbench GUI Plugin 的 `AgentWorkspace` 负责页面布局、Settings 容器、模型页和界面级 modal
编排，并从 GUI Host 接收公开 Settings Section 与 render context。内部
`useWorkspaceController` 通过注入的 `AgentWorkspaceClient` 管理 workspace snapshot、当前 Session、导航
竞态、Runtime event reconcile 与 Run/Project/Session intent；测试使用窄 bridge fake 直接验证
异步状态和事件顺序。不要在 UI 组件中重新实现刷新顺序，也不要为此引入第二套全局 store。

## 新代码放置

- Module 生命周期、Token、Contribution 和通用 contract 路由：`src/kernel/`。
- Application Host、Headless 生命周期端口和服务装配：`src/application/`。
- Command Engine、Core commands 和 Frontend transport contract：`src/commands/`。
- Plugin Manifest、Registry schema、依赖规划与隔离 Host：`src/plugin/`。
- Plugin Store、安装副本和 Bundled 恢复：`src/main/plugins/`。
- 新增 Headless 业务 Feature：`src/modules/<feature>/`，按需要创建 `shared.ts`、`host.ts`、
  `preferences.ts`、`update-service.ts` 或 `runtime.ts`；产品 GUI 放入对应 `plugins/<plugin>/`。
- Electron Main 启动装配：`src/main/index.ts`；DesktopHost、窗口、安全、协议和 IPC adapter：`src/main/desktop-host.ts`、`src/main/`。
- 本地状态、凭据和数据迁移：`src/main/persistence/`。
- Agent Run 的 Runtime Coordinator、监管、持久化和广播编排：`src/main/runtime/`，由 `ApplicationHost` 统一装配。
- Pi SDK adapter、Runtime Host 和 Extension RPC UI：`src/runtime/`。
- TUI Host、公开 Contribution、Node adapter、参数入口和 fake-terminal seam：`src/tui/`。
- Agent Workspace Headless contract、Host 和文件操作：`src/modules/agent-workspace/`。
- Delegate Workbench GUI、Session 视图与设置编排：`plugins/workbench-delegate/`。
- GUI Host、Workbench slot、Pictor Shell 与 GUI bootstrap：`src/gui/`。
- GUI Host 公共 Contribution：`src/gui/contract.ts`；GUI Plugin 样式生命周期 helper：
  `src/gui/plugin-style.ts`。
- GUI Plugin Manager：`plugins/gui-plugin-manager/`；Updater GUI：`plugins/updater/`；Git Changes
  GUI：`plugins/git-changes/`；Delegate Workbench GUI：`plugins/workbench-delegate/`。
- Delegate TUI：`plugins/tui-delegate/`；其 Manifest 只声明 `modules.tui`，依赖 Agent Workspace、
  Provider、Pi Runtime、Extension Host 和 Agent Resources，不导入 Repository、Plugin Store、
  RuntimeCoordinator、`src/main` 或 GUI 私有实现。
- 跨进程 schema 或类型：放入对应的 `src/shared/` 协议 module。

使用 `npm run plugin:new -- <name>` 生成 Manifest、Host/GUI 入口和测试骨架；
`npm run build:plugins` 将 `plugins/` 中的包构建到本地 Bundled 恢复源。`npm run module:new --
<name>` 只用于已有 Plugin 内部尚未迁移的 Module 源码，不会安装或登记 Plugin。

不要创建模糊的 `utils/`、`common/` 或 `services/`。文件较大不是拆分理由；只有出现更小且稳定的
interface、真实变化点或明显 locality 收益时才提取 module。

## 测试位置

单元测试与实现文件同层，使用 `*.test.ts(x)`；跨真实模块或进程协议的测试使用
`*.integration.test.ts`；Electron 用户场景放在 `e2e/`。测试应通过 module interface 验证可见
结果，不导入私有实现或使用不安全类型强转绕过 interface。
