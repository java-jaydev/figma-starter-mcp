# Install on Grok Build

[한국어](grok.md) · **English** · [日本語](grok.ja.md) · [简体中文](grok.zh.md)

Checked 2026-11-10. Source: [Grok Build MCP Servers docs](https://docs.x.ai/build/features/mcp-servers).

## 1. Register the MCP server

Use the CLI. Everything after `--` is the server command.

```bash
grok mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.2
grok mcp doctor
```

Or write it into `~/.grok/config.toml`.

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.2"]
```

Inside a repo, `--scope project` saves it to `.grok/config.toml`. The docs say Grok Build also reads `~/.claude.json`, `.cursor/mcp.json` and a project `.mcp.json`, so in a clone of this repo the bundled `.mcp.json` may be picked up as is. Run `grok inspect` to see where each server was loaded from.

## 2. Copy the skills

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

If `~/.agents/skills/` is not read, copy to `~/.grok/skills/` instead.

## Verification status

| Item | Status |
|---|---|
| `grok mcp add`, `[mcp_servers.<name>]`, reading `.mcp.json` | verified against the official docs |
| Reading skills from `~/.grok/skills/` | unverified (seen only in third-party articles) |
| Reading skills from `~/.agents/skills/` | unverified (seen in a single third-party article) |

For the first connection, see [First run in the README](../../README.en.md#first-run).
