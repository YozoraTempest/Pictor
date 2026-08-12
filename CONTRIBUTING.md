# 贡献指南

感谢参与 Pictor。仓库默认展示稳定的 `main`，但日常开发统一集成到 `develop`。

## 提交变更

1. 从最新的 `develop` 创建短期分支，按变更类型使用 `feature/<topic>`、`fix/<topic>`、
   `docs/<topic>` 或 `ci/<topic>` 命名。
2. 保持变更范围单一，并在提交前运行 `npm run verify:fast`；涉及桌面交互时再运行
   `npm run verify:pr`。
3. 创建 Pull Request 时将 base 分支改为 `develop`，关联对应 Issue，并填写实际验证结果。
4. 等待 `Quality`、`Unit and integration` 和 `Windows acceptance` 全部通过后合并。

不要将普通功能或修复直接提交到 `main`。`develop` 到 `main` 的 Pull Request 仅用于正式发布；
`hotfix/*` 只用于已发布版本的紧急修复，并须遵循
[`docs/PROJECT_MANAGEMENT.md`](docs/PROJECT_MANAGEMENT.md) 中的版本与回合并要求。
