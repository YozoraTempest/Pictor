# 贡献指南

感谢参与 Pictor。仓库默认展示稳定的 `main`，但日常开发统一集成到 `develop`。

## 提交变更

1. 从最新的 `develop` 创建短期分支，按变更类型使用 `feature/<topic>`、`fix/<topic>`、
   `docs/<topic>` 或 `ci/<topic>` 命名。
2. 保持变更范围单一，并在提交前运行 `npm run verify:fast`；涉及桌面交互时再运行
   `npm run verify:pr`。
3. 创建 Pull Request 时将 base 分支改为 `develop`，关联对应 Issue，并填写实际验证结果。
4. 等待 `Quality`、`Unit and integration` 和 `Windows acceptance` 全部通过后合并。

必须先进入 GitHub 默认分支才能生效的定时工作流或同类控制面维护是唯一例外：从最新 `main`
创建 `ci/<topic>`，只修改 `.github/workflows/*.yml` 及对应的根 README、贡献指南、测试或项目管理
文档，并直接向 `main` 提交 Pull Request。合并后必须将 `main` 合回 `develop`。该路径不得包含
应用源码、版本文件或普通产品文档，也不会触发正式 Release。

新增或移动代码前请阅读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。跨进程交互必须经过
共享协议，不得直接导入其他进程的实现；测试应与实现就近放置并通过公开 interface 验证行为。

不要将普通功能或修复直接提交到 `main`。除上述路径受限的控制面维护外，`develop` 到 `main` 的
Pull Request 仅用于正式发布；`hotfix/*` 只用于已发布版本的紧急修复，并须遵循
[`docs/PROJECT_MANAGEMENT.md`](docs/PROJECT_MANAGEMENT.md) 中的版本与回合并要求。
