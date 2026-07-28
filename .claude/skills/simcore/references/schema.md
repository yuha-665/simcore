# SimCore 스키마 레퍼런스

최상위 키: `simcore`("0.1") · `meta` · `vars` · `derived` · `rules` · `directives` · `actions`
· `checks` · `updater` · `promptState` · `statusUI` · `setup`

---

## vars — 변수

플레이가 남긴 흔적. 값은 상태 스냅샷에 저장된다.

| 필드 | |
|---|---|
| `id` | 영문 식별자 (필수). `commands`는 상태창 자리표시자와 겹치므로 경고 |
| `label` | 화면에 뜨는 이름 (한국어). `mentions: true`면 이게 낱말이 된다 |
| `type` | `int` \| `float` \| `text` \| `bool` \| `enum` \| `list` |
| `init` | 시작값. 타입과 맞아야 함 (bool은 true/false, list는 배열) |
| `min` / `max` | 숫자형 범위. `min > max`면 오류 |
| `format` | 표시 형식. `{v}`가 값 자리 (예: `{v}G`) |
| `enum` | `type: 'enum'`일 때 선택지 배열 |
| `maxLength` | `text` 최대 글자수 (기본 200) |
| `maxItems` / `itemMaxLength` | `list` 상한 |
| `cmd` | 채팅 명령 이름. 공백·`/`·`-` 불가, 중복 불가. **파생 변수엔 못 단다** |

## derived — 파생 변수

`{ id, label, expr }`. 계산으로만 정해지는 값. **AI도 규칙도 직접 못 바꾼다.**
어디서도 안 바뀌는 변수를 만들 바에는 처음부터 파생으로 만든다.

---

## rules — 시스템이 직접 굴리는 것

### `rules.onTurn[]`
조건 없이 매 턴 실행되는 효과. `{ set, expr }`.

### `rules.events[]`
| 필드 | |
|---|---|
| `id` | 필수, 중복 불가 (랜덤 이벤트와도 겹치면 안 됨) |
| `when` | 조건식. **`rand()` 못 씀** |
| `effects[]` | `{ set, expr }` 또는 `{ list, add[], remove[] }` |
| `notify` | 다음 턴에 AI에게 전달될 서술 |
| `once` | true면 딱 한 번만 |
| `check` | 판정 id (v0.40) — 발동 시 굴리고 [판정] 줄은 통지로 다음 전송 합류 |
| `choices[]` / `timeout` | 갈림길 (v0.41) — 아래 절 |

⚠ **시작/끝 이벤트를 짝으로 만든다.** `food <= 0`만 쓰면 식량이 0인 동안 매 턴 재발동한다.
`food <= 0 and not famine` / `food > food_need * 2 and famine` 식으로 플래그를 끼운다.

### `rules.randomEvents`
`chancePerTurn` (0~1) + `table[]`. 표 항목은 events와 같고 `weight`(양수) · `cooldown`(턴) 추가.
`when`을 비우면 항상 후보.

### 갈림길 — `choices[]` (v0.41, 조건·랜덤 이벤트 공통)

이벤트에 `choices: [{ label, when?, effects?, inject? }]`를 달면 **터지면서 선택지를 내밀고
유저가 고를 때까지 기다린다** (actions = 상시 동사, choices = 이 순간의 갈림길).

- 입력 통로는 둘: **`/선택 번호`·`/선택 이름`** 채팅 명령 (앞머리 매칭), 그리고 v0.42부터
  **상태창·조작줄의 선택지 직접 클릭** (좌표 히트테스트 — mainDom 권한 필요, 거부 시 명령만).
  둘 다 **기록만** 하고 집행은 다음 전송 단계 — 효과식의 rand·변화 로그·리롤 안정이 거기 있다.
  고르면 `[선택] 라벨` + `inject`가 주입된다. 검증기는 `engine.pickChoice` 공용
- **동시 1개 상한.** 걸린 동안 다른 갈림길(자기 포함)은 발동을 미루고, 일반 이벤트는 정상
- **대기 중**: 보조 AI는 멈추지 않는다 — 그 선택지들이 만질 변수만 allow에서 잠깐 빠진다
  (결과 선점 방지). 매 전송 `[선택 대기]` 한 줄이 붙는데 선택지 내용은 안 싣는다
