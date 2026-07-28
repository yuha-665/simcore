# 리수 내부 확정 사실

전부 **PocketRisu v1.8.1 소스맵으로 검증**한 것. 추측이 아니다.
여기 어긋나면 조용히 깨지거나, 남의 플러그인을 죽인다.

## 소스 확인 방법 (다시 캘 때)

`E:\0.리수봇\PocketRisu-v1.8.1-win-x64\dist\assets\*.js.map` 에 원본 TS가 통째로 들어 있다.

```bash
# 어느 번들에 있는지부터 찾는다
cd "E:/0.리수봇/PocketRisu-v1.8.1-win-x64/dist/assets" && grep -l "찾을문자열" *.js
# 그 맵에서 sourcesContent를 풀어 낸다 (index-*.js.map = 앱 본체, database.svelte-*.js.map = 엔진/스크립팅)
```

주요 파일: `src/ts/process/scriptings.ts`(Lua) · `src/ts/process/triggers.ts` ·
`src/ts/process/request/request.ts` · `src/ts/plugins/plugins.svelte.ts` ·
`src/ts/plugins/apiV3/v3.svelte.ts` · `src/ts/parser/parser.svelte.ts`(HTML/CSS 새니타이즈)

---

## ★ beforeRequest 리플레이서는 모든 요청에 걸린다

```ts
// request.ts — requestChatData
for (const replacer of pluginV2.replacerbeforeRequest) {
    arg.formated = await replacer(arg.formated, model)   // ← try/catch 없음
}
```

`model`은 `'model' | 'submodel' | 'memory' | 'emotion' | 'otherAx' | 'translate'`.
**메인 생성만이 아니라 번역·요약·감정·기타 보조 호출 전부**가 여기를 지나간다.

- 두 번째 인자를 안 보면 남의 프롬프트에 우리 블록을 얹어 **그 기능을 죽인다** (v0.37.2 사고)
- **호출부에 try/catch가 없다** → 리플레이서가 던지면 그 요청 자체가 실패한다. 훅 본문 전체를 try로 감쌀 것
- `pluginV2[mode]` 스크립트 핸들러 루프(`scripts.ts`)도 무방비다. **던지는 플러그인 뒤에 등록된
  플러그인은 전부 안 돈다** (Set 순회 = 로드 순서)

## runLLMModel / axLLM

- `Risuai.runLLMModel({ mode, messages, staticModel?, allowPlugins? })` → `{ type:'success'|'fail', result }`
- Lua `axLLM(id, messages)` → 내부적으로 `requestChatData(..., 'otherAx')` — **`submodel`이 아니다**
- **`messages`에 system 한 통만 담으면 안 된다.** 구글 계열(버텍스 Gemini)은 system을 contents가
  아니라 systemInstruction으로 빼내므로 contents가 빈 배열이 되고, 리수 요청 빌더가 없는 원소의
  role을 읽다 `Cannot read properties of undefined (reading 'role')`로 죽는다.
  OpenAI 호환(LLM Gateway 등)은 안 죽어서 **같은 모델·같은 백엔드라도 프로바이더에 따라 갈린다.**
  반드시 짧은 user 턴을 덧붙일 것
- `"Plugin calls are blocked by the caller."` = 보조모델이 `pluginmodel:::`일 때 `blockPlugins` 가드.
  **`allowPlugins: true`로 공식 옵트인 가능**
- 클래식 경로에서 `otherAx`는 `db.seperateModelsForAxModels`가 켜져 있으면 `db.seperateModels.otherAx`를
  쓰고, 아니면 `db.subModel`. **`submodel`에는 그런 분리 키가 없다**

## 메시지 HTML/CSS가 통과하는 규칙 (`parser.svelte.ts`)

`DOMPurify.sanitize(data, { ADD_TAGS: ['iframe','style','risu-style','x-em', MathML…],
ADD_ATTR: ['allow','allowfullscreen','frameborder','scrolling','risu-ctrl','risu-btn','risu-trigger','risu-mark','risu-id', …] })`
— **기본 허용 목록 + 위 항목**이다.

| | |
|---|---|
| **살아남는 태그** | `input` `label` `details` `summary` `div` `span` `style` `button` `select` `option` |
| **살아남는 속성** | `type` `checked` `id` `for` `name` `tabindex` `open` `class` `style` `hidden` `value` `role` `disabled` `title` |

→ **메시지 안에서 순수 CSS 탭(라디오+라벨) · 팝업(`tabindex`+`:focus-within`) · 아코디언(`details`)이 가능하다.**

리수가 건드리는 건 **class뿐**:
- HTML의 class에 `x-risu-` 접두가 붙는다 (`hljs`·`x-risu-` 로 시작하면 그대로)
- `<style>` 안 선택자도 `decodeStyleRule`이 **클래스만** 똑같이 접두한 뒤 `.chattext `를 앞에 붙인다
- **id 선택자 · `:checked` · `~` · `:focus-within`은 손대지 않는다**

