# 실습 안내

## 실습 0. 준비 (강의 전)

1. Figma 데스크톱 앱을 설치하고 무료 계정으로 로그인한다.
2. 쓸 글꼴이 있으면 미리 설치하고 Figma 앱을 완전히 종료했다가 다시 연다. 이 실습은 Figma 기본 글꼴인 Inter 를 쓰므로 설치할 필요는 없다.
3. 이 레포를 내려받아 `docs/workshop/token-plugin/` 폴더 위치를 기억해 둔다.

## 실습 1. Section 으로 구역 나누기 (약 10분)

1. 새 디자인 파일을 만들고 이름을 `My Design System` 으로 바꾼다.
2. 왼쪽 위 페이지 이름을 `System` 으로 바꾼다.
3. Section 도구(Shift+S)로 큰 사각형 3개를 그리고 이름을 `01 Foundations`, `02 Components`, `03 Patterns` 로 붙인다.
4. 확인: 레이어 패널에 Section 3개가 보이고, 접었다 펼 수 있다.

## 실습 2. 라이트/다크 컬렉션 손으로 만들기 (약 10분)

1. 아무것도 선택하지 않은 상태에서 오른쪽 패널의 Variables 를 연다.
2. 컬렉션을 새로 만들고 이름을 `Color / Light` 로 한다.
3. 색 변수 `bg/default` = `#FFFFFF`, `text/default` = `#16181D` 를 만든다.
4. 모드 추가 버튼을 눌러 본다. Starter 에서 막히는 것을 직접 확인한다.
5. 컬렉션을 하나 더 만들어 `Color / Dark` 로 하고, 같은 이름의 변수를 `#111318`, `#F2F3F5` 로 만든다.
6. 확인: 두 컬렉션에 이름이 같은 변수가 2개씩 있다.

## 실습 3. 개발용 플러그인으로 한 번에 만들기 (약 20분)

1. 실습 2 에서 만든 파일을 그대로 쓴다. 플러그인은 같은 이름이 있으면 새로 만들지 않고 값만 덮어쓴다.
2. 메뉴에서 Plugins > Development > Import plugin from manifest 를 고르고 `token-plugin/manifest.json` 을 선택한다. (메뉴 위치는 앱 버전에 따라 캔버스 오른쪽 클릭 메뉴에 있을 수도 있다.)
3. Plugins > Development > Free Course Token Builder 를 실행한다.
4. 확인: 화면 아래에 `✅ variables 18 · text styles 4 · sections 3` 이 뜬다. Variables 에 `Color / Light`, `Color / Dark`, `Spacing` 이 있고, 텍스트 스타일 4개가 생겼다.
5. 응용: `code.js` 의 `TOKENS.colors` 에 `status/danger` 같은 색을 하나 추가하고 저장한 뒤 다시 실행한다. 새 변수만 늘어나는지 본다.

### 막혔을 때

| 증상 | 원인과 해결 |
|---|---|
| Development 메뉴가 없다 | 브라우저에서 열었다. 데스크톱 앱에서 연다. |
| `❌ ...font...` | `TOKENS.fontFamily` 의 글꼴이 설치되지 않았거나, 설치 후 앱을 재시작하지 않았다. |
| 실행해도 아무 변화가 없다 | 다른 파일을 보고 있다. 실습 파일을 앞에 두고 다시 실행한다. |
