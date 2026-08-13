# Pictor

Pictor 是一个面向 Agent 委托工作流的 Windows 与 Linux 桌面开发环境。当前版本提供本地
项目、持久化 Session、Pi Agent 流式对话、项目文件操作、逐条命令审批和单个模型 API 配置。

## 当前能力

- 添加、移除和重新关联本地项目，项目路径经过规范化后作为访问边界；
- 创建、切换、重命名和删除 Session，重启后保留消息、运行与工具记录；
- 通过 `@earendil-works/pi-coding-agent` 接入支持流式文本和工具调用的模型端点；
- 列出、搜索、读取、创建、编辑、移动和删除项目内文件；
- 在显示完整命令、工作目录和用途后，允许一次或拒绝 Bash 命令；
- 展示 Markdown 回复、工具状态、命令输出、错误、停止和中断状态；
- 配置 Chat Completions 或 Responses 兼容模式、API Base URL、模型标识、API Key、模型
  推理强度、温度和最大输出 Token 数；支持从兼容的 `/models` 端点获取并选择模型；
- 在设置的“关于”页查看版本，并按需检查 GitHub Release；有新版本时只打开与当前平台、
  架构和受支持 Linux 发行版匹配的官方发布包，否则安全回退到对应发布页。

首期全局同时只运行一个 Agent。编辑器、Git 工作流、多 Agent、插件、远程项目、WSL、
容器、macOS、Linux ARM64、静默更新、系统密钥环、包签名和软件源不在当前范围内。

## 支持基线

| 平台           | 正式支持的环境                                     | Release Asset | Command Interpreter         |
| -------------- | -------------------------------------------------- | ------------- | --------------------------- |
| Windows x64    | Windows 11 x64                                     | NSIS `.exe`   | Git for Windows 提供的 Bash |
| Ubuntu x64     | Ubuntu 24.04 LTS、GNOME Wayland                    | `.deb`        | 系统 Bash                   |
| Arch Linux x64 | 原生 Arch Linux，2026-08-13 滚动快照、niri Wayland | `.pacman`     | 系统 Bash                   |

Wayland 会话可以由 Electron 使用 XWayland，不承诺强制原生 Wayland。Ubuntu 衍生版、Arch
衍生版和其他 Linux 发行版不属于正式支持范围，即使某些环境可能可以运行。所有平台还需要：

- Node.js 22.22.2 或更新版本，仅本地开发需要；
- 一个兼容 OpenAI Chat Completions 或 Responses、SSE 流式响应和函数工具调用的模型端点。

Linux 缺少 Bash 时，Pictor 仍可启动并使用不依赖命令执行的功能；界面会主动提示，命令工具
会返回明确错误。首期固定使用非登录 Bash，并以 `--noprofile --norc -lc` 执行每条获批命令，
不读取用户的登录 Shell 配置。

## 安装与卸载

0.2.0 同一个 GitHub Release 提供以下 x64 发布包及 `SHA256SUMS`：

```text
Pictor-0.2.0-windows-x64-setup.exe
Pictor-0.2.0-ubuntu-x64.deb
Pictor-0.2.0-arch-x64.pacman
```

Windows：运行 NSIS 安装程序并按向导选择安装位置。要卸载，请在“已安装的应用”中选择
Pictor，或运行安装目录中的卸载程序。

Ubuntu 24.04 LTS：

```bash
sudo apt install ./Pictor-0.2.0-ubuntu-x64.deb
sudo apt remove pictor
```

原生 Arch Linux：

```bash
sudo pacman -U ./Pictor-0.2.0-arch-x64.pacman
sudo pacman -Rns pictor
```

Pictor 自身不会调用 `sudo`、`pkexec`、`apt`、`dpkg` 或 `pacman`；安装和卸载始终是用户在
应用外明确执行的操作。卸载发布包不会删除用户数据。关闭应用后，可另行删除 Windows 的
`%APPDATA%\pictor`，或 Linux 默认的 `~/.config/pictor`；设置了 `XDG_CONFIG_HOME` 时，
Linux 数据目录位于 `$XDG_CONFIG_HOME/pictor`。

发布包和解包可执行文件均未签名，且仍使用 Electron 默认图标。请只从 Pictor 官方 GitHub
Release 获取文件，并通过同一 Release 的 `SHA256SUMS` 核对摘要；组织策略要求签名时暂缓部署。

## 本地运行

```bash
npm ci
npm run deps:prepare
npm run deps:verify
npm run dev
```

首次启动后，在“设置 > 模型”中完成以下配置，再添加本地项目并创建 Session：

- 选择 **Chat Completions** 或 **Responses**。API Base URL 填 API 根地址，例如
  `https://api.example.com/v1`；Pictor 会分别请求 `/chat/completions` 或 `/responses`。
- 输入模型标识和 API Key。远程端点必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 或
  `::1` 可以使用 HTTP。
- 可使用“获取模型”从同一 Base URL 的 `/models` 获取 OpenAI 兼容模型列表并选择模型。
  该调用需要端点返回非空的 `{ "data": [{ "id": "..." }] }`；不兼容或空列表时请手动
  输入模型标识。
