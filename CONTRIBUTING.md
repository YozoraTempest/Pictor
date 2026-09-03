# 贡献指南

感谢参与 Pictor。仓库默认展示稳定的 `main`，日常开发统一集成到 `develop`。

## 分支与 Pull Request

- 从最新 `develop` 创建短期分支，使用 `feature/<topic>`、`fix/<topic>`、`refactor/<topic>`、
  `docs/<topic>` 或 `ci/<topic>`。
- 普通 Pull Request 的 base 必须是 `develop`；关联对应 Issue，并说明行为变化和实际验证。
- 保持变更范围单一。提交前至少运行 `npm run verify:fast`，涉及桌面组装时运行
  `npm run verify:pr`。
- 等待 `Quality`、`Unit and integration`、`Windows acceptance` 和 `Linux acceptance` 通过后
  合并。打包面变更还应通过条件触发的 `Package CI`。
- 功能分支可以 squash merge。发布时 `develop` 到 `main` 必须使用 merge commit，使长期分支
  保持共同历史。

不要将普通功能、修复或文档直接提交到 `main`。`hotfix/<topic>` 只用于已发布版本的紧急修复，
从 `main` 创建并合回 `main`；发布后必须再把 `main` 合回 `develop`。

必须先存在于 GitHub 默认分支才能生效的定时 Workflow 是唯一控制面例外：从 `main` 创建
`ci/<topic>`，只修改 `.github/workflows/*.yml` 及直接相关的 README、贡献或测试说明，并直接向
`main` 提交 Pull Request。该路径不得包含应用源码或版本文件，合并后同样把 `main` 合回
`develop`。

## 代码边界

新增或移动代码前阅读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：

- 跨进程与跨 Plugin 交互必须经过公开、可序列化的 contract。
- Plugin、Module 和 Contribution 是不同层级，不得合并成一个依赖图。
- 产品 GUI 属于 Plugin；Core GUI 只保留 Host、Shell、诊断和恢复。
- 测试与实现就近放置，并通过公开 Interface 验证行为。
- 仓库当前不维护 E2E 测试。未经维护者针对具体场景明确批准，不得新增 E2E 测试、Runner 依赖或
  CI 步骤。

新 Plugin 使用 `npm run plugin:new -- <name>`；只为现有 Plugin 增加内部执行单元时使用
`npm run module:new -- <name>`。

## 发布

发布准备在 `develop` 完成：

1. 按 SemVer 同步更新 `package.json` 和 `package-lock.json`。
2. 在 `docs/RELEASE_NOTES.md` 顶部加入对应版本、日期、变化、验证和已知风险。
3. 更新 README 中的当前能力、支持基线和限制。
4. 创建 `develop` 到 `main` 的 Pull Request；Package CI 会使用稳定通道执行源码复验和
   Windows/Linux 包验收。
5. 全部门禁通过并补齐目标平台要求的桌面证据后，使用 merge commit 合并。

`npm run verify:release` 只是在本地提前复现当前平台发布路径的可选命令，不是发布的人工前置。

版本变更合入 `main` 后，Release Workflow 才能创建 `v<version>` 标签和 GitHub Release。不要手工
创建正式标签、覆盖已发布版本或上传本地构建产物。发布失败时在 `develop` 修复并提升补丁版本后
重新发布。

## 文档治理

维护者的 Trilium「开源项目知识库 / Pictor」是产品方向、完整领域模型、详细架构、决策理由和
历史知识的权威来源。仓库只保留公开参与所需的最小文档：README、贡献规则、当前架构约束、测试
与 CI、发布说明和 Plugin SDK Interface。

代码或 Workflow 改变公开行为时，先更新最接近执行面的仓库文档；涉及方向、理由或历史时同时
更新 Trilium，不在仓库新增重复的产品草稿、路线图或 ADR 目录。
