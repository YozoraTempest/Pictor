# 发布说明

## 0.4.0 - 2026-09-02

Stage 10 完成多 Frontend 打包收口。`npm run build:distribution` 从干净输出一次构建 GUI、CLI、
TUI 和正好 10 个 0.4 Bundled Plugins，再由 electron-builder 生成同一版本的 `app.asar`。正式
入口统一为 `pictor`、`pictor cli ...` 和 `pictor tui ...`；Windows 安装目录提供
`bin\pictor.cmd`，Arch `/usr/bin/pictor` 与 AppImage `AppRun` 进入同一个 POSIX launcher。入口
从自身/AppDir 提供固定的包版本、资源目录和 identity，支持带空格的路径和任意 cwd，不调用系统
Node，也不会从 cwd 读取 `package.json`、`.pictor` 或静默回退空 Profile。

Electron 43 / electron-builder 26 的 V1 fuses 现在在配置中逐项显式声明并在实际 Windows PE、
Linux ELF wire 上校验：保留 `runAsNode` 以支持不依赖系统 Node 的 CLI/TUI，关闭 `NODE_OPTIONS`、
Node CLI inspect 和 `file://` extra privileges，开启 `onlyLoadAppFromAsar`。该取舍沿用 Electron
官方关于 `runAsNode` 攻击面的说明；launcher 只限制正常入口，不是安全沙箱，也不能消除保留该
fuse 的本地代码执行面。

包级门禁覆盖 NSIS、Pacman 和 AppImage 的真实结构与入口；GUI、CLI、TUI 的 Profile 排他锁在冲突
时返回稳定退出码 `4`，退出后可由下一个 Frontend 获取。packaged CLI 移除 Workbench 后，GUI
通过 10 个随包 recovery source 进入 Pictor Shell；用户恢复并重启后回到 Delegate，项目、Session、
凭据和 Pi JSONL 数据保持不变。Windows shortcut、安装/卸载、Arch 容器生命周期和 hosted runner
证据由 `package-desktop.yml` 条件门禁提供，不在本地 Linux 证据中冒充净机验收。

本阶段保持 0.4.0、`data-v1`、Pi JSONL、凭据、Plugin Registry、Stable/Nightly 资产名以及
Windows 11 x64、Arch Linux x64 和便携 AppImage 的既有支持边界。没有创建 release 分支、tag 或
Release；已知 Pi terminal/异步退出接管和 TUI replacement 限制仍见 README。

## 0.3.0 - 2026-08-21

Pictor 0.3.0 将产品能力迁入可组合 Plugin Host。Core Host 现在只保留 Electron 生命周期、空
Shell、Plugin Store/Registry、Plugin Manager 和跨进程 transport；Project、Session、Model、
Updater、Git Changes、Agent Resources、Pi Runtime 与 Pi Extension Host 都由可安装、可禁用、
可删除和可恢复的 Bundled Plugin 提供。Plugin 使用 SemVer 依赖图组合，缺失或失败的 Provider
只阻塞传递依赖者；删除全部 Plugin 后仍可启动 Core Shell 并恢复默认能力。

Agent 会话现在直接使用 Pi `AgentSessionRuntime`，Pi JSONL 是 Session Tree、消息、Tool、Usage、
Compaction 和 Extension entry 的唯一权威历史。桌面支持 Tree 查看与原生分支导航、Fork、Clone、
Import、JSONL/HTML Export、Branch Summary、手动与自动 Compaction、Active Leaf、Session Label、
Thinking、Model override、Tool 与消息队列控制、Token/Cost 状态、图片消息、资源重载和自动 Retry。
Pictor 投影只负责 GUI 展示；同一 utility process 会复用打开的 Pi Session，Runtime 重启时从
持久化的绝对 Pi JSONL 路径重建，不重放历史 Tool，也不移动 Pi 管理的 Session 文件。

原生 `.ts/.js` Pi Extension、Extension 目录和 Pi Package 无需 Pictor wrapper 即可安装并交给 Pi
ResourceLoader/ExtensionRunner 执行。Extension 可以注册 Tool、Command、Provider、事件和消息；
select/confirm/input/editor、notify 与文本状态通过 GUI adapter 呈现，TUI-only 能力返回明确诊断。
本地 live source、项目 `.pi/extensions`、显式 npm/git/local Package spec、Developer Profile、
`plugin:new` 和独立 Plugin 测试循环共同构成快速开发路径。

Linux 发布策略不再把 GitHub Hosted Ubuntu runner 当作受支持发行版。原生 Arch Linux x64/niri
是唯一正式支持的 Linux 基线，Release 提供 `.pacman`；其他 Linux x64 只提供便携 `.AppImage`，
不承诺发行版兼容。0.3.0 不再生成 Ubuntu `.deb`。同一个 Release 原子发布 Windows NSIS、Arch
Pacman、Linux AppImage 和 `SHA256SUMS`。

