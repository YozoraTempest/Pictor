# Pictor

Pictor 是一个面向 Agent 委托工作流的 Windows 与 Linux 桌面开发环境。当前 0.3.0 版本提供
可组合 Plugin Host、本地项目、Pi JSONL 权威 Session、原生 Pi Agent Runtime 与 Extension、
Pi 原生工具和 OpenAI 兼容模型配置。

## 当前能力

- 添加、移除和重新关联本地项目，项目路径经过规范化后作为项目身份；
- 创建、切换、重命名和删除 Session，重启后保留消息、运行与工具记录；
- GUI 选择 Session 时同步打开对应的 Pi Session，并关闭此前驻留的 Pi Session；单个 utility
  process 同时最多持有一个 Pi Session；
- 打开 Pi Session Tree，查看完整分支结构并以只读 Projection 检查任意历史节点；
- 从 Tree 中的历史节点执行 Pi 原生同文件导航，并从该分支继续下一次 Run；
- 手动压缩当前 Pi 分支、提供自定义摘要指令、取消压缩，并显示自动 Compaction 状态；
- 在 Tree Navigation 时总结被放弃分支，或选择历史 User Message 回填 Composer 后重新编辑；
- 配置每个 Session 的 Thinking Level、Active Tools 和 Steering/Follow-up delivery mode；
- 显示当前分支 Model/Thinking，重新加载 Runtime 资源，并把 Pictor 标题同步到 Pi Session Name；
- 在同一个 utility process 中复用打开的 Pi Session，并支持 Extension 触发原生 `newSession`、`fork`
  与 `switchSession` 的完整替换事务；
- 流式展示 Thinking、显示 Pi 自动重试状态，并为任意 Session Tree 节点设置原生 Label；
- 从原生选择器附加图片并发送 Pi Image Message，重建后继续显示图片内容；
- 从 Composer 调用 Pi slash command，并显示 Extension `sendMessage`/`sendUserMessage` 与 diagnostic；
- 从 Session Tree 的历史节点执行 Pi 原生 Fork，创建并切换到独立的新 Pictor Session；
- 从 Session Tree 的活跃叶节点 Clone 当前分支，创建并切换到独立的新 Pictor Session；
- 从项目菜单导入原生 Pi Session JSONL 副本，保留完整 Tree 并绑定到当前项目；
- 从 Session 菜单用 Pi 原生语义导出当前分支 JSONL 或完整 Tree HTML，不改写权威历史；
- 通过可删除的 `pictor.pi-agent-runtime` Bundled Plugin 原生使用 Pi `AgentSessionRuntime`，接入
  支持流式文本和工具调用的模型端点；
- 直接使用 Pi 的 `read`、`write`、`edit`、`bash`、`grep`、`find` 和 `ls` 工具；
- 展示 Markdown 回复、工具状态、命令输出、错误、停止和中断状态；
- 配置 Chat Completions 或 Responses 兼容模式、API Base URL、模型标识、API Key、模型
  推理强度、温度和最大输出 Token 数；支持从兼容的 `/models` 端点获取并选择模型；
- 在设置的“关于”页查看版本，并按需检查 GitHub Release；有新版本时只打开与当前平台、
  架构匹配的 Windows、Arch 或便携 Linux 官方发布包，否则安全回退到对应发布页；
- 通过 Plugin Host 从用户 Store 动态装配 Main/Renderer Module，支持 SemVer 依赖、故障隔离、
  安全模式和独立 Plugin 测试循环；Updater 已作为可删除、可恢复的 Bundled Plugin 运行。
- `pictor.pi-extension-host` 可直接安装、禁用和删除原生 `.ts/.js` Pi Extension、Extension 目录
  与本地 Pi Package；Package Manifest 和约定 `extensions/` 都交给 Pi 原生解析，自定义 Tool 和
  RPC UI dialog 无需 Pictor wrapper 即可进入会话 GUI。
- 明确安装的本地 Pi Extension 直接从 live source 加载，修改源文件后下一次资源 reload 或新建
  Session 使用新版本；源不可用时回退到 Store 安装副本。
- Project、Session 与 Conversation GUI 由可删除的 `pictor.agent-workspace` 提供；删除全部
  Bundled Plugin 后，Core Shell 仍可启动并打开 Plugin Manager。
- `pictor.git-changes` 依赖 Agent Workspace，并通过独立 Main contract 与 Renderer 设置页显示
  当前项目的 Git working tree；它验证了真实 Plugin 间依赖与组合。
- `pictor.model-openai-compatible` 作为独立 Runtime Provider 注册 Chat Completions/Responses
  模型；Pi Runtime 只消费 `model.providers` Contribution，不硬编码模型供应商。
