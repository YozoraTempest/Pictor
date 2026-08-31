# 项目管理与发布流程

Pictor 使用轻量双分支模型。GitHub Issues 记录可交付工作，Pull Request 承担评审和验证，
不额外维护一套重复的任务状态。

## 分支

- `main`：GitHub 默认分支和稳定产品分支，接受来自 `develop` 的发布 Pull Request、
  `hotfix/*` 紧急修复，以及必须先进入默认分支的路径受限 `ci/*` 控制面维护。只有包含版本文件
  变化的合并才触发正式发布；控制面维护不得修改应用源码或版本。
- `develop`：日常集成分支，功能、修复和维护 Pull Request 均以它为目标；在 GitHub 创建普通
  Pull Request 时必须主动将 base 分支改为 `develop`。
- 短期分支：通常从 `develop` 创建，使用 `feature/<topic>`、`fix/<topic>`、`docs/<topic>` 或
  `ci/<topic>` 命名，合并后删除。只有 GitHub 定时工作流等必须先存在于默认分支的控制面维护，
  才从 `main` 创建 `ci/<topic>` 并直接向 `main` 提交 Pull Request。
- `hotfix/<topic>`：仅用于已发布版本的紧急修复，从 `main` 创建并直接向 `main` 提交 Pull
  Request；发布后必须再将 `main` 合回 `develop`。

功能分支合入 `develop` 可以使用 squash merge。`develop` 合入 `main` 必须使用 merge commit，
使两个长期分支保持共同历史；不得对发布 Pull Request 使用 squash 或 rebase merge。
`hotfix/*` 或控制面 `ci/*` 合入 `main` 后，必须及时将 `main` 合回 `develop`。

## 工作项

一个 Issue 应描述一个能够独立验收的结果，包括问题、完成条件和必要限制。只有存在明确版本
目标时才创建 Milestone，并将计划进入该版本的 Issue 加入其中。优先级只使用高、中、低三档；
阻塞项在 Issue 中说明阻塞原因和解除条件，不复制到额外看板。

Pull Request 应关联对应 Issue，说明行为变化和实际验证结果。功能未完成时使用 Draft Pull
Request；准备合并时必须保证范围可审查，避免把无关重构塞进同一提交。

## 持续集成

- 指向 `develop` 或 `main` 的 Pull Request：在 Linux 并行执行格式、类型、lint、全量 Vitest 和
  桌面 Smoke；Windows acceptance 暂时只验证依赖准备与桌面构建。PR 不构建发行包。
- 从 `develop` 或 `hotfix/*` 指向 `main` 的发布 Pull Request：额外校验版本一致性、发布说明和
  版本标签可用性。
- 从 `ci/*` 指向 `main` 的非发布 Pull Request：只允许修改 `.github/workflows/*.yml`、根
  `README.md`、`CONTRIBUTING.md`、`docs/PROJECT_MANAGEMENT.md` 和 `docs/TESTING.md`；不执行
  发布元数据校验，也不得成为普通功能或文档变更绕过 `develop` 的入口。
- 合并进入 `develop`：在上述检查之外仅由 Linux 执行全部桌面 E2E，并构建、校验和验收 Pacman
  与 AppImage。Windows 自动化测试暂时停用。
- CI 失败时不得合并。测试失败证据保留七天。

必需检查为 `Quality`、`Unit and integration`、`Windows acceptance` 和独立的
`Linux acceptance`。`main` 与 `develop` 均禁止强推和删除，并要求通过 Pull Request 合并。

### Nightly

进入 `main` 的 Nightly 工作流每天北京时间 02:17 读取远端 `develop` 的最新提交，并在开始时固定
该 SHA，保证 Windows、Pacman 和 AppImage 来自同一源码快照。现有 `nightly` 标签已指向该提交时
跳过定时重建；维护者可以手动启用 `force` 输入强制重建。

Nightly 先在只读权限的 Windows 与 Linux job 中完成构建、测试、包校验和生命周期验收，并使用
保留一天的 workflow artifact 向最终 publish job 传递安装包。只有全部平台成功后，publish job
才获得 `contents: write` 权限，生成 `SHA256SUMS`，删除上一份滚动 Nightly Pre-release 与
`nightly` 标签，再以固定源码 SHA 一次发布完整的新附件。Nightly 必须标记为 Pre-release 且不设为
Latest；发布说明必须记录完整源码 SHA、构建时间、未签名和不保证稳定的风险。

滚动 `nightly` 是允许覆盖的开发快照，不形成持久版本契约。正式 `v*` 标签、Release 和附件仍然
不可覆盖，也不得由 Nightly 工作流修改。若仓库启用 GitHub Immutable Releases，滚动 Nightly
必须先迁移到独立仓库或改用唯一标签，不能关闭正式发布的不可变保护来维持滚动标签。

## 发布

发布准备在 `develop` 完成：

1. 按 SemVer 更新 `package.json` 和 `package-lock.json`，两处版本必须一致。
2. 在 `docs/RELEASE_NOTES.md` 顶部新增 `## <version> - YYYY-MM-DD`，说明变化、验证和已知风险。
3. 更新 README 中的当前安装版本、支持基线和对应限制。
4. 本地运行 `npm run verify:release`，并在可用目标平台运行对应包验证。
5. 确认 hosted runner 的 AppImage Smoke、Arch 容器 Pacman 生命周期和本机 Arch/niri Wayland
   证据均通过；不能用发行版衍生版代替正式支持环境。
6. 创建 `develop` 到 `main` 的 Pull Request，等待全部必需检查通过后使用 merge commit 合并。

包含 `package.json` 或 `package-lock.json` 版本变化的合并进入 `main` 后，Release 工作流会再次
执行完整发布验证，并构建以下同版本 x64 资产：

```text
Pictor-<version>-windows-x64-setup.exe
Pictor-<version>-arch-x64.pacman
Pictor-<version>-linux-x64.AppImage
SHA256SUMS
```

Windows 与 Linux 构建 job 只上传内部 workflow artifact。只有全部构建、结构校验和包生命周期
验收成功，单一 publish job 才创建 `v<version>` 标签和 GitHub Release，并一次附加三端资产
及 SHA-256。任一平台失败都不得创建部分 Release。若版本标签已经存在，工作流会失败并要求
先提升版本，避免静默覆盖发布物。

不要手工创建正式版本标签或上传本地构建产物。发布失败时保留 `main` 现状，在 `develop` 修复
并提升补丁版本后重新走发布 Pull Request；已经公开的版本和附件不得覆盖。

Pictor 不提供 Linux 软件源、包签名或应用内提权安装。Release 附件是首期唯一正式发布渠道；
应用内更新只负责打开 Windows、Arch 原生包或便携 AppImage，不能静默安装、重启或调用系统
包管理器。AppImage 不构成对其他 Linux 发行版的正式支持承诺。
