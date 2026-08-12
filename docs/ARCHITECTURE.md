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