- `pictor.agent-resources` 以原生 Pi 目录提供 Skills 与 Prompt Templates；活跃 Run 支持 Steering
  与 Follow-up 队列，并在会话标题区显示 Pi token/context usage。

首期全局同时只运行一个 Agent。编辑器、Git 工作流、多 Agent、第三方 Plugin 分发、远程项目、WSL、
容器、macOS、Linux ARM64、静默更新、系统密钥环、包签名和软件源不在当前范围内。

## 支持基线

| 平台           | 环境                                               | Release Asset | 支持语义                   |
| -------------- | -------------------------------------------------- | ------------- | -------------------------- |
| Windows x64    | Windows 11 x64                                     | NSIS `.exe`   | 正式支持                   |
| Arch Linux x64 | 原生 Arch Linux，2026-08-21 滚动快照、niri Wayland | `.pacman`     | 唯一正式支持的 Linux 环境  |
| 其他 Linux x64 | 未指定                                             | `.AppImage`   | 便携资产，不承诺发行版兼容 |

Arch 的 Wayland 会话可以由 Electron 使用 XWayland，不承诺强制原生 Wayland。Arch 衍生版和
其他 Linux 发行版不属于正式支持范围，即使 AppImage 可能可以运行。所有平台还需要：

- Node.js 22.22.2 或更新版本，仅本地开发需要；Pi 会按当前平台解析原生 Shell；
- 一个兼容 OpenAI Chat Completions 或 Responses、SSE 流式响应和函数工具调用的模型端点。

Pictor 不再预探测、替换或审批 Bash。`bash` 工具由 Pi 原生实现，以当前用户权限和当前 Session
工作目录执行；具体 Shell、环境和超时行为遵循所使用的 Pi Agent 版本。

## 安装与卸载

从 0.3.0 起，正式 GitHub Release 原子提供以下 x64 发布包及 `SHA256SUMS`：

```text
Pictor-<version>-windows-x64-setup.exe
Pictor-<version>-arch-x64.pacman
Pictor-<version>-linux-x64.AppImage
```

Windows：运行 NSIS 安装程序并按向导选择安装位置。要卸载，请在“已安装的应用”中选择
Pictor，或运行安装目录中的卸载程序。

原生 Arch Linux：

```bash
sudo pacman -U ./Pictor-<version>-arch-x64.pacman
sudo pacman -Rns pictor
```

其他 x64 Linux 可以尝试直接运行便携 AppImage：

```bash
chmod +x ./Pictor-<version>-linux-x64.AppImage
./Pictor-<version>-linux-x64.AppImage
```

Pictor 自身不会调用 `sudo`、`pkexec` 或 `pacman`；安装和卸载始终是用户在应用外明确执行的
操作。Pacman 卸载和删除 AppImage 都不会删除用户数据。关闭应用后，可另行删除 Windows 的
`%APPDATA%\pictor`，或 Linux 默认的 `~/.config/pictor`；设置了 `XDG_CONFIG_HOME` 时，Linux
数据目录位于 `$XDG_CONFIG_HOME/pictor`。

发布包和解包可执行文件均未签名，且仍使用 Electron 默认图标。请只从 Pictor 官方 GitHub
Release 获取文件，并通过同一 Release 的 `SHA256SUMS` 核对摘要；组织策略要求签名时暂缓部署。

## 本地运行

```bash
npm ci
npm run deps:prepare
npm run deps:verify
npm run dev
```

`npm run dev` 先构建本地 Bundled Plugin，再启动 electron-vite watch/HMR，并使用独立的
`pictor-dev` userData，不会读取或修改正式安装的数据。新建可安装能力使用
`npm run plugin:new -- <name>`；只新增 Plugin 内部执行单元时使用 `npm run module:new -- <name>`。
设置 `PICTOR_PLUGIN_PROFILE=developer` 使用 Developer Profile；Plugin Manager 可以登记 live source
Development Plugin，修改其已构建入口后重启 Pictor 即可生效，不需要重新打包 Pictor。

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
npm run test:module -- updater
npm run test:plugin -- host
npm run test:watch
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
执行对应结构校验。Windows 校验 NSIS、`app.asar` 和 x64 PE；Linux 校验 Pacman 元数据、
AppImage 内容、桌面入口、`app.asar` 和 x64 ELF。结构校验不代替安装生命周期、桌面启动、
签名或外部服务商兼容性验收。

Electron E2E 使用本地确定性 OpenAI 兼容服务验证完整 GUI、真实 Pi SDK、utility process、
原生工具与 Extension、取消、凭据重启、活动运行关闭确认和中断恢复，不需要外部模型凭据。完整分层、
CI 门禁和发行版验收见 [`docs/TESTING.md`](docs/TESTING.md)。

