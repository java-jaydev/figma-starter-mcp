# AGENTS.md

Figma 무료(Starter) 플랜에서 AI 에이전트가 Figma 를 다루게 하는 로컬 MCP 브리지(figma-starter-mcp). 기존 강의 자료는 `docs/workshop/` 에 남아 있다.

## 구조

- 프로젝트 이름은 `figma-starter-mcp`. Node 서버와 Figma 개발용 플러그인이 localhost WebSocket 으로 연결되는 MCP 브리지다. 설계는 `docs/superpowers/specs/`, 계획은 `docs/superpowers/plans/`.
- `src/server/` MCP 서버, `src/plugin/` Figma 플러그인(esbuild 로 `dist/plugin/code.js` 번들), `src/shared/` 둘이 공유하는 프로토콜과 규칙.
- `skills/figma-build/` 에이전트용 스킬(한국어만). 한도 숫자는 `skills/figma-build/references/limits-and-sources.md` 에만 적고, 다른 문서는 그 파일을 가리킨다. 값을 고치면 확인일과 출처도 함께 고친다.
- `docs/workshop/` 기존 강의 자료(`<lang>/course-outline.md`, `labs.md`)와 실습용 `token-plugin/`.
- `skills/figma-to-code/` Figma 에서 코드로 옮기는 스킬.
- 배포 설정: `.claude-plugin/`(마켓플레이스 `figma-starter-mcp`, 플러그인 `figma-starter`), `.mcp.json`, `gemini-extension.json`. `.mcp.json` 과 `gemini-extension.json` 의 MCP 명령은 같아야 한다(`tests/repo.test.ts` 가 검사).
- `docs/install/` Codex, Grok Build 설치 안내(ko/en/ja/zh). `README.md`(ko 원본), `README.en.md`, `README.ja.md`, `README.zh.md` 는 같은 앵커와 구조를 유지한다.

## 명령

- 테스트: `npm test` (vitest 로 `tests/**/*.test.ts`).
- 타입 검사: `npm run typecheck`.
- 빌드: `npm run build` (`tsc` 로 `dist/server`, `dist/shared` 생성 후 플러그인 번들).

## Git

| | |
|---|---|
| 원격 | `java-jaydev/figma-starter-mcp` |
| gh 계정 | `java-jaydev` |

원격 작업 전 `gh auth status` 로 활성 계정 확인. 다르면 `gh auth switch --user java-jaydev`.

## 규칙

- em dash, en dash 를 쓰지 않는다. 하이픈(-)만 쓴다.
- 이메일, 계정 같은 개인 정보를 자료에 넣지 않는다.
- main 에 직접 커밋하지 않는다. 브랜치를 만들고 PR 로 합친다.
- 코드를 고치면 `npm test` 가 통과해야 한다.
