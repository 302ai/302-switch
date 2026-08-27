<div align="center">

# 302 Switch

### Provider switcher for Claude Code, Claude Desktop, Codex, Gemini CLI, OpenCode, OpenClaw & Hermes Agent — the [302.AI](https://302.ai) edition

English | [中文](README_ZH.md) | [Changelog](CHANGELOG.md)

</div>

302 Switch is built on [cc-switch](https://github.com/farion1231/cc-switch) (MIT), the excellent open-source provider switcher. It's the same full-featured app, **pre-configured for 302.AI users**: instead of a blank slate, you get 302.AI as a built-in provider for every supported tool, plus the official endpoints. No hunting for API base URLs, no guessing at config formats — paste your 302.AI key, pick a tool, and you're connected. Newcomer-friendly by default, fully open to custom providers if you need them.

## Download

Grab the installer for your platform from the [latest release](https://github.com/WanjiaRuan/302-cc-switch/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `302-CC-Switch_..._macOS_Apple-Silicon.dmg` |
| macOS (Intel) | `302-CC-Switch_..._macOS_Intel.dmg` |
| Windows (x64) | `302-CC-Switch_..._Windows_x64_Setup.exe` |

Older versions and release notes live on the [Releases page](https://github.com/WanjiaRuan/302-cc-switch/releases).

> **macOS Gatekeeper**: the app is not signed with an Apple Developer certificate yet. On first launch, right-click the app → **Open** → **Open** to bypass the "unidentified developer" warning. You only need to do this once.

## What we added for 302.AI users

- **302.AI built in, ready out of the box** — pre-configured for all 7 supported tools
  - Anthropic-compatible endpoint: `https://api.302.ai` (Claude Code, Claude Desktop, OpenClaw, OpenCode)
  - OpenAI-compatible endpoint: `https://api.302.ai/v1` (Codex, Hermes)
  - Mainland China node `https://api.302ai.cn` available for speed-optimized switching
- **A curated starting list** — official endpoints + 302.AI, no third-party clutter to confuse first-time users (you can always add any provider back manually)
- **Auto-updates** delivered through this repository's releases

Get an API key from the [302.AI dashboard](https://dash.302.ai) — it starts with `sk-`.

## Features

Everything from upstream cc-switch v3.16.x:

- **Provider management** — One-click switching across 7 tools, universal providers that sync one config to Claude Code / Codex / Gemini CLI, system tray quick access, import/export
- **Proxy & failover** — Local proxy with hot-switching, format conversion, auto-failover, circuit breaker, health monitoring
- **MCP, prompts & skills** — Unified MCP panel with bidirectional sync, Markdown prompt editor (CLAUDE.md / AGENTS.md / GEMINI.md), one-click skill install from GitHub/ZIP
- **Usage & cost tracking** — Spending, requests, and token dashboards with per-model pricing
- **Session manager & workspace** — Browse and restore conversation history; OpenClaw agent-file editor
- **System** — Cloud sync (custom config dir + WebDAV), deep links (`ccswitch302://`), dark/light theme, auto-launch, auto-updater, i18n (zh / zh-TW / en / ja)

## Development

Requirements: Node.js 20+, pnpm, Rust stable (Tauri 2).

```bash
pnpm install        # install dependencies
pnpm dev            # dev mode with hot reload
pnpm typecheck      # TypeScript check
pnpm test:unit      # unit tests
pnpm build          # production build
```

## Credits & License

Forked from [farion1231/cc-switch](https://github.com/farion1231/cc-switch) by Jason Young. Licensed under the [MIT License](LICENSE).