应用源码统一位于 `src/`。`kernel/` 保存最小 Module Kernel，`modules/` 按 Feature 聚合新增
功能；既有代码继续按 Electron Main、Preload、Renderer、Agent Runtime 和共享协议划分并逐步
迁移。目录职责、跨进程协议和允许依赖方向见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

日常开发从 `develop` 创建短期分支并通过 Pull Request 合回；包含版本提升的 `develop` 合并到
`main` 时自动创建正式版本。默认分支定时工作流等控制面维护使用路径受限的 `ci/*` Pull Request，
不触发正式发布。分支、Issue、Pull Request 和发布规则见
[`CONTRIBUTING.md`](CONTRIBUTING.md) 和
[`docs/PROJECT_MANAGEMENT.md`](docs/PROJECT_MANAGEMENT.md)。仓库默认展示稳定的 `main`；提交
普通贡献时，请在 GitHub 上将 Pull Request 的目标分支改为 `develop`。

项目领域术语见 [`CONTEXT.md`](CONTEXT.md)，已接受的架构决策见 [`docs/adr/`](docs/adr/)。

## 已知限制

- Windows、Arch 和 AppImage 发布物及应用可执行文件未签名，应用图标仍使用 Electron 默认图标。
- Windows CI 暂时只验证桌面构建和发布包结构，不执行 Vitest 或 Electron E2E；Windows 桌面行为
  需要独立手工验收，不能由当前 `Windows acceptance` 结论推导。
- Windows 安装验收尚未取得净机证据；AppImage 只执行结构与启动 Smoke，不构成其他 Linux
  发行版兼容承诺。
- Arch 是滚动发行版，正式支持以发布说明记录的快照日期为验收基线，不承诺未来系统更新永不
  影响已发布版本。
- Chat Completions 和 Responses 均由本地确定性 OpenAI 兼容端点覆盖。尚未用真实第三方
  API Key 验证任何外部服务商。
- 正式支持仅覆盖 Windows 11 x64 与原生 Arch Linux x64/niri；持久化格式尚未形成跨版本兼容
  承诺。

## 本地数据与安全边界

Pictor 将版本化状态写入 Electron `userData/data-v1`。普通设置保存在 `state.json`，每个
Session 的导航元数据、Pi Session identity 和可重建投影以 schema v2 独立保存在 `sessions/`；
`pi/` 中的 Pi JSONL 是 Agent 对话历史的唯一权威。启动后的终态投影会从对应 JSONL 重建，
不会把 Renderer event 形成的平面消息副本当作历史来源。旧 schema v1 若没有可匹配的 Pi JSONL，
会归档到 `sessions/legacy-imports/` 并保持只读，避免无提示丢失上下文后继续运行。

API Key 明文保存在独立的 `auth.json`，依靠当前用户的数据目录和文件权限保护；Unix 写入请求
`0600`。它不会返回 Renderer，也不会写入项目、Session 投影或 Pi JSONL。不要共享该文件或
整个用户数据目录。

源码开发默认把数据写入独立的 `pictor-dev/data-v1`，自动化测试继续使用各自的临时目录。

Renderer 启用 Chromium sandbox、context isolation 和限制性 CSP，不开放 Node 或原始
Electron API。Pi Runtime Plugin 从用户 Store 动态加载到独立 utility process，直接交给 Pi
ResourceLoader、ExtensionRunner 和原生工具注册表；删除或禁用该 Plugin 后，项目与历史仍可查看，
但不能启动新 Run。Pi Extension 和 Pi 原生工具以当前用户权限运行，安装或信任项目之前必须确认
来源。Pictor 的模型 API Key 不进入 Extension 配置、Runtime event 或 Pi JSONL。受信任 Project 的
`.pi/extensions`、Skills 和 Prompt Templates 由 Pi 原生资源解析器自动加载，Session Controls 只
管理 Pi 暴露的模型、Thinking、工具和队列偏好。

更新检查只在用户点击“检查更新”后由 Main Process 请求 Pictor 官方 GitHub Release API；
应用不会在后台轮询。Linux 只在本机读取 `/etc/os-release` 识别原生 Arch，不上传或记录该
文件。Arch 下载按钮优先打开匹配的官方 Pacman 资产，其他 Linux 只打开匹配版本和架构的官方
AppImage；没有匹配资产时回退到官方发布页。

Pictor 不为 Pi 工具增加第二套项目路径守卫或命令审批；项目根目录作为 Pi Session 的工作目录，
文件与 Shell 操作遵循 Pi 和当前操作系统的权限语义。需要更强隔离时，应使用操作系统或容器提供
的隔离能力。

当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。