- 可将推理强度留空，或选择 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`。对于
  Chat Completions，Pictor 发送 `reasoning_effort`；对于 Responses，发送
  `reasoning.effort`。端点和模型是否接受所选级别取决于服务商。

保存前运行连接测试。它会解析实际 SSE 事件，并要求模型执行一次无副作用函数调用，以验证
所选协议、流式响应和工具调用；测试通过不代表已验证真实服务商的计费、可用性或模型质量。

## 验证

日常提交前运行快速验证；PR 级验证会额外构建一次桌面应用并执行核心 E2E Smoke：

```bash
npm run verify:fast
npm run verify:pr
```

发布前运行 `npm run verify:release`，然后在目标平台构建并验证发布包：

```bash
npm run package:windows:build
npm run package:verify:windows

npm run package:linux:build
npm run package:verify:linux
PICTOR_EXPECTED_DISTRIBUTION=arch npm run package:verify:linux:launch
```

`npm run package:dir` 按当前平台生成解包应用，`npm run package` 按当前平台生成正式发布包并
执行对应结构校验。Windows 校验 NSIS、`app.asar` 和 x64 PE；Linux 校验 `.deb`/`.pacman`
元数据、桌面入口、`app.asar` 和 x64 ELF。结构校验不代替安装生命周期、桌面启动、签名或
外部服务商兼容性验收。

Electron E2E 使用本地确定性 OpenAI 兼容服务验证完整 GUI、真实 Pi SDK、utility process、
命令审批、取消、凭据重启、活动运行关闭确认和中断恢复，不需要外部模型凭据。完整分层、
CI 门禁和发行版验收见 [`docs/TESTING.md`](docs/TESTING.md)。

应用源码统一位于 `src/`，并按 Electron Main、Preload、Renderer、Agent Runtime 和共享协议
划分。目录职责、跨进程协议和允许依赖方向见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

日常开发从 `develop` 创建短期分支并通过 Pull Request 合回；`develop` 合并到 `main` 时自动
创建正式版本。分支、Issue、Pull Request 和发布规则见
[`CONTRIBUTING.md`](CONTRIBUTING.md) 和
[`docs/PROJECT_MANAGEMENT.md`](docs/PROJECT_MANAGEMENT.md)。仓库默认展示稳定的 `main`；提交
普通贡献时，请在 GitHub 上将 Pull Request 的目标分支改为 `develop`。

项目领域术语见 [`CONTEXT.md`](CONTEXT.md)，已接受的架构决策见 [`docs/adr/`](docs/adr/)。

## 已知限制

- Windows、Ubuntu 和 Arch 发布包及应用可执行文件未签名，应用图标仍使用 Electron 默认图标。
- Windows 安装验收尚未取得净机证据；Ubuntu 的正式发布仍要求真实 GNOME Wayland 环境证据。
- Arch 是滚动发行版，正式支持以发布说明记录的快照日期为验收基线，不承诺未来系统更新永不
  影响已发布版本。
- Chat Completions 和 Responses 均由本地确定性 OpenAI 兼容端点覆盖。尚未用真实第三方
  API Key 验证任何外部服务商。
- 首期仅支持 Windows、Ubuntu 24.04 LTS 和原生 Arch Linux 的 x64 桌面；持久化格式尚未形成
  跨版本兼容承诺。

## 本地数据与安全边界

Pictor 将版本化状态写入 Electron `userData/data-v1`。普通设置保存在 `state.json`，每个
Session 独立保存在 `sessions/`，Pi 私有会话位于 `pi/`。API Key 明文保存在独立的
`auth.json`，依靠当前用户的数据目录和文件权限保护；Unix 写入请求 `0600`。它不会返回
Renderer，也不会写入项目或 Session 数据。不要共享该文件或整个用户数据目录。

Renderer 启用 Chromium sandbox、context isolation 和限制性 CSP，不开放 Node 或原始
Electron API。Pi 运行在独立 utility process 中，内置工具和项目扩展均被禁用，只能调用
Pictor 提供且经过路径守卫的工具。

更新检查只在用户点击“检查更新”后由 Main Process 请求 Pictor 官方 GitHub Release API；
应用不会在后台轮询。Linux 只在本机读取 `/etc/os-release` 识别原生 Ubuntu 或 Arch，不上传
或记录该文件。下载按钮只允许打开与当前平台、x64 架构和受支持发行版完全匹配的官方 HTTPS
资产；没有匹配资产时回退到官方发布页。

项目文件操作限定在解析后的项目根目录内，并拒绝父目录跳转、大小写敏感兄弟目录、符号链接
和目录联接逃逸。命令审批是明确的用户授权边界，不是操作系统沙箱：获批命令仍以当前用户权限
运行。每条命令最多执行十分钟；Windows 会终止命令进程树，Linux 会终止独立 POSIX 进程组，
包括外层 Bash 及其子进程。

当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。
