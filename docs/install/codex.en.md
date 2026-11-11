# Install on Codex

[한국어](codex.md) · **English** · [日本語](codex.ja.md) · [简体中文](codex.zh.md)

Checked 2026-11-10. Source: [Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (the old address developers.openai.com/codex/mcp redirects here).

## 1. Register the MCP server

Use the CLI (the documented form is `codex mcp add <name> -- <command>`).

```bash
codex mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.2
codex mcp list
```

Or write it into `~/.codex/config.toml`.

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.2"]
```

Type `/mcp` inside Codex to see the active servers.

## 2. Copy the skills

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

Restart Codex afterwards.

## Verification status

| Item | Status |
|---|---|
| `codex mcp add` and `[mcp_servers.<name>]` in `config.toml` | verified against the official docs |
| Reading skills from `~/.agents/skills/` | unverified (not re-checked against the official docs this time) |

For the first connection, see [First run in the README](../../README.en.md#first-run).
