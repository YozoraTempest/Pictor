# 当前代码架构

本文描述 Pictor 当前已经实现的代码结构和依赖规则。产品长期方向见架构草稿；新代码应遵循
这里的现实结构，不得提前引入尚未落地的微内核或插件系统。

## 源码域

应用源码统一位于 `src/`：

```text
src/
├── main/       Electron Main、IPC、持久化、更新和 Runtime 监管
├── preload/    Desktop bridge 的 Electron adapter
├── renderer/   React 界面
├── runtime/    独立 Agent Runtime Host、Pi adapter 和项目工具
└── shared/     跨进程可序列化模型与协议
```

`main`、`preload`、`renderer` 和 `runtime` 分别对应不同的运行环境。一个目录可以包含多个内部
module，但跨进程调用必须经过 `shared` 中的协议，不能直接导入另一个进程的实现。

`e2e/` 保存 Electron 用户场景，`scripts/` 保存构建和发布验证，`tests/` 只保存 Vitest 全局
测试基础设施。这些工程文件不属于应用源码，不迁入 `src/`。

## 共享协议

- `domain.ts`：Project、Session、Run、Message 和 Tool 等持久化模型。
- `model.ts`：模型端点设置、连接测试和模型发现语义。
- `desktop-bridge.ts`：Renderer 与 Main 之间的请求、结果和 `PictorBridge` interface。
- `runtime-protocol.ts`：Main 与 Runtime Host 之间的 command、host message 和 Runtime event。
- `path-identity.ts`：Windows 与 Linux 的项目路径身份语义，不读取文件系统。
- `errors.ts`：可跨进程表达的错误代码和 `PictorError`。
- `secret-redaction.ts`：Session、Runtime event 和 Pi transcript 的凭据脱敏。

不要重新增加一个导出所有共享内容的总入口。调用者应直接依赖自己使用的协议 module，使
interface 保持可见且范围明确。

## 依赖方向

```text
Renderer -> Desktop bridge -> Preload adapter -> IPC -> Main
Main -> Runtime protocol -> Runtime Host -> Pi adapter
Main / Preload / Renderer / Runtime -> Shared
Shared -X-> 任何进程实现
Runtime -X-> Main / Preload / Renderer
Renderer -X-> Electron / Node / 其他进程实现
```

ESLint 对这些方向执行静态检查。`tsconfig.node.json` 覆盖 Main、Preload、Runtime、Shared 和
E2E；`tsconfig.web.json` 只覆盖 Renderer、Shared 和 Web 测试基础设施。

`RuntimeCoordinator` 拥有自身需要的窄 persistence 和 Runtime host interface。现有
`AppRepository` 与 `RuntimeSupervisor` 直接满足它们；测试使用 in-memory adapter，不依赖具体
实现类型。不要为整个持久化模块添加只有一个 production adapter 的抽象。

`AppRepository` 是 Main 进程的工作区状态入口，只协调 Project、Settings、导航选择和持久化
初始化。Session 文件路径、schema 读写、凭据脱敏、损坏隔离、异常退出恢复及 Pi resume 安全
集中在内部 `SessionPersistence` module；它直接使用本地文件系统和现有凭据迁移函数，不增加
通用 Repository、DAO 或存储 provider。相关测试通过真实临时目录验证该 module 的可观察行为。

`command-interpreter.ts` 在 Main 进程识别当前平台可用的 Bash，并把解析后的绝对路径作为
Runtime 启动配置传入 utility process。Runtime 不重新猜测用户环境；`BashCommandExecutor`
只负责固定参数执行、输出和进程生命周期。Windows 使用 Git for Windows 的 Bash 并终止进程
树；Linux 将每条命令放入独立 POSIX 进程组，在停止或超时时终止整个组。这个窄配置边界保留
了以后更换 Command Interpreter 的变化点，而不把通用 Shell 抽象扩散到工具协议。

`linux-distribution.ts` 只在 Main 进程读取本机 `/etc/os-release`，把原生 Ubuntu、原生 Arch
或不受支持 Linux 映射为共享平台信息。Renderer 只消费映射结果，更新服务也只用该结果选择
当前版本、平台和架构完全匹配的官方资产；原始 os-release 内容不进入 IPC、持久化或日志。

Runtime 的 `ProjectPathGuard` 按宿主文件系统的大小写语义做真实路径边界检查。共享的项目路径
身份仅用于持久化去重：Windows 忽略大小写，Linux 保留大小写。符号链接解析和越界拒绝仍只
位于 Runtime 文件系统边界，不能用字符串路径身份函数替代。

Renderer 的 `App` 只负责页面布局、Settings 和界面级 modal 编排。内部
`useWorkspaceController` 通过注入的 `PictorBridge` 管理 workspace snapshot、当前 Session、导航
竞态、Runtime event reconcile 与 Run/Project/Session intent；测试使用窄 bridge fake 直接验证
异步状态和事件顺序。不要在 UI 组件中重新实现刷新顺序，也不要为此引入第二套全局 store。

## 新代码放置

- Electron 生命周期、窗口、安全、更新或 IPC adapter：`src/main/`。
- 本地状态、凭据和数据迁移：`src/main/persistence/`。
- Agent Run 的监管、持久化和广播编排：`src/main/runtime/`。
- Pi SDK、命令审批、项目路径守卫和 Agent 工具：`src/runtime/`。
- 工作区与 Session 视图：`src/renderer/workspace/`。
- 设置、关于和更新视图：`src/renderer/settings/`。
- 无业务语义且可复用的视图元素：`src/renderer/ui/`。
- 跨进程 schema 或类型：放入对应的 `src/shared/` 协议 module。

不要创建模糊的 `utils/`、`common/` 或 `services/`。文件较大不是拆分理由；只有出现更小且稳定的
interface、真实变化点或明显 locality 收益时才提取 module。

## 测试位置

单元测试与实现文件同层，使用 `*.test.ts(x)`；跨真实模块或进程协议的测试使用
`*.integration.test.ts`；Electron 用户场景放在 `e2e/`。测试应通过 module interface 验证可见
结果，不导入私有实现或使用不安全类型强转绕过 interface。