### 验收基线

- 原生 Arch Linux x64，2026-08-21 滚动快照、内核 7.1.8-arch1-3、niri Wayland；允许 Electron
  使用 XWayland。
- Linux 完成格式、类型与 lint、217 项单元/集成测试、10 项真实 Electron E2E、Pacman/AppImage
  结构校验、AppImage 启动 Smoke 和 Arch Pacman 安装生命周期。
- Windows 11 x64 仅由 Hosted Runner 验证依赖准备、桌面构建、NSIS、`app.asar` 与 x64 PE 结构；
  0.3.0 没有 Windows Runtime、GUI、安装或干净机器行为验收。

### 已知风险

- Windows 与 Linux 发布物均未签名，应用仍使用 Electron 默认图标。
- Pi Extension 是以当前用户权限运行的可信代码，不受 Pictor 命令逐条审批限制；安装前必须确认
  来源。
- Chat Completions 和 Responses 由本地确定性端点覆盖，尚未使用真实第三方 API Key 验证服务商
  兼容性、计费或可用性。
- Arch 是滚动发行版，支持承诺以本节快照为证据；AppImage 不构成其他 Linux 发行版支持承诺。
- 当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。

## 0.2.1 - 2026-08-14

Pictor 0.2.1 将正式桌面支持扩展到 Ubuntu 24.04 LTS x64 和原生 Arch Linux x64，同时保留
Windows 11 x64。关于页和命令审批现在显示实际平台；Linux 缺少 Bash 时应用仍能启动并主动
提示，命令工具则返回明确错误。获批命令使用固定的非登录 Bash 参数，Linux 停止或超时会终止
独立 POSIX 进程组，避免后台子进程残留。

0.2.0 发布候选在创建标签和 GitHub Release 前被原子发布流程停止：Ubuntu 安装包已成功安装，
但启动探针在 Renderer 离开加载态前过早取证。0.2.1 改为等待 `.app-shell` 或 `.fatal-state`
明确终态；前者继续验证可见尺寸，后者保留错误证据并让发布失败，不使用固定延时或宽松重试。

项目边界现在遵循宿主平台的大小写语义：Linux 会拒绝大小写兄弟目录和符号链接逃逸，并允许
`/Repo` 与 `/repo` 作为不同项目；Windows 继续按不区分大小写的路径身份去重。更新检查只会
选择当前平台、x64 架构、版本和原生 Linux 发行版完全匹配的官方 HTTPS 资产，其他情况回退
到官方 Release 页面。

同一个 Release 现在原子发布 Windows NSIS、Ubuntu deb、Arch pacman 和 `SHA256SUMS`。
Linux 包校验覆盖包架构、元数据、桌面入口、`app.asar` 和 x64 ELF；发布工作流还分别使用
Ubuntu runner 与 Arch 容器验证安装和移除。PR 新增独立 `Linux acceptance`，在 Ubuntu 24.04
通过 Xvfb 执行真实 Electron Smoke，`develop` 和发布阶段执行 Full。

### 验收基线

- Ubuntu 24.04 LTS x64；发布验收使用 Ubuntu 24.04 hosted runner + Xvfb、完整 Electron E2E
  与 deb 安装、启动、移除和用户数据保留，不要求额外的真实桌面证据。
- 原生 Arch Linux x64，2026-08-14 滚动快照、内核 7.1.8-arch1-3、niri Wayland、
  Bash 5.3.15；允许 Electron 使用 XWayland。
- Windows 11 x64；现有 CI、E2E、NSIS 和更新资产行为必须继续通过。

2026-08-14 的本机 Arch 快照已通过格式、类型和 lint、128 项单元/集成测试、6 项真实 Electron
桌面 E2E、0.2.1 双包结构校验，以及用户命名空间替代根中的 pacman 安装、注册与移除。来自
`.pacman` 的 x64 应用已在 niri Wayland 会话完成启动和核心委托，Preload 返回 `linux`、`x64`、
`arch`、Bash 可用和版本 0.2.1；卸载验证保留了隔离用户数据。原生 Arch 容器会在 required check
中复验完整安装脚本。Ubuntu 由对应 required check 和正式 Release 工作流验收。

### 已知风险

- Windows 与 Linux 发布包均未签名，应用仍使用 Electron 默认图标。
- Arch 是滚动发行版，支持承诺以本节记录的快照为证据，不保证未来系统升级不会引入兼容性
  变化。Ubuntu/Arch 衍生版、其他 Linux、ARM64 和 macOS 不在正式支持范围。
- `auth.json` 仍为明文；Unix 请求 `0600` 权限，不集成 Secret Service 或系统 keyring。
- Ubuntu 尚未单独验证真实 GNOME Wayland 桌面，支持证据以 hosted runner + Xvfb 自动化为准。
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
