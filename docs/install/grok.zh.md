# 在 Grok Build 中安装

[한국어](grok.md) · [English](grok.en.md) · [日本語](grok.ja.md) · **简体中文**

确认日期 2026-11-10。来源: [Grok Build MCP Servers 文档](https://docs.x.ai/build/features/mcp-servers)。

## 1. 注册 MCP 服务器

用 CLI 注册。`--` 后面是服务器的启动命令。

```bash
grok mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.2
grok mcp doctor
```

也可以直接写进 `~/.grok/config.toml`。

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.2"]
```

在仓库里加 `--scope project` 会保存到 `.grok/config.toml`。文档说明 Grok Build 还会读取 `~/.claude.json`、`.cursor/mcp.json` 和项目里的 `.mcp.json`,所以在 clone 了本仓库的文件夹里,自带的 `.mcp.json` 可能会直接生效。用 `grok inspect` 查看每个服务器是从哪里加载的。

## 2. 复制技能

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

如果 `~/.agents/skills/` 没有被读取,请改为复制到 `~/.grok/skills/`。

## 验证状态

| 项目 | 状态 |
|---|---|
| `grok mcp add`、`[mcp_servers.<名称>]`、读取 `.mcp.json` | 已对照官方文档确认 |
| 从 `~/.grok/skills/` 读取技能 | unverified (只在第三方文章中看到) |
| 从 `~/.agents/skills/` 读取技能 | unverified (只在一篇第三方文章中看到) |

第一次连接请看 [README 的首次运行](../../README.zh.md#first-run)。
