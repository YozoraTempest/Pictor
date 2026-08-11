# 发布说明

## 0.1.0 - 2026-08-11

Pictor 0.1.0 是 Windows x64 MVP。它提供本地项目和持久化 Session、Pi Agent 流式委托、
项目内文件操作、逐条 Git Bash 命令审批，以及模型设置。模型设置支持 OpenAI 兼容的 Chat
Completions 与 Responses、`/models` 模型发现和可选推理强度。发布物为 NSIS 安装程序和
解包应用；验收已验证 x64 产物、静默安装、安装后启动和静默卸载。

验收还通过了格式检查、完整构建、64 个单元/集成测试和 6 个隐藏 Electron E2E 测试。E2E
使用本地确定性 OpenAI 兼容服务，并未使用真实第三方 API Key。

### 已知风险

- 安装程序和 `Pictor.exe` 未经 Authenticode 签名，且仍使用 Electron 默认应用图标。
- 安装和卸载验证在非净 Windows 开发机上完成，尽管验收使用了隔离安装位置和用户数据并在
  完成后清理；没有净机安装证据。
- 尚未针对任意外部凭据型 OpenAI 兼容服务商完成端到端验证；服务商对协议、模型发现和推理
  强度的支持可能不同。
- 当前仅支持 Windows x64，持久化数据格式仍是 MVP，未承诺跨版本兼容性。
