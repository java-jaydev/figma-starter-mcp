# Codex 에 설치하기

**한국어** · [English](codex.en.md) · [日本語](codex.ja.md) · [简体中文](codex.zh.md)

확인일 2026-11-10. 출처: [Codex MCP 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (옛 주소 developers.openai.com/codex/mcp 가 여기로 넘어갑니다).

## 1. MCP 서버 등록

CLI 로 등록합니다 (공식 문서의 `codex mcp add <이름> -- <실행 명령>` 형태).

```bash
codex mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.1
codex mcp list
```

또는 `~/.codex/config.toml` 에 직접 적습니다.

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.1"]
```

Codex 안에서 `/mcp` 를 입력하면 등록된 서버가 보입니다.

## 2. 스킬 복사

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

복사 후 Codex 를 다시 시작합니다.

## 확인 상태

| 항목 | 상태 |
|---|---|
| `codex mcp add`, `config.toml` 의 `[mcp_servers.<이름>]` | 공식 문서로 확인 |
| `~/.agents/skills/` 에서 스킬 읽기 | unverified (이번에 공식 문서를 다시 확인하지 못했습니다) |

처음 연결하는 방법은 [README 의 첫 실행](../../README.md#first-run) 을 보세요.
