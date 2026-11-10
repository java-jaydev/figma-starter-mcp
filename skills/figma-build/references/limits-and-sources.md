# Figma 무료(Starter) 플랜 한도와 출처

확인일: 2026-11-10. Figma 는 한도를 수시로 바꾼다. 강의 전에 아래 링크를 다시 열어 값을 확인하고, 바뀌었으면 이 표와 확인일을 고친다.

| 항목 | Starter 값 | 강의에서의 우회법 | 출처 |
|---|---|---|---|
| 파일 수 | 팀 1개, 폴더 1개, 디자인 파일 3개 | 디자인 시스템은 파일 하나에 모은다 | [Compare Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features) |
| 파일당 페이지 | 디자인 파일 3페이지 (FigJam 1페이지) | 페이지 대신 Section 으로 구역을 나눈다 | [Create and manage pages](https://help.figma.com/hc/en-us/articles/360038511293-Create-and-manage-pages), [Starter plan overview](https://help.figma.com/hc/en-us/articles/13838684089751-Starter-plan-overview) |
| 변수 모드 | 공식 비교표의 Starter 칸이 비어 있음 (Professional 은 컬렉션당 최대 10개, Organization 은 20개). 실제 Starter 계정에서는 컬렉션당 모드 1개만 만들 수 있었다 | 라이트/다크를 컬렉션 2개로 나눈다 | [Compare Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features), [Modes for variables](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables) |
| 팀 라이브러리 | 비교표에서 라이브러리 기능은 Professional 부터 표시됨 | 파일을 나누지 않고 한 파일 안에서 컴포넌트와 변수를 쓴다 | [Compare Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features) |
| Figma MCP 서버 | 월 최대 20회 (공식 표의 Starter, View/Collab 좌석 행). 파일에 쓰는 일부 도구(`create_new_file`, `generate_figma_design`, `add_code_connect_map`, `whoami`)는 한도에서 제외 | 읽기 호출을 아끼고, 반복 작업은 개발용 플러그인으로 돌린다 | [Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [Figma MCP server FAQs](https://help.figma.com/hc/en-us/articles/39252411778583-Figma-MCP-server-FAQs) |
| 개발용 플러그인 | 데스크톱 앱에서 Plugins > Development > Import plugin from manifest 로 불러와 실행. 공식 문서에 플랜 제한이나 호출 한도 언급 없음 | 변수, 텍스트 스타일, Section 생성을 스크립트로 자동화 | [Plugin Quickstart Guide](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/), [Create a classic plugin for development](https://help.figma.com/hc/en-us/articles/360042786733-Register-a-plugin-for-development) |
| 로컬 글꼴 | 새로 설치한 글꼴은 데스크톱 앱을 다시 시작해야(브라우저는 새로고침) 목록에 보인다. MCP 와 Figma agent 는 서버에서 돌아서 로컬 글꼴을 못 쓴다 | 글꼴은 강의 시작 전에 설치하고 앱을 재시작 | [Add a font to Figma](https://help.figma.com/hc/en-us/articles/360039956894-Access-local-fonts-on-your-computer), [Troubleshoot the Figma Font installer](https://help.figma.com/hc/en-us/articles/32801027692183-Troubleshoot-the-Figma-Font-installer) |

## 확인하는 법

- 한도 값: 위 표의 링크를 연다. 비교표는 Starter 칸이 비어 있는 경우가 많으니, 직접 해 보는 것(두 번째 모드 추가 버튼을 눌러 보기)이 가장 확실하다.
- MCP 한도: `Rate limits & access` 페이지의 표에서 플랜과 좌석 종류가 만나는 칸을 본다.
