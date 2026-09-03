# Pictor

Pictor 是一个面向 Agent 委托工作流的 Windows 与 Linux 桌面开发环境。当前 0.4.0 版本提供
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
- 在设置的“关于”页查看版本，选择并记忆稳定版或 Nightly 更新通道，再按需检查 GitHub
  Release；有新版本或滚动快照时只打开与当前平台、架构匹配的 Windows、Arch 或便携 Linux
  官方发布包，否则安全回退到对应发布页；
- 通过 Plugin Host 从用户 Store 动态装配 Host/GUI/TUI/Runtime Module，支持 SemVer 依赖、故障隔离、
  安全模式和独立 Plugin 测试循环；Updater 已作为可删除、可恢复的 Bundled Plugin 运行。
- `pictor.pi-extension-host` 可直接安装、禁用和删除原生 `.ts/.js` Pi Extension、Extension 目录
  与本地 Pi Package；Package Manifest 和约定 `extensions/` 都交给 Pi 原生解析，自定义 Tool 和
  RPC UI dialog 无需 Pictor wrapper 即可进入会话 GUI。
- 明确安装的本地 Pi Extension 直接从 live source 加载，修改源文件后下一次资源 reload 或新建
  Session 使用新版本；源不可用时回退到 Store 安装副本。
- Project、Session、Settings 与 Runtime contract 由可删除的
  `pictor.agent-workspace` 提供；Delegate Workbench 由可删除的
  `pictor.workbench.delegate` GUI Plugin 提供。删除 Workbench 后，Core Shell 仍可启动，CLI
  仍可使用 Headless Workspace。
- `pictor.gui.plugin-manager` 是独立的 GUI-only Bundled Plugin，通过公开 Settings Section
  管理 Plugin 生命周期；删除它不会影响 Delegate 或模型设置，Pictor Shell 仍可恢复它。
- `pictor.tui.delegate` 是独立的 TUI-only Bundled Plugin；`src/tui` 以 Node Composition root
  复用同一 Profile 锁、Application Host、Workspace、Provider、Pi Runtime 和 Pi JSONL，TUI
  不启动 Electron 或 `pi` 子进程。
- `pictor.git-changes` 依赖 Agent Workspace，并通过独立 Host contract 与 GUI 设置页显示
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

- Node.js 22.22.2 或更新版本，仅本地开发和构建需要；已安装/便携包的 CLI、TUI 使用包内 Electron
  Node adapter，不调用系统 `node`；Pi 会按当前平台解析原生 Shell；
- 一个兼容 OpenAI Chat Completions 或 Responses、SSE 流式响应和函数工具调用的模型端点。

Pictor 不再预探测、替换或审批 Bash。`bash` 工具由 Pi 原生实现，以当前用户权限和当前 Session
工作目录执行；具体 Shell、环境和超时行为遵循所使用的 Pi Agent 版本。

## 安装与卸载

从 0.4.0 起，正式 GitHub Release 原子提供以下 x64 发布包及 `SHA256SUMS`：

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

### 三个 Frontend 入口

正式包统一使用三个入口：`pictor` 启动 GUI，`pictor cli ...` 启动 CLI，`pictor tui ...` 启动
TUI。Arch 安装后的 `/usr/bin/pictor` 是由包安装脚本创建的精确符号链接，AppImage 的 `AppRun`
和它都进入同一个 POSIX launcher；两者都以自身或 `$APPDIR` 推导路径，支持带空格的安装目录和任意
当前工作目录。Windows 不修改用户 `PATH`，请使用安装目录中的
`<安装目录>\bin\pictor.cmd`；桌面和开始菜单快捷方式也指向这个清除环境变量的 GUI 入口，避免
与 `Pictor.exe` 的 `PATHEXT` 优先级混淆。

