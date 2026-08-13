# 发布说明

## 0.2.0 - 2026-08-13

Pictor 0.2.0 将正式桌面支持扩展到 Ubuntu 24.04 LTS x64 和原生 Arch Linux x64，同时保留
Windows 11 x64。关于页和命令审批现在显示实际平台；Linux 缺少 Bash 时应用仍能启动并主动
提示，命令工具则返回明确错误。获批命令使用固定的非登录 Bash 参数，Linux 停止或超时会终止
独立 POSIX 进程组，避免后台子进程残留。

项目边界现在遵循宿主平台的大小写语义：Linux 会拒绝大小写兄弟目录和符号链接逃逸，并允许
`/Repo` 与 `/repo` 作为不同项目；Windows 继续按不区分大小写的路径身份去重。更新检查只会
选择当前平台、x64 架构、版本和原生 Linux 发行版完全匹配的官方 HTTPS 资产，其他情况回退
到官方 Release 页面。

同一个 Release 现在原子发布 Windows NSIS、Ubuntu deb、Arch pacman 和 `SHA256SUMS`。
Linux 包校验覆盖包架构、元数据、桌面入口、`app.asar` 和 x64 ELF；发布工作流还分别使用
Ubuntu runner 与 Arch 容器验证安装和移除。PR 新增独立 `Linux acceptance`，在 Ubuntu 24.04
通过 Xvfb 执行真实 Electron Smoke，`develop` 和发布阶段执行 Full。

### 验收基线

- Ubuntu 24.04 LTS x64、GNOME Wayland；CI 使用 Ubuntu 24.04 + Xvfb，正式发布前仍需真实
  GNOME Wayland 桌面证据。
- 原生 Arch Linux x64，2026-08-13 滚动快照、内核 7.1.8-arch1-3、niri Wayland、
  Bash 5.3.15；允许 Electron 使用 XWayland。
- Windows 11 x64；现有 CI、E2E、NSIS 和更新资产行为必须继续通过。

2026-08-13 的本机 Arch 快照已通过格式、类型和 lint、124 项单元/集成测试、6 项真实 Electron
桌面 E2E、0.2.0 双包结构校验，以及一次性替代根中的 `pacman -U`/`pacman -Rns` 生命周期。
打包后的 x64 应用已在 niri Wayland 会话启动，Preload 返回 `linux`、`x64`、`arch`、Bash 可用
和版本 0.2.0，Renderer 非空；卸载验证保留了隔离用户数据。Ubuntu 与 Windows 的目标环境证据
由对应 required check 和正式 Release 工作流补充。

### 已知风险

- Windows 与 Linux 发布包均未签名，应用仍使用 Electron 默认图标。
- Arch 是滚动发行版，支持承诺以本节记录的快照为证据，不保证未来系统升级不会引入兼容性
  变化。Ubuntu/Arch 衍生版、其他 Linux、ARM64 和 macOS 不在正式支持范围。
- `auth.json` 仍为明文；Unix 请求 `0600` 权限，不集成 Secret Service 或系统 keyring。
- Xvfb 自动化不等同于真实 Wayland 桌面证据；Ubuntu 正式发布前必须另行完成该验收。
- 更新功能只打开官方发布包或 Release 页面，不提供静默下载、提权安装、自动重启或软件源。

## 0.1.3 - 2026-08-12

Pictor 0.1.3 建立了轻量的 `develop`/`main` 双分支协作流程。日常 Pull Request 合入默认分支
`develop`，发布 Pull Request 再以 merge commit 合入 `main`。CI 对两个长期分支执行统一的
质量、测试和桌面验收门禁，合并到 `develop` 后执行完整桌面 E2E。

合并到 `main` 现在会自动校验版本和发布说明，执行完整发布验证，构建并校验 Windows x64
安装包，随后创建版本标签和 GitHub Release。发布工作流拒绝覆盖已存在的版本，并在 Release
说明中附加安装包 SHA-256。项目管理文档同时明确了分支、Issue、Pull Request、hotfix 和
SemVer 发布规则。

验收通过格式、类型和 lint 检查、103 个单元/集成测试、6 个 Electron 桌面 E2E 测试，以及
Windows x64 NSIS 安装包构建和架构校验。

### 已知风险

- 自动发布依赖 GitHub Hosted Windows runner 和 GitHub Release 服务可用。
- 安装程序和 `Pictor.exe` 未经 Authenticode 签名，且仍使用 Electron 默认应用图标。
- 当前发布产物仍仅支持 Windows x64；Linux 和 macOS 打包尚未实现。