⚠ 상태창류는 **마커가 달린 메시지마다** 그려지므로 id/name을 고정하면 안 된다.
같은 id가 여럿이면 `<label for>`은 문서에서 처음 만난 것을 집는다 → 최신 메시지의 탭이 맨 위 글을 건드린다.
메시지 번호를 섞을 것(SimCore는 `{uid}`).

## ★ 플러그인이 받는 DOM 객체는 RPC 프록시다 — 모든 메서드가 Promise (v0.43 사고 교훈)

플러그인은 게스트(iframe)에서 돌고, 호스트 API가 주는 클래스 인스턴스(SafeDocument·SafeElement·
SafeClassArray — `__classType: 'REMOTE_REQUIRED'`)는 게스트에 **REMOTE_REF 프록시**로 도착한다
(`apiV3/factory.ts`). 프록시는 **모든 프로퍼티 접근이 원격 호출 함수**가 된다:

- `els.length()` · `els.at(i)` · `el.getClassName()` · `el.getBoundingClientRect()` — **전부 await 필수**
- 반환값 중 REMOTE_REQUIRED 클래스는 또 프록시로, DOMRect 같은 직렬화 가능 객체는 실값으로 온다
- ⚠ v0.42가 이걸 동기값처럼 다뤄 **클릭이 전부 조용히 무산**됐다 (`i < Promise` = false).
  테스트 목은 반드시 **비동기 메서드로만** 만들 것 (test-clicks가 그렇게 재작성됨)

## ★ 메인 DOM 클릭은 target을 못 받는다 — 그러나 좌표 히트테스트로 우회된다 (v0.42, v0.43 수정)

리수가 플러그인에 이벤트를 넘길 때 `trimEvent`로 잘라 마우스는 `{type, clientX, clientY, button,
buttons, altKey, ctrlKey, shiftKey, metaKey}`, 키보드는 `{type, key, code, repeat, 수식키}`만 준다
— **`target` 없음**. `SafeElement.addEventListener`는 `this.#element`가 아니라 전역 `document`에
리스너를 건다 (문서 이벤트: click·mouse 계열 즉시 / 키 입력: 0~99ms 랜덤 지연 후 전달 —
그 밖의 타입은 throw). options의 **capture가 그대로 통과**된다 — document 캡처 리스너는 이벤트
경로의 맨 앞이라 **어디서 버블을 삼켜도 반드시 먼저 본다** (입력창 위 조작줄 클릭이 안 잡히던
v0.43.0 증상의 해법 — 히트테스트 리스너는 캡처로 걸 것).

"어느 버튼이 눌렸는지"는 못 받지만 **그 좌표에 우리 버튼이 있는지는 잴 수 있다**:
`Risuai.getRootDocument()`(mainDom 권한, 아래 절) → `querySelectorAll` + `getBoundingClientRect()`
+ 클릭 clientX/Y 대조 — 위 절대로 **전 단계 await**. **SimCore v0.42~0.43이 이 길로 상태창
범례·갈림길 선택지·제안 칩을 진짜 버튼으로 만들었다** (`sim-hit*` 클래스 + `decodeHitClass` —
메시지 파이프라인의 x-risu- 접두까지 해독). 주의: 접힌/숨은 요소는 rect 0×0이라 자연히 제외되고,
상태창은 메시지마다 그려지므로 같은 논리 버튼이 여럿 명중할 수 있다 — 첫 명중 하나만 쓸 것.
우리 iframe 패널이 떠 있는 동안은 쉬어야 한다.

SafeElement에 있는 것(전부 프록시 경유 await): appendChild/remove류, `textContent()`/`setTextContent`,
`setAttribute`(**x- 접두만 허용**), `setStyle(prop, val)`, add/remove/hasClass, `getClassName()`,
`querySelectorAll` → SafeClassArray(`at(i)`·`length()` — 메서드다), `getBoundingClientRect()`.
**입력창 value를 채우는 API는 없다** — "입력에 넣기"는 불가, 대신 sendChat(아래)으로 바로 보낸다.

## ★ 플러그인 권한 — 거부가 영구 저장된다 (mainDom·sendChat 등 6종)

`fetchLogs / db / mainDom / replacer / provider / sendChat` 6종. 확인창은 **alertConfirm**이라
아래 절의 함정이 그대로 적용된다 — **우리 전체화면 패널이 떠 있을 때 권한을 요청하면 창이 가려져
자동 falsy = 거부로 저장된다** (v0.42 실기 무반응의 절반). 허용/거부 모두
`(플러그인 이름, 권한)` 키로 **영구 저장**되고, 거부되면 그 뒤로는 **창 없이 즉시 null/false** —
플러그인 쪽에서 다시 물을 방법이 없다. 푸는 길은 리수 **설정 → 플러그인 → 해당 플러그인 줄의
방패(🛡) 아이콘 = 권한 초기화** 뿐 (재임포트로는 안 풀린다 — 이름 기준 키).
replacer/db/provider는 3일마다 재확인(periodically), mainDom/sendChat은 1회 영구.

