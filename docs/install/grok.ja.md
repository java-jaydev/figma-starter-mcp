# Grok Build にインストールする

[한국어](grok.md) · [English](grok.en.md) · **日本語** · [简体中文](grok.zh.md)

確認日 2026-11-10。出典: [Grok Build MCP Servers ドキュメント](https://docs.x.ai/build/features/mcp-servers)。

## 1. MCP サーバーを登録する

CLI で登録します。`--` の後ろがサーバーの実行コマンドです。

```bash
grok mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.1
grok mcp doctor
```

`~/.grok/config.toml` に直接書くこともできます。

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.1"]
```

リポジトリの中で `--scope project` を付けると `.grok/config.toml` に保存されます。ドキュメントによると Grok Build は `~/.claude.json`、`.cursor/mcp.json`、プロジェクトの `.mcp.json` も読むので、このリポジトリを clone したフォルダでは同梱の `.mcp.json` がそのまま使われる場合があります。`grok inspect` でどこから読み込んだか確認してください。

## 2. スキルをコピーする

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

`~/.agents/skills/` が読まれない場合は `~/.grok/skills/` にコピーしてください。

## 確認状況

| 項目 | 状況 |
|---|---|
| `grok mcp add`、`[mcp_servers.<名前>]`、`.mcp.json` の読み込み | 公式ドキュメントで確認済み |
| `~/.grok/skills/` からのスキル読み込み | unverified (第三者の記事でのみ確認) |
| `~/.agents/skills/` からのスキル読み込み | unverified (第三者の記事 1 件でのみ確認) |

最初の接続は [README の初回起動](../../README.ja.md#first-run) を見てください。