## 0.1.2 - 2026-08-12

Pictor 0.1.2 统一了凭据在 Windows、Linux 和 macOS 上的持久化语义。API Key 现在明文保存
在 Electron 用户数据目录下独立的 `data-v1/auth.json` 中，并依靠当前用户的数据目录和文件
权限保护；普通设置、项目、Session 和 Pi 会话仍不会保存 API Key。设置页同步说明了这一安全
边界，不再将凭据描述为已加密。

从 0.1.1 升级时，Pictor 会使用 Electron `safeStorage` 解密旧 `secrets.json`，原子写入新的
`auth.json` 后删除旧文件。损坏或不符合格式的 `auth.json` 会按未配置凭据处理，用户可以直接
重新保存密钥，不会阻止应用启动。凭据写入继续使用临时文件替换，Unix 平台请求 `0600`
权限。

验收通过格式、类型和 lint 检查、完整构建、103 个单元/集成测试，以及凭据保存、应用重启
恢复和历史内容脱敏的 Electron E2E 测试。

### 已知风险

- `auth.json` 不加密；能够以当前用户身份读取 Pictor 用户数据目录的进程可以读取 API Key。
- 安装程序和 `Pictor.exe` 未经 Authenticode 签名，且仍使用 Electron 默认应用图标。
- 当前发布产物仍仅支持 Windows x64；Linux 和 macOS 打包尚未实现。
- 更新功能负责检查版本并打开官方安装包，不提供应用内静默下载、安装或自动重启。

## 0.1.1 - 2026-08-12

Pictor 0.1.1 完善了首个补丁版本的发布体验。侧栏的模型设置入口升级为统一设置，新增“关于”
页面，用于查看应用版本、平台、许可证、作者和项目地址。用户可以主动检查 Pictor 官方 GitHub
Release；发现新版本后可打开官方 Windows x64 安装包，未附带匹配安装包时则打开对应发布页。
应用不会在后台轮询更新。

更新查询和下载入口均由 Main Process 执行，只接受 Pictor 官方仓库的 HTTPS Release 与安装包
地址。项目元数据已补全作者、MIT 许可证、仓库、主页和问题反馈地址；开发环境的版本展示也已
修正为 Pictor 自身版本，而不是 Electron 运行时版本。

验收通过格式、类型和 lint 检查、完整构建、101 个单元/集成测试、6 个隐藏 Electron E2E
测试，以及 Windows x64 NSIS 安装包构建和架构校验。E2E 使用本地确定性 OpenAI 兼容服务，
未使用真实第三方 API Key。

### 已知风险

- 安装程序和 `Pictor.exe` 未经 Authenticode 签名，且仍使用 Electron 默认应用图标。
- 安装和卸载验证仍缺少净 Windows 环境证据。
- 更新功能负责检查版本并打开官方安装包，不提供应用内静默下载、安装或自动重启。
- 当前仅支持 Windows x64，持久化数据格式仍是 MVP，未承诺跨版本兼容性。

## 0.1.0 - 2026-08-11

Pictor 0.1.0 是 Windows x64 MVP。它提供本地项目和持久化 Session、Pi Agent 流式委托、
项目内文件操作、逐条 Git Bash 命令审批，以及模型设置。模型设置支持 OpenAI 兼容的 Chat
Completions 与 Responses、`/models` 模型发现和可选推理强度。发布物为 NSIS 安装程序和
解包应用；验收已验证 x64 产物、静默安装、安装后启动和静默卸载。

验收还通过了格式检查、完整构建、95 个单元/集成测试和 6 个隐藏 Electron E2E 测试。E2E
使用本地确定性 OpenAI 兼容服务，并未使用真实第三方 API Key。

### 已知风险

- 安装程序和 `Pictor.exe` 未经 Authenticode 签名，且仍使用 Electron 默认应用图标。
- 安装和卸载验证在非净 Windows 开发机上完成，尽管验收使用了隔离安装位置和用户数据并在
  完成后清理；没有净机安装证据。
- 尚未针对任意外部凭据型 OpenAI 兼容服务商完成端到端验证；服务商对协议、模型发现和推理
  强度的支持可能不同。
- 当前仅支持 Windows x64，持久化数据格式仍是 MVP，未承诺跨版本兼容性。
