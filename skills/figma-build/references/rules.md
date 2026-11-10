# 개발 친화 규칙 (단일 원본)

`lint` 도구와 쓰기 도구의 검사기는 이 규칙을 코드로 옮긴 것이다. 규칙 id 는 `lint` 결과의 `rule` 값이다.

## 규칙

### 1. 값은 변수로 (`hardcoded-value`)

색, 간격(gap, padding), 모서리, 글꼴 크기는 변수 또는 텍스트 스타일에 바인딩한다. 하드코딩된 값은 `lint` 가 `hardcoded-value` 로 알린다.

- 고치는 법: `upsert_variables` 로 변수를 만들고 `{var: "color/bg/default"}` 로 넘기거나 `bind_variable` 로 바인딩한다.
- 변수로 만들 수 없는 값이 정말 있으면 예외 문법을 쓴다 (아래).

### 2. 토큰 이름 = 코드 이름 (`token-name`)

변수 이름은 소문자 슬래시 경로다. 예: `color/bg/default`, `space/4`, `radius/md`. 각 구간은 소문자, 숫자, 하이픈만 쓴다. 코드에서는 `--color-bg-default`, `tokens.color.bg.default` 로 기계적으로 바뀐다. 이 형태가 아니면 `token-name`.

### 3. 테마 (`theme-mismatch`)

- 유료 플랜: 컬렉션 하나에 모드 2개 (Light, Dark).
- Starter: 컬렉션당 모드가 1개뿐이라 `Color / Light`, `Color / Dark` 컬렉션 2개를 만들고 **같은 변수 이름**을 둔다. `upsert_variables` 를 컬렉션마다 한 번씩 부른다.
- 두 컬렉션의 변수 이름이 다르면 `theme-mismatch`. 읽을 때(`list_variables`)는 두 형태를 모두 지원하고, 같은 이름의 변수는 같은 토큰으로 본다.

### 4. 레이아웃 = flex (`missing-auto-layout`)

화면과 컴포넌트의 프레임은 오토 레이아웃이다. `create_frame` 의 기본값이 VERTICAL 오토 레이아웃이다.

- gap, padding 도 토큰으로 넘긴다.
- FILL 크기는 부모가 오토 레이아웃일 때만 된다.
- 절대 위치는 장식 요소만 허용한다. `layout.mode: "NONE"` 은 `absolute: {reason: "..."}` 가 필수이고, 이름에 장식임을 드러낸다. 이유 없이 NONE 이면 `missing-auto-layout`.

### 5. 컴포넌트 = 코드 컴포넌트 (`component-name`, `prop-name`)

- 컴포넌트 이름은 PascalCase, 선택적으로 `/` 그룹: `Button`, `Form/Input`. 어기면 `component-name`.
- 속성 이름은 camelCase props: `variant`, `size`, `disabled`. 어기면 `prop-name`.
- variant 값은 코드의 유니언 값과 같게 쓴다 (`"primary" | "secondary"`).
- v1 에서 variant 는 Figma 에서 직접 만든다 (컴포넌트들을 선택하고 Combine as variants). `add_component_property` 는 BOOLEAN, TEXT, INSTANCE_SWAP 만 받는다. 인스턴스를 검사할 때 컴포넌트 이름은 variant 묶음(component set) 이름이고, variant 값은 속성으로 본다.

### 6. 레이어 이름 (`default-layer-name`)

`header`, `actions` 처럼 역할을 말하는 이름을 쓴다. `Frame 12`, `Text 3` 같은 기본 이름은 `default-layer-name` 경고다. `rename` 은 기본 이름을 거부한다.

### 7. 파일 구조 (lint id 없음)

Starter 는 디자인 파일당 페이지 3개다. 그 안에서:

1. 시스템 페이지: Section 으로 Foundations, Components, Patterns 를 나눈다 (`create_section`).
2. 화면 페이지.
3. 실험장 페이지.

이 규칙은 검사기가 없다. 에이전트가 직접 지킨다.

## 예외 문법

규칙을 어겨야 할 때는 이유를 남긴다. 이유는 노드에 **필드별로** 기록되고(`fill`, `stroke`, `radius`, `gap`, `padding`, `fontSize`, `lineHeight`, `absolute`, `layout`), `read_*` 결과에는 `exceptions: {"gap": "..."}` 로 보인다. `lint` 는 이유가 있는 필드의 경고만 숨긴다 (`includeExcepted: true` 면 excepted 로 보여 준다). 한 필드의 예외가 같은 노드의 다른 필드 경고를 숨기지 않는다.

- 값: `{raw: 12, reason: "마케팅 일러스트에 맞춘 고정 간격"}` (`{var}` 자리에 대신 넘긴다). 그 값의 필드에 이유가 기록된다.
- 절대 위치: `absolute: {reason: "장식용 배경 원"}`. `missing-auto-layout` 은 `absolute` 나 `layout` 이유가 있을 때만 예외가 된다.
- 나중에 같은 필드를 변수로 바꾸면(`set_auto_layout` 의 gap, padding) 그 필드의 이유는 지워진다.
- 값이 0 인 gap, padding 은 설정하지 않은 간격으로 보고 경고하지 않는다.
- 예외는 사용자에게 최종 보고할 때 목록으로 알린다. 이유를 지어내지 않는다. 모르면 사용자에게 묻는다.

## 한도와 출처

무료 플랜 한도 표와 출처는 [limits-and-sources.md](limits-and-sources.md).