- **`timeout`턴 안 고르면 맨 마지막 항목이 자동 결정** — 마지막은 조건 없는 "외면한다"류로
  둘 것 (마지막에 when이 있으면 경고, 잠겨 있으면 효과 없이 지나간다). timeout 없으면 경고
- 선택지 `when`이 거짓이면 잠김(🔒) 표시만 되고 번호는 유지된다 (지난 메시지의 상태창과
  어긋나지 않게 번호는 배열 순서 고정)
- 상태창: 그룹 모드는 자동 블록, 템플릿 모드는 `{choices}` 자리 (없으면 경고).
  변수 cmd에 '선택'을 쓰면 경고 (내장 명령과 충돌)
- 이벤트 자체 `effects`는 발동 즉시(플래그 세우기 등), 선택지 `effects`는 고른 뒤 — 역할이 다르다

---

## directives — 상태 지시문

`{ id, when, text }`. 이벤트가 "발동 순간 1회 통지"라면 이건 **조건이 참인 동안 매 턴 주입**된다.
`{변수id}`로 값 삽입 가능.

> 이벤트는 "터지는 것", 지시문은 "깔리는 것".

이게 없으면 식량 0인데 AI가 풍요로운 식탁을 묘사하는 괴리가 난다.

---

## actions — 유저가 누르는 버튼

| 필드 | |
|---|---|
| `id` / `label` | 라벨 **맨 앞 이모지가 곧 버튼 아이콘**이 된다 (버튼 칸은 글리프 한 칸) |
| `mode` | `oneshot`(1회성) \| `hold`(지속형) |
| `cooldown` | 턴 수. oneshot만 기록됨 |
| `when` | 사용 조건. 거짓이면 잠김(🔒) |
| `inject` | 발동 시 AI에게 전달될 문장 |
| `effects[]` | rules와 같은 형식 |

**공통: 누르면 무장(armed)만 되고 다음 `sendPhase`에서 발동한다.** 즉시 적용이 아니다.
한 번 더 누르면 취소. 차이는 발동 후 — oneshot은 자동 해제 + 쿨다운, **hold는 끌 때까지 매 턴 계속**.

실행은 **화면 우상단 플로팅 버튼**. 상태창 안의 목록은 범례일 뿐 눌러도 안 된다
(리수가 메시지 내 클릭의 target을 잘라낸다 → [risu-facts.md](risu-facts.md)).

---

## checks — 판정 ("완벽 주사위", v0.40)

굴림은 엔진이 하고, AI는 결과를 받아 서사만 쓴다. 결과는 변수가 아니라 시스템 기록(meta.lastCheck)에
남아 **보조 AI가 건드릴 형태 자체가 없고**(설계 문서의 "allow 금지"를 구조로 달성), 시드 굴림이라
**리롤해도 같은 눈**이다.

| 필드 | |
|---|---|
| `id` / `label` | id가 vars/derived와 겹치면 오류. label이 [판정] 줄·상태창에 나온다 |
| `roll` | 굴림식 (필수). **rand()가 허용되는 유일한 자리** — 이점 굴림: `adv ? max(rand(1,20), rand(1,20)) : rand(1,20)` |
| `mod` | 보정식 (기본 0). 변수·파생을 읽는다. rand 불가 |
| `vs` | 목표치 — 숫자 또는 식 (없어도 됨). rand 불가 |
| `grades[]` | `{ when?, label, effects[], inject? }` — **위에서부터 첫 매치**. when 없으면 항상 참(기본 등급). 기본 등급이 없으면 경고, 기본 등급 뒤의 등급은 도달 불가 경고 |

- 등급의 `when`/`effects` 수식은 `roll`·`mod`·`total`(=roll+mod)·`vs`를 임시 식별자로 쓴다
  (변수보다 우선 — 같은 이름의 변수가 있으면 "가려짐" 경고. vs 없는 판정에서 vs를 쓰면 오류)
- `inject` = 그 등급일 때 덧붙는 연출 지시 (예: "기대 이상의 성과를 극적으로 그려라")
- **트리거는 기존 통로 재사용**: `actions[].check` — 무장 → 전송 시 굴림, **같은 턴** 서사 반영.
  `events[].check`·`randomEvents.table[].check` — 발동 시 굴림, [판정] 줄은 통지로 **다음 전송** 합류
  (trpg need_roll의 "시스템이 대신 굴리기" 배선)
- **순서: 굴림 → 등급 effects → 액션/이벤트 자체 effects.** 굴림식이 이점(adv) 같은 소모성 변수를
  읽으므로, 그걸 끄는 정리는 자체 effects에 둔다 (굴림이 끝난 뒤 적용되므로 안전)
