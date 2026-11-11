# 在 Codex 中安装

[한국어](codex.md) · [English](codex.en.md) · [日本語](codex.ja.md) · **简体中文**

确认日期 2026-11-10。来源: [Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (旧地址 developers.openai.com/codex/mcp 会跳转到这里)。

## 1. 注册 MCP 服务器

用 CLI 注册 (官方文档的格式是 `codex mcp add <名称> -- <启动命令>`)。

```bash
codex mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.1
codex mcp list
```

也可以直接写进 `~/.codex/config.toml`。

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.1"]
```

在 Codex 里输入 `/mcp` 就能看到已启用的服务器。

## 2. 复制技能

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

复制后重启 Codex。

## 验证状态

| 项目 | 状态 |
|---|---|
| `codex mcp add` 和 `config.toml` 中的 `[mcp_servers.<名称>]` | 已对照官方文档确认 |
| 从 `~/.agents/skills/` 读取技能 | unverified (这次没有再对照官方文档确认) |

第一次连接请看 [README 的首次运行](../../README.zh.md#first-run)。