`Risuai.sendChat(message)` — **유저 메시지를 넣고 생성까지 돌리는 공식 API** ('sendChat' 권한).
생성 중(doingChat)이면 throw, 권한 거부면 false. ⚠ **메인 모델이 플러그인 프로바이더**(`pluginmodel:::`,
게이트웨이류)면 "Sending chat with plugin-based model is currently blocked"로 **정책 차단(throw)** —
그 환경에선 자동 전송이 원천 불가 — **클립보드 복사로 강등**할 것 (v0.43.3; 입력창 채우기 API는
플러그인에 없다 — 입력값은 채팅 화면 컴포넌트 로컬 상태고 v3 API 전수 확인에도 setInput류 부재.
네이티브 자동 제안의 chat.suggestMessages는 주입 가능하지만 UI가 useAutoSuggestions ON일 때만
뜨고 자체 생성이 덮어써서 실용 불가). 플러그인 iframe의 navigator.clipboard는 환경 따라 막힐 수
있으니 try + 표시 전용 폴백.
SimCore v0.43 제안 칩(누르면 그대로 전송)이 이것이다.

클릭 없이 가는 다른 통로:
1. `registerButton({ location: 'action'|'chat'|'hamburger', id })` — 리수가 직접 onclick을 건다.
   `'action'`은 화면 우상단 고정 세로 스택(`fixed top-4 right-4`), **icon만 렌더되고 name은 안 보인다**
   → 라벨을 `icon`(iconType:'html')에 담되 style/class 속성은 제거된다.
   `'chat'`은 **입력창 옆 드롭다운 메뉴 항목** — 아이콘+이름이 그대로 보인다 (SimCore 패널 진입점이 이것).
   `'hamburger'`도 메뉴 항목.
2. `setChatPanel(html, {id, className})` — 입력창 위 도킹 패널. **기본 DOMPurify만 타서 class가
   x-risu-로 재작성되지 않는다** (메시지와 다름). 표시 전용이지만 히트테스트와 결합하면 눌린다
   — SimCore v0.42 조작줄(simcore-strip)이 이 조합이다. content에 null을 주면 패널 제거.
3. 앱 내부에는 `alertSelect`(선택 다이얼로그)가 있지만 **플러그인 API에는 미노출** —
   대화상자는 alert/alertConfirm/alertError뿐. 전송은 `sendChat`(권한 절 참고)이 따로 있다.

## alert / alertConfirm

`Risuai.alert/alertConfirm`은 **우리 패널이 fullscreen일 때 쓸 수 없다.** 호스트 대화상자는 메인 앱
DOM에 뜨는데 `showContainer('fullscreen')`한 플러그인 iframe이 그 위를 덮어 보이지도 눌리지도 않는다.
`alertConfirm`은 조용히 falsy로 떨어져 **"취소를 누른 것"과 구분이 안 된다**
(v0.13~v0.16에서 세이브 동봉 스키마가 한 번도 복원되지 않은 원인).
패널이 떠 있는 동안의 확인·선택은 반드시 **패널 자체 UI**로 받을 것.
패널이 닫힌 상태에서 도는 경로(플로팅 버튼 등)에서는 정상 동작한다.

## Lua 트리거

- **엔진은 모드당 하나뿐**이다 (`ScriptingEngines`는 `mode`만 키). 코드가 다르면
  **엔진을 통째로 부수고 다시 만든다.** 캐릭터 트리거 + 모듈 트리거가 같이 있으면 호출마다 파괴/재생성이 오간다
  → **루아 모듈 상단의 캐시성 `local`은 신뢰할 수 없다**
- 루아 트리거는 트리거의 `type`과 **무관하게 모든 모드에서 실행**된다
  (`effect[0].type === 'triggerlua'`면 mode 필터를 건너뜀). 등록은 `onInput`/`onOutput`/`onStart` 등으로 스스로 한다
- `onInput` 엔진과 `onOutput` 엔진은 서로 다른 인스턴스 → Lua 전역으로 모드 간 상태 공유 불가.
  상태는 chat 변수로
- Lua API 첫 인자는 항상 `triggerId`(콜백이 받은 접근 키). 이 키로 safe/lowLevel 권한이 검증된다

## 기타 확정 사실

- `Risuai.setCharacter(char)`는 **현재 선택된 슬롯**(`db.characters[selectedCharID]`)에 통째로 덮어쓴다
  — char 객체의 출처와 무관. 캐릭터 전환 후 stale 객체로 부르면 대참사
- `getChatFromIndex`가 주는 chat 객체는 **라이브 참조**(mutation이 저장됨),
  `getCharacter`는 **스냅샷**(setCharacter 필요)
- 플러그인 재임포트는 `pluginStorage`를 지우지 않는다 (실측)
- 변수는 CBS `{{getvar}}` / Lua `getChatVar` / 트리거 V2가 **한 저장소**(`chat.scriptstate['$'+key]`)를 공유한다.
  값은 항상 문자열이고 없으면 문자열 `'null'`이 온다 (빈 문자열 아님)
