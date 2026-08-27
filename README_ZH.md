<div align="center">

# 302 Switch

### Claude Code / Claude Desktop / Codex / Gemini CLI / OpenCode / OpenClaw / Hermes Agent 供应商切换器 — [302.AI](https://302.ai) 版

[English](README.md) | 中文 | [更新日志](CHANGELOG.md)

</div>

302 Switch 基于优秀的开源项目 [cc-switch](https://github.com/farion1231/cc-switch)（MIT）构建。功能与原版完全一致，但**为 302.AI 用户预先配置好了一切**：不用面对空白配置页，302.AI 已作为内置供应商覆盖所有支持的工具，官方端点也一并保留。不用查 API 地址、不用猜配置格式——填入 302.AI Key，选择工具，即刻连通。对新手默认友好，需要自定义供应商也完全开放。

## 下载

从 [最新 Release](https://github.com/302ai/302-switch/releases/latest) 下载对应平台的安装包：

| 平台 | 文件 |
|---|---|
| macOS（Apple 芯片 & Intel，通用包） | `302-Switch_..._macOS.dmg` |
| Windows（x64 / ARM64） | `302-Switch_..._Windows.msi` / `302-Switch_..._Windows-arm64.msi`（另有免安装 `.zip`） |
| Linux（x64 / ARM64） | `302-Switch_..._Linux-{x86_64,arm64}.deb` / `.rpm` / `.AppImage` |

历史版本和更新说明见 [Releases 页面](https://github.com/302ai/302-switch/releases)。

> **macOS**：安装包已使用 Apple 开发者证书签名并公证，直接安装即可；应用内置自动更新（Tauri updater，更新包同样带签名校验）。

## 我们为 302.AI 用户加了什么

- **302.AI 内置，开箱即用** — 全部 7 个工具预先配置完成
  - Anthropic 兼容端点：`https://api.302.ai`（Claude Code、Claude Desktop、OpenClaw、OpenCode）
  - OpenAI 兼容端点：`https://api.302.ai/v1`（Codex、Hermes）
  - 国内节点 `https://api.302ai.cn` 可测速切换，速度更优
- **一份干净的起点清单** — 官方端点 + 302.AI，没有第三方预设干扰新手（随时可以手动加回任何供应商）
- **自动更新** — 通过本仓库 Releases 推送

API Key 在 [302.AI 管理后台](https://dash.302.ai) 获取，以 `sk-` 开头。

## 功能

与上游 cc-switch v3.16.x 完全一致：

- **供应商管理** — 7 个工具一键切换、统一供应商（一份配置同步 Claude Code / Codex / Gemini CLI）、托盘快捷切换、导入导出
- **代理与容灾** — 本地代理热切换、格式转换、自动故障转移、熔断器、健康监测
- **MCP / 提示词 / Skills** — 统一 MCP 面板双向同步、Markdown 提示词编辑（CLAUDE.md / AGENTS.md / GEMINI.md）、GitHub/ZIP 一键安装 Skills
- **用量与成本** — 花费、请求数、token 仪表盘，支持按模型自定义价格
- **会话管理与工作区** — 浏览恢复历史会话；OpenClaw agent 文件编辑器
- **系统** — 云同步（自定义配置目录 + WebDAV）、深链接（`ccswitch302://`）、深色/浅色主题、开机自启、自动更新、多语言（zh / zh-TW / en / ja）

## 开发

环境要求：Node.js 20+、pnpm、Rust stable（Tauri 2）。

```bash
pnpm install        # 安装依赖
pnpm dev            # 热重载开发模式
pnpm typecheck      # TypeScript 检查
pnpm test:unit      # 单元测试
pnpm build          # 生产构建
```

## 致谢与许可

Fork 自 Jason Young 的 [farion1231/cc-switch](https://github.com/farion1231/cc-switch)，遵循 [MIT 许可证](LICENSE)。
