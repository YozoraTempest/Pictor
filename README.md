# Pictor

Pictor 是一个面向 Agent 委托工作流的 Windows 桌面开发环境。当前 MVP 提供本地项目、
持久化 Session、Pi Agent 流式对话、项目文件操作、逐条命令审批和单个模型 API 配置。

## 当前能力

- 添加、移除和重新关联本地项目，项目路径经过规范化后作为访问边界；
- 创建、切换、重命名和删除 Session，重启后保留消息、运行与工具记录；
- 通过 `@earendil-works/pi-coding-agent` 接入支持流式文本和工具调用的模型端点；
- 列出、搜索、读取、创建、编辑、移动和删除项目内文件；
- 在显示完整命令、工作目录和用途后，允许一次或拒绝 Git Bash 命令；
- 展示 Markdown 回复、工具状态、命令输出、错误、停止和中断状态；
- 配置 Chat Completions 或 Responses 兼容模式、API Base URL、模型标识、API Key、模型
  推理强度、温度和最大输出 Token 数；支持从兼容的 `/models` 端点获取并选择模型；
- 在设置的“关于”页查看版本，并按需检查 GitHub Release；有新版本时可下载官方 Windows
  x64 安装包，发布未附带安装包时则打开对应发布页。

首期全局同时只运行一个 Agent。编辑器、Git 工作流、多 Agent、插件、远程项目、WSL、
容器以及 macOS/Linux 打包不在当前范围内。

## 环境要求

- Windows 11 x64；
- Node.js 22.22.2 或更新版本；
- Git for Windows，命令执行依赖其中的 Git Bash；
- 一个兼容 OpenAI Chat Completions 或 Responses、SSE 流式响应和函数工具调用的模型端点。

## 安装与卸载

0.1.3 提供 Windows x64 NSIS 安装程序：`Pictor-0.1.3-windows-x64-setup.exe`。运行安装程序，
按向导选择安装位置即可；安装程序会创建桌面和开始菜单快捷方式。安装完成后可从任一快捷
方式启动 Pictor。

要卸载，请在 Windows 的“已安装的应用”中选择 Pictor 并执行卸载，或运行安装目录中的
卸载程序。RC1 验收已覆盖静默安装、安装后启动和静默卸载：卸载后测试安装目录、测试创建
的桌面/开始菜单快捷方式和卸载注册表项均已移除。该验证使用隔离的临时安装位置和用户数据；
它不是净机测试。

当前发布的安装程序和解包的 `Pictor.exe` 均未进行 Authenticode 签名。请只从可信发布
渠道获取安装程序，并在组织安全策略要求签名时暂缓部署。

## 本地运行

```powershell
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

```powershell
npm run verify:fast
npm run verify:pr
```

发布前运行 `npm run verify:release`。完整的测试分层、叶子命令、CI 门禁和稳定性规则见
[`docs/TESTING.md`](docs/TESTING.md)。

应用源码统一位于 `src/`，并按 Electron Main、Preload、Renderer、Agent Runtime 和共享协议
划分。目录职责、跨进程协议和允许依赖方向见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

日常开发从 `develop` 创建短期分支并通过 Pull Request 合回；`develop` 合并到 `main` 时自动
创建正式版本。分支、Issue、Pull Request 和发布规则见
[`CONTRIBUTING.md`](CONTRIBUTING.md) 和
[`docs/PROJECT_MANAGEMENT.md`](docs/PROJECT_MANAGEMENT.md)。仓库默认展示稳定的 `main`；提交
普通贡献时，请在 GitHub 上将 Pull Request 的目标分支改为 `develop`。

项目领域术语见 [`CONTEXT.md`](CONTEXT.md)，已接受的架构决策见 [`docs/adr/`](docs/adr/)。

`npm run package:dir` 生成 `dist/win-unpacked/Pictor.exe`。`npm run package` 同时生成
`dist/Pictor-<version>-windows-x64-setup.exe` NSIS 安装程序和 `dist/win-unpacked/`，随后自动
校验安装程序、应用归档以及解包可执行文件的 x64 PE 架构；也可以对已有产物单独运行
`npm run package:verify`。它验证文件存在、非空和解包可执行文件的 x64 PE 架构，不验证
签名、安装生命周期或外部服务商兼容性。Electron E2E 使用本地确定性
OpenAI 兼容服务验证完整 GUI、真实 Pi SDK、utility process、命令审批、取消、凭据重启、
活动运行关闭确认和中断恢复，不需要外部模型凭据。E2E 默认隐藏 Electron 窗口并在后台
运行，不影响截图和交互验证。

## 已知限制

- 0.1.3 的 Windows 安装程序和应用可执行文件未签名；应用图标仍使用 Electron 默认图标。
- 已完成的 Windows RC1 安装、启动和卸载验收运行在非净 Windows 开发机上，虽然安装位置和
  首次运行数据均已隔离并在验收后清理；尚未取得净机安装证据。
- Chat Completions 和 Responses 均由本地确定性 OpenAI 兼容端点覆盖。尚未用真实第三方
  API Key 验证任何外部服务商。
- 首期只支持 Windows x64；编辑器、Git 工作流、多 Agent、插件、远程项目、WSL、容器以及
  macOS/Linux 打包不在范围内。持久化格式也尚未形成跨版本兼容承诺。

## 本地数据与安全边界

Pictor 将版本化状态写入 Electron `userData/data-v1`。普通设置保存在 `state.json`，每个
Session 独立保存在 `sessions/`，Pi 私有会话位于 `pi/`。API Key 明文保存在独立的
`auth.json`，依靠当前用户的数据目录和文件权限保护；它不会返回 Renderer，也不会写入项目
或 Session 数据。不要共享该文件或整个用户数据目录。

Renderer 启用 Chromium sandbox、context isolation 和限制性 CSP，不开放 Node 或原始
Electron API。Pi 运行在独立 utility process 中，内置工具和项目扩展均被禁用，只能调用
Pictor 提供且经过路径守卫的工具。

更新检查只在用户点击“检查更新”后由 Main Process 请求 Pictor 官方 GitHub Release API；
应用不会在后台轮询。下载按钮只允许打开官方仓库的 HTTPS 安装包或发布页。

项目文件操作限定在解析后的项目根目录内，并拒绝父目录跳转、符号链接和目录联接逃逸。
命令审批是明确的用户授权边界，不是操作系统沙箱：获批命令仍以当前 Windows 用户权限运行。
每条命令最多执行十分钟，停止或超时会终止其 Windows 进程树。

当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。