- [판정] 줄이 있는 턴에만 판정 규칙 줄("뒤집어 서술하지 마라")이 자동으로 붙는다 —
  `promptState.checkGuide`: false로 끄거나 문자열로 대체({변수} 가능). eventPriority와 같은 원칙
- 프롬프트 줄 순서: 액션 `inject`(의도) → `[판정] 라벨: 14 + 2 = 16 vs 13 → 성공`(결과) → 등급 `inject`(연출)
- 상태창: `{lastcheck}` 자리표시자(판정 전엔 빈 문자열) + 변화 로그에 🎲 줄

---

## updater — 보조 AI 설정

| 필드 | |
|---|---|
| `allow[]` | **여기 없는 변수는 AI가 절대 못 건드린다** |
| `allow[].id` | vars에 있어야 함 |
| `allow[].maxGain` / `maxLoss` / `maxDelta` | 턴당 증감 상한. **셋 다 없고 min/max도 없으면 무제한** (검증 경고) |
| `allow[].maxLength` | text 최대 글자 (기본 200) |
| `allow[].mentions` | `true`(label을 낱말로) 또는 문자열/배열. **이번 턴 서사에 그 말이 있을 때만 열린다** |
| `allow[].whenArmed` | 액션 id 또는 배열 (v0.39). **그 액션이 무장 중(hold)이거나 이번 전송에서 발동(oneshot)된 턴에만 열린다.** 여러 개면 하나만 열려도 개방. mentions와 같이 걸면 둘 다 만족해야. id가 actions에 없으면 검증 오류 |
| `contextTurns` | 보조 AI에게 함께 보낼 최근 대화 (1~5 정수, 기본 1) |
| `guide` | 보조 AI 추가 지시 |

### allow에 뭘 넣고 뭘 빼나

판단 기준 하나: **이 값을 서사만 읽고 알 수 있나?**

| 넣는다 | 뺀다 |
|---|---|
| 호감도 · 소지품 · 위치 · 재고 증감 | 날짜/경과 카운터 |
| 서사에 나타나는 상태 | 주사위·판정값·피해량 |
| | 이벤트가 세우는 플래그 |
| | 플레이어가 고르는 정책값 |
| | 숨긴 정답 (mystery의 `truth`) |
| | 규칙이 파생시키는 값 (rpg의 `level`) |

⚠ **"규칙이 쓰는 변수는 빼라"는 틀렸다.** 템플릿 9종 전부 겹친다 — estate `food`는 규칙이 매 턴
깎고 AI도 서사대로 조정한다. **자동 정산과 서사 반영은 같이 가는 게 정상.**

⚠ 편집기의 **[⚡ 빠진 변수 모두 추가]**를 템플릿 봇에서 그냥 누르면 안 된다. rpg는 AI가 레벨을
올리고, trpg는 주사위값을 AI가 쓰며, mystery는 AI가 진상을 고쳐 쓴다.

### mentions 세부
- 낱말이 한 글자면 아무 문장에나 걸린다 → 검증 경고
- 이름이 서로 겹치면 **긴 쪽이 이긴다** (릴리아나 ⊃ 리아나 — 리아나는 안 열림)
- 같은 낱말을 둘이 쓰면 경고
- 금화·식량 같은 **공용 수치에는 걸면 안 된다** (이름 없이도 늘 바뀌므로 갱신이 멈춘다)
- **단위 낱말 금지** (v0.38.3 실측 사고): funds에 "골드"를 걸었는데 재고 포맷이 "원가 N골드"라
  매 턴 열림 + 큰 maxDelta → 돈 자동 증식. 낱말이 어떤 변수의 `format`에 들어 있으면 검증 경고
- **채팅 언어의 낱말이어야 한다.** 한국어 낱말 + 영어 채팅이면 그 변수는 **조용히 영영 안 열린다**
  (에러 없는 실패). 다국어 봇은 병기("골드, gold")하거나 mentions 없이 캡으로만 제어.
  패널 [현황]이 6턴 연속 안 열린 mentions 변수를 경고한다 (aux 직접 경로 전용)
