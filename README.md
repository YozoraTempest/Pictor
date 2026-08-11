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
  推理强度、温度和最大输出 Token 数；支持从兼容的 `/models` 端点获取并选择模型。

首期全局同时只运行一个 Agent。编辑器、Git 工作流、多 Agent、插件、远程项目、WSL、
容器以及 macOS/Linux 打包不在当前范围内。

## 环境要求

- Windows 11 x64；
- Node.js 22 或更新版本；
- Git for Windows，命令执行依赖其中的 Git Bash；
- 一个兼容 OpenAI Chat Completions 或 Responses、SSE 流式响应和函数工具调用的模型端点。

## 本地运行

```powershell
npm ci
npm run dev
```

首次启动后，在“模型设置”中选择兼容模式并保存 API Base URL、模型标识和 API Key，再
添加本地项目并创建 Session。API Base URL 应填写 API 根地址（例如
`https://api.example.com/v1`）；Pictor 会按兼容模式追加 `/chat/completions` 或
`/responses`，并从 `/models` 获取模型列表。远程端点必须使用 HTTPS；本机回环地址可以
使用 HTTP。连接测试会解析实际 SSE 事件并强制执行一次无副作用函数调用，用于验证端点
同时支持所选协议、流式响应和工具调用。

## 验证

以下命令已在 Windows 11 上验证：

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run package:dir
npm run package
```

`npm run package:dir` 生成 `dist/win-unpacked/Pictor.exe`。`npm run package` 同时生成
`dist/Pictor-<version>-windows-x64-setup.exe` NSIS 安装程序和 `dist/win-unpacked/`，随后自动
校验安装程序、应用归档以及解包可执行文件的 x64 PE 架构；也可以对已有产物单独运行
`npm run package:verify`。Electron E2E 使用本地确定性
OpenAI 兼容服务验证完整 GUI、真实 Pi SDK、utility process、命令审批、取消、凭据重启、
活动运行关闭确认和中断恢复，不需要外部模型凭据。E2E 默认隐藏 Electron 窗口并在后台
运行，不影响截图和交互验证。

## 本地数据与安全边界

Pictor 将版本化状态写入 Electron `userData/data-v1`。普通设置保存在 `state.json`，每个
Session 独立保存在 `sessions/`，Pi 私有会话位于 `pi/`。API Key 只以 Electron
`safeStorage` 生成的 Windows DPAPI 密文保存在 `secrets.json`，不会返回 Renderer，也不会
写入项目或 Session 数据。

Renderer 启用 Chromium sandbox、context isolation 和限制性 CSP，不开放 Node 或原始
Electron API。Pi 运行在独立 utility process 中，内置工具和项目扩展均被禁用，只能调用
Pictor 提供且经过路径守卫的工具。

项目文件操作限定在解析后的项目根目录内，并拒绝父目录跳转、符号链接和目录联接逃逸。
命令审批是明确的用户授权边界，不是操作系统沙箱：获批命令仍以当前 Windows 用户权限运行。
每条命令最多执行十分钟，停止或超时会终止其 Windows 进程树。

当前持久化格式仍处于 MVP 阶段，尚未形成跨版本兼容承诺。
