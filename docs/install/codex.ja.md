# Codex にインストールする

[한국어](codex.md) · [English](codex.en.md) · **日本語** · [简体中文](codex.zh.md)

確認日 2026-11-10。出典: [Codex MCP ドキュメント](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (旧アドレス developers.openai.com/codex/mcp はここに転送されます)。

## 1. MCP サーバーを登録する

CLI で登録します (公式ドキュメントの形式は `codex mcp add <名前> -- <実行コマンド>`)。

```bash
codex mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.1
codex mcp list
```

`~/.codex/config.toml` に直接書くこともできます。

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.1"]
```

Codex の中で `/mcp` と入力すると、登録済みのサーバーが見えます。

## 2. スキルをコピーする

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

コピーしたら Codex を再起動します。

## 確認状況

| 項目 | 状況 |
|---|---|
| `codex mcp add` と `config.toml` の `[mcp_servers.<名前>]` | 公式ドキュメントで確認済み |
| `~/.agents/skills/` からのスキル読み込み | unverified (今回は公式ドキュメントで再確認できていません) |

最初の接続は [README の初回起動](../../README.ja.md#first-run) を見てください。
