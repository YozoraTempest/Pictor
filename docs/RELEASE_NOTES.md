# 发布说明

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
