# Pictor Plugin SDK

`@pictor/plugin-sdk` 是 Pictor 仓库内部用于编写 Plugin 的可移植 Interface。它通过 npm workspace
参与开发，并由 `build:plugins` 内联到各 Plugin bundle；发布应用不在运行时解析该 workspace。

使用显式子路径导入需要的 Interface：

- `@pictor/plugin-sdk/module`：Module、Token、Contribution Point 与生命周期 context；
- `@pictor/plugin-sdk/contract`：跨进程 Module contract、handler 注册和 transport client；
- `@pictor/plugin-sdk/plugin`：Host、GUI、TUI、Runtime entrypoint context；
- `@pictor/plugin-sdk/manifest`：Manifest schema 与类型；
- `@pictor/plugin-sdk/pi-extension`：原生 Pi Extension path Contribution Point。

SDK 副本与 Pictor Core 通过稳定 ID 互操作，不依赖 class identity。Token、Contribution Point、Module
contract 和 Plugin ID 一旦公开给另一个 Plugin，ID 就是 Interface 的一部分，不得静默改变或复用。
Core 仍拥有 Plugin 加载、依赖规划、Module Kernel、Router、IPC 和进程生命周期实现。

当前包固定使用私有的 `0.0.0` 开发版本，不发布到 npm，也不承诺独立于 Pictor 版本演进。GUI、
Agent Workspace 和 Runtime 的大型产品 contract 尚未迁入 SDK；Bundled Plugin 可以继续从文档明确
的 Core Interface 导入它们，但不得直接导入 `src/kernel` 或 `src/plugin` 实现。

验证 SDK：

```bash
npm run test:sdk
npm run check:types --workspace @pictor/plugin-sdk
npm run build:plugins
```