GUI 默认会清除继承的 `ELECTRON_RUN_AS_NODE`；只有 `cli`/`tui` 明确设置它，并把固定的
`out/cli/src/cli/entry.js` 或 `out/tui/src/tui/entry.js` 传给包内 Electron。入口向 Node adapter
提供 `app.asar`、包版本、构建通道、源码提交和 `resources/bundled-plugins`，因此不会从启动 cwd
读取 `package.json`、`.pictor`，也不会因身份缺失静默回退到空 Profile。默认 user-data 仍为当前
平台既有的 `data-v1` 路径；`--user-data-dir` 可显式选择共享 Profile。

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
新 Plugin 的 Module、contract、entrypoint 和 Manifest 从内部 `@pictor/plugin-sdk` workspace 的
显式子路径导入；该 SDK 会进入 Plugin bundle，不要求发布应用在运行时提供 workspace `node_modules`。
SDK 当前为私有开发 Interface，不是已发布 npm 包，也不形成第三方兼容承诺。
设置 `PICTOR_PLUGIN_PROFILE=developer` 使用 Developer Profile；Plugin Manager 可以登记 live source
Development Plugin，修改其已构建入口后重启 Pictor 即可生效，不需要重新打包 Pictor。

开发 CLI 不需要 Electron runtime。安装依赖后可直接构建并运行系统 Node 入口；这只属于开发命令，
不代表发布包要求系统 Node：

```bash
npm run build:cli
node out/cli/src/cli/entry.js --help
npm run cli -- --json doctor
```

CLI 默认使用与开发 GUI 相同的 `pictor-dev` user-data/profile；开发或测试时可用
`--user-data-dir <path>` 指定目录。除 `help` 和 `version` 外的命令会获取共享 Profile 单写锁，
支持 `doctor`、`plugin` 生命周期命令和映射到 `plugin.*` 的 `ui` 命令。JSON 模式只在 stdout 写入
一个 JSON 文档，退出码为成功 `0`、失败 `1`、用法错误 `2`、Profile 冲突 `4`、取消 `130`。

开发 TUI 使用独立 Node 入口，不依赖 Electron；发布包通过上述 `pictor tui ...` launcher 复用
随包 Electron：

```bash
npm run build:tui
npm run tui -- --user-data-dir ./pictor-tui --non-interactive
npm run tui -- --user-data-dir ./pictor-tui --project /path/to/project
```

入口支持 `--user-data-dir`、`--safe-mode`、`--profile`、`--project`、`--session` 和
`--tui-mode regular|fullscreen`。没有项目时只显示首次使用诊断，不猜测或静默创建目录；有
明确项目路径时才会通过 Agent Workspace 注册并创建 Session。TUI 的成功、失败、用法错误、
Profile 冲突、无可用 TUI、Plugin 失败和取消退出码分别为 `0`、`1`、`2`、`4`、`5`、`6`、`130`。

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

日常提交前运行快速验证；PR 级验证会额外执行一次干净的 GUI/CLI/TUI/Plugin distribution build
并执行核心 E2E Smoke。打包相关改动由独立 Package CI 构建并验收 Windows NSIS、Pacman 和
AppImage，不在基础 CI 中维护条件分支：

```bash
npm run test:module -- updater
npm run test:plugin -- host
npm run test:sdk
npm run test:watch
npm run verify:fast
npm run verify:pr
npx vitest run src/tui plugins/tui-delegate scripts/tui-import-boundaries.test.mjs
```

发布前运行 `npm run verify:release`。该命令在当前主机执行当前平台的 Full E2E、包构建和统一
黑盒验收；Windows 净机、Arch 原生安装生命周期和 hosted CI 的另一个平台证据由
`package-desktop.yml` 提供：

```bash
npm run package:windows:build
npm run package:linux:build
npm run package:verify
```

`npm run package:dir` 按当前平台生成解包应用，`npm run package` 按当前平台生成正式发布包并
执行对应结构校验。`npm run build:distribution` 会先清理并一次构建全部 GUI、CLI、TUI 和 10 个
Bundled Plugins；所有 `package:*` 发布构建都消费这一产物，不会把陈旧的 `out/cli` 或 `out/tui`
带入包。Windows 校验 NSIS、`app.asar`、x64 PE、快捷方式和 Windows launcher；Linux 校验
Pacman 元数据、AppImage 内容、桌面入口、`app.asar`、fuse wire 和 x64 ELF。统一验收还从带
空格路径启动真实 GUI/CLI/TUI，验证 page target、Profile 排他锁和平台安装生命周期；它不重复
普通 E2E 已覆盖的富 DOM 与 Plugin 恢复场景。

