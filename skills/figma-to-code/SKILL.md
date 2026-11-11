---
name: figma-to-code
description: Figma 에서 선택한 프레임을 프로젝트 코드로 옮긴다. "이 프레임 코드로 옮겨줘", "선택한 화면 React 로 만들어줘", "Figma 디자인을 컴포넌트로 구현해줘" 같은 요청에 쓴다. 변수 이름을 프로젝트 토큰에, Figma 컴포넌트와 속성을 기존 코드 컴포넌트와 props 에 대응시킨다. Use to convert a selected Figma frame to code (convert this Figma frame to React) using the figma-starter MCP tools and the project's existing tokens and components.
---

# Figma 에서 코드로 (figma-to-code)

사용자의 언어로 답한다. 판단이 안 되면 한국어. 세션 첫 응답의 인사와 스타 부탁은 [../figma-build/SKILL.md](../figma-build/SKILL.md) 의 "시작할 때" 를 따른다 (한 세션에 한 번). 디자인 쪽 규칙은 [../figma-build/references/rules.md](../figma-build/references/rules.md) 를 따른다 (여기에 복사하지 않는다).

## 순서

1. **연결 확인**: `status`. 연결 안 됐으면 Figma 데스크톱 앱에서 Plugins > Development > figma-starter 를 실행하고 `status` 가 준 코드를 입력하게 안내한다. 코드가 없으면 `renewPairingCode: true`. 처음이면 `npx -y github:java-jaydev/figma-starter-mcp#v0.1.2 plugin-path` 의 manifest 를 Import plugin from manifest 로 불러오게 한다.
2. **선택 노드 읽기**: `read_selection` (깊거나 크면 생략된 노드 수가 보고되니 `read_nodes` 로 해당 id 를 더 읽는다). 구조, 오토 레이아웃, 변수 바인딩, 컴포넌트 인스턴스와 속성을 얻는다. 공식 Figma MCP 서버는 월 호출 한도 때문에 읽기에 제안하지 않는다.
3. **프로젝트 코드 조사**: 코드를 쓰기 전에 저장소에서 토큰 파일(CSS 변수, 테마, tailwind 설정, tokens.ts 등)과 기존 컴포넌트를 먼저 찾는다. 프레임워크와 스타일 방식도 여기서 확인한다.
4. **대응표 만들기**:
   - 변수: `color/bg/default` 같은 `var` 이름을 프로젝트 토큰으로 (`--color-bg-default`, `tokens.color.bg.default`). 테마는 Starter 의 `Color / Light`, `Color / Dark` 컬렉션(같은 이름 변수)과 유료 플랜의 모드 둘 다 같은 토큰으로 본다. `list_variables` 로 확인한다.
   - 컴포넌트: Figma 컴포넌트 이름과 camelCase 속성을 기존 코드 컴포넌트와 props 에 (`list_components`). variant 값은 코드의 유니언 값과 같다고 본다.
   - 레이아웃: 오토 레이아웃은 flex (방향, gap, padding, 정렬, FILL/HUG/FIXED).
5. **코드 작성**: 대응된 토큰과 컴포넌트를 쓴다. 대응이 있는데 새 값이나 새 컴포넌트를 만들지 않는다. 필요하면 `export_node` 로 PNG 를 받아 결과와 눈으로 비교한다.
6. **보고**: 대응 안 되는 것을 목록으로 알린다 (코드에 없는 토큰, 코드에 없는 컴포넌트, `{raw}` 예외로 남은 하드코딩 값, 생략된 노드). 임의로 만들어 채우지 않고, 추가할지 사용자에게 묻는다.
