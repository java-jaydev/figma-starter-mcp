# Grok Build 에 설치하기

**한국어** · [English](grok.en.md) · [日本語](grok.ja.md) · [简体中文](grok.zh.md)

확인일 2026-11-10. 출처: [Grok Build MCP Servers 문서](https://docs.x.ai/build/features/mcp-servers).

## 1. MCP 서버 등록

CLI 로 등록합니다. `--` 뒤가 서버 실행 명령입니다.

```bash
grok mcp add figma-starter -- npx -y github:java-jaydev/figma-starter-mcp#v0.1.0
grok mcp doctor
```

또는 `~/.grok/config.toml` 에 직접 적습니다.

```toml
[mcp_servers.figma-starter]
command = "npx"
args = ["-y", "github:java-jaydev/figma-starter-mcp#v0.1.0"]
```

레포 안에서 `--scope project` 를 붙이면 `.grok/config.toml` 에 저장됩니다. Grok Build 는 `~/.claude.json`, `.cursor/mcp.json`, 프로젝트의 `.mcp.json` 도 함께 읽는다고 문서에 나와 있어서, 이 레포를 clone 한 폴더에서는 `.mcp.json` 이 그대로 쓰일 수 있습니다. `grok inspect` 로 어디서 읽었는지 확인하세요.

## 2. 스킬 복사

```bash
git clone https://github.com/java-jaydev/figma-starter-mcp.git
mkdir -p ~/.agents/skills
cp -R figma-starter-mcp/skills/* ~/.agents/skills/
```

`~/.agents/skills/` 가 안 읽히면 `~/.grok/skills/` 에 복사하세요.

## 확인 상태

| 항목 | 상태 |
|---|---|
| `grok mcp add`, `[mcp_servers.<이름>]`, `.mcp.json` 읽기 | 공식 문서로 확인 |
| `~/.grok/skills/` 에서 스킬 읽기 | unverified (제3자 글에서만 봤습니다) |
| `~/.agents/skills/` 에서 스킬 읽기 | unverified (제3자 글 한 곳에서만 봤습니다) |

처음 연결하는 방법은 [README 의 첫 실행](../../README.md#first-run) 을 보세요.