Electron E2E 只保留跨模块组装证据：PR 验证一次真实 Pi SDK/utility process 委托和 Windows Shell；
Nightly/Release 额外验证中断恢复、启动恢复、原生 Extension Tool/RPC 与两个 Plugin 重启场景。
业务规则、协议变体和持久化边界由 Vitest 在对应 seam 验证，不需要外部模型凭据。完整分层、CI
门禁和发行版验收见 [`docs/TESTING.md`](docs/TESTING.md)。

应用源码统一位于 `src/`。`kernel/` 保存最小 Module Kernel，`modules/` 按 Feature 聚合新增
功能；既有代码继续按 Electron Main、Preload、Renderer、Agent Runtime 和共享协议划分，
`tui/` 是不导入 Electron/GUI 私有实现的 Node Frontend。目录职责、跨进程协议和允许依赖方向见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
Plugin 作者使用的可移植 Interface 位于 [`packages/plugin-sdk`](packages/plugin-sdk)，Bundled Plugin
源码继续位于 `plugins/` 并与应用保持同仓库、同版本、同发布快照。
Headless Application Host、Command Engine、GUI/TUI/CLI Frontend、Pictor Shell 和 Workbench
Plugin 的当前边界统一记录在 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 打包安全模式

Pictor 对 Electron 43 的 V1 fuse 逐项显式配置：`runAsNode` 保持启用，是为了让 CLI/TUI 使用
随包 Electron 而不依赖系统 Node 的有意识例外；`NODE_OPTIONS` 和 Node CLI inspect 参数关闭，
`onlyLoadAppFromAsar` 开启，`file://` extra privileges 关闭，其他支持的项也固定在
`electronFuses` 中并在打包后读取实际 wire。Windows/Linux GUI binary 的 wire 必须与配置一致，
并由 `package:verify` 验证；禁用 `runAsNode` 的副本不会执行 CLI 入口。