- **이중 장부(귀속 오류)에는 mentions가 아니라 `whenArmed`.** 낱말은 어휘 규약이라 확률이고
  언어 종속 — 버튼은 어느 언어로 채팅해도 버튼이다. 프롬프트·적용 양쪽에 걸리고 루아 브리지에서도
  적용 시점에 결정적으로 작동한다. 침묵 경고는 whenArmed 변수를 제외한다 (안 눌러 닫힌 건 정상)

---

## promptState — 메인 AI에게 보낼 상태 요약

`{ template, includeEvents, eventPriority, systemGuide }`. `{변수id}` 자리표시자.
`eventPriority`는 이벤트 발동 턴에만 "사건은 확정 사실, 유저 행동은 시도" 규칙을 자동으로 붙인다
(문자열을 주면 그 문구로 대체).

---

## statusUI — 상태창

| 필드 | |
|---|---|
| `mode` | `auto`(그룹) \| `template`(HTML 직접) |
| `layout` | `stack`(기본) \| `tabs` \| `accordion` \| `popover` — **auto 모드 전용** |
| `theme` | `clean` \| `parchment` \| `terminal` \| `card` … |
| `collapsible` | false면 바깥 `<details>` 없이 펼쳐진 채 |
| `customCSS` | 자동으로 `.sim-status` 하위로 스코핑됨 |
| `groups[]` | `{ label, visibility: show\|collapsed\|hidden, showWhen, items[] }` |
| `groups[].items[]` | `{ var, label, bar: {max}, color, showWhen }` |
| `template` | HTML + 임베드 `<style>`. `{변수id}` · `{id:tags}` · `{commands}` · `{uid}` · `{lastcheck}` · `{choices}` |
| `templates[]` | `{ id, when, template }` — 조건이 참인 **첫 번째만** 그린다. CSS는 `.sim-tpl-<id>`로 격리 |

- `tabs`/`popover`는 **보이는 그룹이 2개 이상**일 때만 동작 (아니면 조용히 stack)
- 자리표시자 `{uid}` = 이 상태창이 그려진 **메시지 번호**. 탭의 radio `id`/`name`에 필수
- `{commands}` — 그룹 모드는 맨 아래 자동, 템플릿 모드는 박은 자리에만.
  명령을 열어 두고 `{commands}`가 없으면 명령 탭이 경고

---

## setup — 새 시작

### `setup.presets[]`
`{ id, label, set: {변수id: 값} }`. **값만 쓸 수 있고 수식은 안 된다.**
여기 적은 변수만 바뀌고 나머지는 `init` 그대로. 기본 난이도는 `set: {}`로 비워 두는 게 정직하다.

### `setup.ai`
`{ enabled, vars[], instruction, guide }`. 첫 턴 대화로 시작 상황을 정한다(세션 0).
`vars[]`에 고른 것만 AI가 정할 수 있다 — 날짜·주사위·진행 플래그는 빼야 한다.

---

## 표현식 문법

비교/논리: `<= >= == != and or not`

함수는 `FUNCS` / `FUNC_ARITY` 가 전부다 (그 외는 오류):

| 함수 | 인자 | |
|---|---|---|
| `round` `floor` `ceil` `abs` | 1 | |
| `min` `max` | 2+ | |
| `clamp(v, lo, hi)` | 3 | |
| `rand(a, b)` | 2 | 평가 컨텍스트의 **시드 RNG**를 쓴다 |
| `count(list)` | 1 | |
| `has(list, '항목')` | 2 | |
| `sum(list)` | 1~2 | 목록 항목 **맨 끝의 숫자**를 더한다 |

- 목록 조작 효과: `{ list: 'id', add: [...], remove: [...] }` — **전체 교체는 금지**(아이템 증발 방지)
- `when` 계열에는 `rand()` 금지 (events / randomEvents.when / showWhen / directives.when / templates.when)

### 목록 항목의 규약
- **기한 `@숫자`** — 남은 일수가 아니라 **끝나는 시점**(절대 경과값). 미니 표현식엔 반복문이 없어
  매 턴 1씩 깎는 게 불가능하고, 절대값이면 날짜를 며칠씩 건너뛰어도 저절로 맞는다
- **`sum()`은 숫자가 항목 맨 끝에 있어야** 잡는다. "양모 계약 +12" → 12.
  "아무 데나 있는 마지막 숫자"로 하면 "양모 계약 12 (30일)"이 30으로 조용히 잘못 잡힌다
- 자주 변하는 숫자를 목록 항목에 넣지 말 것. 끝자리 숫자는 **안 변하는 값 전용**(봉급·수용 인원 등)
