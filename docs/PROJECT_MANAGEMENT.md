# 项目管理与发布流程

Pictor 使用轻量双分支模型。GitHub Issues 记录可交付工作，Pull Request 承担评审和验证，
不额外维护一套重复的任务状态。

## 分支

- `main`：GitHub 默认分支和稳定发布分支，只接受来自 `develop` 的发布 Pull Request；每次合并
  都会触发正式发布。默认分支用于展示和克隆稳定代码，不是普通贡献的合并目标。
- `develop`：日常集成分支，功能、修复和维护 Pull Request 均以它为目标；在 GitHub 创建普通
  Pull Request 时必须主动将 base 分支改为 `develop`。
- 短期分支：从 `develop` 创建，使用 `feature/<topic>`、`fix/<topic>`、`docs/<topic>` 或
  `ci/<topic>` 命名，合并后删除。
- `hotfix/<topic>`：仅用于已发布版本的紧急修复，从 `main` 创建并直接向 `main` 提交 Pull
  Request；发布后必须再将 `main` 合回 `develop`。

功能分支合入 `develop` 可以使用 squash merge。`develop` 合入 `main` 必须使用 merge commit，
使两个长期分支保持共同历史；不得对发布 Pull Request 使用 squash 或 rebase merge。

## 工作项

一个 Issue 应描述一个能够独立验收的结果，包括问题、完成条件和必要限制。只有存在明确版本
目标时才创建 Milestone，并将计划进入该版本的 Issue 加入其中。优先级只使用高、中、低三档；
阻塞项在 Issue 中说明阻塞原因和解除条件，不复制到额外看板。

Pull Request 应关联对应 Issue，说明行为变化和实际验证结果。功能未完成时使用 Draft Pull
Request；准备合并时必须保证范围可审查，避免把无关重构塞进同一提交。

## 持续集成

- 指向 `develop` 或 `main` 的 Pull Request：格式、类型、lint、单元/集成测试，以及 Windows
  与 Ubuntu 24.04 桌面 Smoke。
- 指向 `main` 的 Pull Request：额外校验来源分支、版本一致性、发布说明和版本标签可用性。
- 合并进入 `develop`：在上述检查之外执行 Windows 与 Ubuntu 24.04 全部桌面 E2E。
- CI 失败时不得合并。测试失败证据保留七天。

必需检查为 `Quality`、`Unit and integration`、`Windows acceptance` 和独立的
`Linux acceptance`。`main` 与 `develop` 均禁止强推和删除，并要求通过 Pull Request 合并。

## 发布

发布准备在 `develop` 完成：

1. 按 SemVer 更新 `package.json` 和 `package-lock.json`，两处版本必须一致。
2. 在 `docs/RELEASE_NOTES.md` 顶部新增 `## <version> - YYYY-MM-DD`，说明变化、验证和已知风险。
3. 更新 README 中的当前安装版本、支持基线和对应限制。
4. 本地运行 `npm run verify:release`，并在可用目标平台运行对应包验证。
5. 确认 Ubuntu 24.04 hosted runner 的完整 E2E 与 deb 生命周期、Arch 容器生命周期和可用的
   本机 Arch Wayland 证据均通过；不能用发行版衍生版代替受支持发行版。
6. 创建 `develop` 到 `main` 的 Pull Request，等待全部必需检查通过后使用 merge commit 合并。

合并到 `main` 后，Release 工作流会再次执行完整发布验证，并构建以下同版本 x64 资产：

```text
Pictor-<version>-windows-x64-setup.exe
Pictor-<version>-ubuntu-x64.deb
Pictor-<version>-arch-x64.pacman
SHA256SUMS
```

Windows 与 Linux 构建 job 只上传内部 workflow artifact。只有全部构建、结构校验和包生命周期
验收成功，单一 publish job 才创建 `v<version>` 标签和 GitHub Release，并一次附加三端资产
及 SHA-256。任一平台失败都不得创建部分 Release。若版本标签已经存在，工作流会失败并要求
先提升版本，避免静默覆盖发布物。

不要手工创建正式版本标签或上传本地构建产物。发布失败时保留 `main` 现状，在 `develop` 修复
并提升补丁版本后重新走发布 Pull Request；已经公开的版本和附件不得覆盖。

Pictor 不提供 Linux 软件源、包签名或应用内提权安装。Release 附件是首期唯一正式发布渠道；
应用内更新只负责打开当前平台和发行版的官方附件，不能静默安装、重启或调用系统包管理器。