launcher 只缩小正常调用入口，不是安全沙箱，也不能消除保持 `runAsNode` fuse 所带来的本地代码
执行面。该取舍同时保留了不安装系统 Node 的 CLI/TUI 体验；请只运行可信的 Pictor 包和 Plugin。
参考 [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) 与
[`ELECTRON_RUN_AS_NODE` 文档](https://www.electronjs.org/docs/latest/api/environment-variables/#electron_run_as_node)。

删除或禁用 `pictor.workbench.delegate` 后，GUI 会进入 Pictor Shell；Shell 列出随包的 10 个
recovery source，用户恢复 Workbench 后重启回到 Delegate。该行为由普通 E2E 与包内容检查共同
覆盖，不在每个平台重复同一富 UI 场景。CLI/TUI 与 GUI 共用 Profile 排他锁：冲突稳定退出码为
`4`，持锁 Frontend 退出后下一个 Frontend 才能获取。

日常开发从 `develop` 创建短期分支并通过 Pull Request 合回；包含版本提升的 `develop` 合并到
`main` 时自动创建正式版本。默认分支定时工作流等控制面维护使用路径受限的 `ci/*` Pull Request，
不触发正式发布。分支、Issue、Pull Request、发布和文档治理规则见
[`CONTRIBUTING.md`](CONTRIBUTING.md)。仓库默认展示稳定的 `main`；提交普通贡献时，请在 GitHub
上将 Pull Request 的目标分支改为 `develop`。领域术语和已经生效的架构约束保留在
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，完整决策依据与历史由维护者的 Trilium 知识库维护。

## 已知限制

- Windows、Arch 和 AppImage 发布物及应用可执行文件未签名，应用图标仍使用 Electron 默认图标。
- 普通 Windows CI 只执行确定性的 Electron Shell Smoke；触及打包面的 PR、Nightly 和 Release
  还由 `package-desktop.yml` 执行 NSIS、shortcut、CLI/TUI、安装/卸载和用户数据保留验收，但不
  代替完整 Electron E2E 或额外的真实净机/人工桌面证据。
- AppImage 只执行结构与启动 Smoke，不构成其他 Linux 发行版兼容承诺；Arch 容器生命周期与
  本机 niri 桌面证据仍按发布门禁分别记录。
- Arch 是滚动发行版，正式支持以发布说明记录的快照日期为验收基线，不承诺未来系统更新永不
  影响已发布版本。
- Chat Completions 和 Responses 均由本地确定性 OpenAI 兼容端点覆盖。尚未用真实第三方
  API Key 验证任何外部服务商。
- 正式支持仅覆盖 Windows 11 x64 与原生 Arch Linux x64/niri；持久化格式尚未形成跨版本兼容
  承诺。
- 当前锁定的 Pi `0.84.1` 将 `InteractiveMode` 的 terminal 创建和 `process.exit()` 保留在
  Pi 内部，且包根未导出 `createInteractiveTui`；生产 TUI 已通过公开 `InteractiveMode` 和
  `AgentSessionRuntime` runner 运行，Host/Plugin/锁清理由 Pictor seam 覆盖。要让 Host 完全
  接管同一个 terminal、SIGINT 和异步退出清理，仍需要一个窄的上游 terminal/exit 注入适配，
  不能用私有字段或复制 Renderer 绕过。
- 同一版本的 `InteractiveMode` 构造器还会覆盖 `AgentSessionRuntime` 的单一 rebind callback；
  TUI adapter 会在底层方法调用前拒绝 `/new`、`/fork`、`/clone`、`/resume` 和 `/import`，避免
  Session identity 失配。完整 replacement transaction 路由需要独立的上游 public composition seam。

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

TUI 与 GUI/CLI 使用同一个 user-data/profile 锁和 `data-v1`。TUI Plugin 只能通过公开的
`TuiApplicationContribution`、`AgentWorkspaceClient`、`CommandClient` 和 Runtime interactive
runner seam 访问应用能力；Pi JSONL 仍是唯一会话历史来源。

Renderer 启用 Chromium sandbox、context isolation 和限制性 CSP，不开放 Node 或原始
Electron API。Pi Runtime Plugin 从用户 Store 动态加载到独立 utility process，直接交给 Pi
ResourceLoader、ExtensionRunner 和原生工具注册表；删除或禁用该 Plugin 后，项目与历史仍可查看，
但不能启动新 Run。Pi Extension 和 Pi 原生工具以当前用户权限运行，安装或信任项目之前必须确认
来源。Pictor 的模型 API Key 不进入 Extension 配置、Runtime event 或 Pi JSONL。受信任 Project 的
`.pi/extensions`、Skills 和 Prompt Templates 由 Pi 原生资源解析器自动加载，Session Controls 只
管理 Pi 暴露的模型、Thinking、工具和队列偏好。

更新检查只在用户点击“检查更新”后由 Main Process 请求 Pictor 官方 GitHub Release API；
应用不会在后台轮询。稳定通道查询 Latest Release，并按 SemVer 判断；用户显式选择的 Nightly
通道查询滚动的 `nightly` Pre-release，并用打包时嵌入的源码提交判断快照是否变化。通道选择保存在
Updater Plugin 的独立数据目录，默认仍为稳定版。Linux 只在本机读取 `/etc/os-release` 识别原生
Arch，不上传或记录该文件。Arch 下载按钮优先打开匹配的官方 Pacman 资产，其他 Linux 只打开匹配
版本和架构的官方 AppImage；没有匹配资产时回退到对应官方发布页。

Pictor 不为 Pi 工具增加第二套项目路径守卫或命令审批；项目根目录作为 Pi Session 的工作目录，
文件与 Shell 操作遵循 Pi 和当前操作系统的权限语义。需要更强隔离时，应使用操作系统或容器提供
的隔离能力。

当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。
