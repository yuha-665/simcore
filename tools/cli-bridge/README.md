# SimCore CLI 다리 — 이 PC의 Claude Code · Codex로 봇 만들기

SimCore 편집기의 AI 어시스턴트(스키마 생성·💬 대화·에셋 변환·꾸미기)를 리수의 API 모델 대신
**이 PC에 깔린 Claude Code(구독)** 또는 **Codex(ChatGPT 로그인)** 로 돌린다. API 키가 필요 없다.
RP 채팅은 그대로 리수 모델이다 — 이 다리는 편집기 생성에만 쓰인다.

## 되는 곳 · 안 되는 곳

| 환경 | 되나 | 비고 |
|---|---|---|
| 리수 데스크톱 (Tauri) | ✅ | 플러그인의 `nativeFetch`가 네이티브로 localhost에 간다 |
| 리수 셀프호스트 (Node 서버, 같은 PC) | ✅ | 서버 쪽 프록시가 localhost를 부른다 |
| 웹 리수 (risuai.xyz) | ⚠ 실험 | 기본은 리수 프록시 서버(Cloudflare)를 거쳐서 localhost에 못 간다 — 403 `error code: 1003`. 고급 설정 → **비권장 설정 보이기** → **직접 요청 보내기**(`usePlainFetch`)를 켜면 브라우저가 직접 부른다. 리수의 모든 요청이 브라우저 직통이 되어 모델에 따라 CORS 오류가 날 수 있으니 다리를 쓸 때만 (유저 실기 통과 2026-11-03) |
| 포켓리스 · 폰 | ❌ | PC의 프로세스를 띄워야 한다 |

## 켜기

1. 이 PC에 Claude Code(VS Code 확장이든 CLI든)가 설치되고 **로그인**돼 있어야 한다. Codex는 `codex login`.
2. `cli-bridge.bat` 더블클릭 (또는 `node simcore-cli-bridge.js`). 검은 창에 `LISTENING http://127.0.0.1:5181`이 뜨면 켜진 것.
3. 리수 → SimCore 편집 작업공간 → 생성 버튼 옆 **생성 모델** → `이 PC의 Claude Code · Codex (구독)` → [🔌 연결 확인] → 모델 고르기.
4. 창을 닫으면 꺼진다. 봇 만들 때만 켜면 된다.

실행 파일은 자동으로 찾는다: 직접 지정(환경변수) → PATH → `~/.local/bin` → npm 전역 → VS Code·Cursor·Windsurf 확장.

## 무엇을 하고 무엇을 안 하나

- 요청·응답 본문을 **어디에도 남기지 않는다.** 콘솔에는 시각·백엔드·소요 시간·토큰 수만.
- 로그인 정보를 읽지도 저장하지도 않는다. Claude Code·Codex가 하던 로그인을 그대로 쓴다.
- Claude Code는 사용자 환경과 **격리**해서 띄운다 — 도구 없음(`--tools ""`), 사용자·프로젝트 설정 안 읽음(`--setting-sources ""`),
  MCP 안 띄움, 세션 기록 안 남김, 슬래시 명령 없음. 전역 CLAUDE.md나 훅이 요청에 섞이지 않는다.
- Codex는 빈 임시 폴더에서 읽기 전용·기록 없이(`--ephemeral`), 사용자 설정을 안 읽고(`--ignore-user-config`) 도구를 끄고 돌린다. 읽기 전용 샌드박스는 쓰기만 막아서 도구가 켜져 있으면 디스크의 파일을 읽어 돌려준다(2026-10-31 미끼 파일로 실측). `--tools ""` 같은 옵션이 없어 `CODEX_TOOLS_OFF`를 `-c features.*=false`로 낱낱이 끈다. `--disable`은 모르는 이름에서 바로 죽어 판이 다른 Codex를 못 쓴다.
- 웹페이지의 요청은 허용 주소만 받는다(`Origin` 검사, `https://risuai.xyz`·Tauri·이 PC 주소). 다리에는 로그인이 없어서 이 검사가 없으면 다리를 켠 채 아무 사이트나 열어도 그 사이트가 구독을 쓴다. 리수 데스크톱·셀프호스트는 브라우저가 부르는 것이 아니라 `Origin`이 없다. `Host`가 이 PC가 아니어도 거절한다(DNS 리바인딩).
- 기본은 `127.0.0.1`에만 연다. 다른 기기에서 쓰려고 `SIMCORE_CLI_HOST=0.0.0.0`으로 열면 같은 네트워크의 누구나 당신의 구독을 쓸 수 있다 — 권장하지 않는다.

## 엔드포인트 (OpenAI 호환)

| 경로 | 설명 |
|---|---|
| `GET /health` | 백엔드 상태. `?refresh=1`이면 다시 찾는다 |
| `GET /v1/models` | 고를 수 있는 모델. `claude-code`, `claude-code:opus`, `claude-code:sonnet`, `codex`, `codex:<slug>` |
| `POST /v1/chat/completions` | `{ model, messages, stream? }` → OpenAI 모양 응답. `stream: true`면 SSE |

OpenAI 호환이라 리수 데스크톱의 **커스텀 모델**(주소 `http://127.0.0.1:5181/v1/chat/completions`, OpenAI 형식)로도 꽂힌다.
다만 그 용도는 이 리포가 보증하지 않는다 — Claude Code는 messages 배열이 아니라 프롬프트 하나를 받아서, 다턴 대화는 한 덩어리로 평탄화된다.

## 환경변수

| 이름 | 기본 | 뜻 |
|---|---|---|
| `SIMCORE_CLI_PORT` | 5181 | 포트 |
| `SIMCORE_CLI_HOST` | 127.0.0.1 | 바인드 주소 |
| `SIMCORE_CLI_CLAUDE_BIN` | (자동) | Claude Code 실행 파일 직접 지정 |
| `SIMCORE_CLI_CODEX_BIN` | (자동) | Codex 실행 파일 직접 지정 |
| `SIMCORE_CLI_ORIGINS` | (없음) | 웹에서 plain fetch로 부를 주소를 더한다 (쉼표로 여럿) |

## 자주 나는 오류

- **로그인되어 있지 않아요** — 터미널에서 `claude` 한 번 실행해 로그인하거나 VS Code 확장에서 로그인. 전역 환경변수 `ANTHROPIC_API_KEY`가 있으면 구독 대신 키를 잡으려 하니 지운다 (다리는 자식 프로세스에서 지우지만 로그인 자체가 키 모드면 안 된다).
- **구독 사용 한도** — 5시간·7일 창이 찼다. 기다리거나 생성 모델을 보조 모델로 돌린다.
- **포트를 못 열었어요** — 다른 다리가 이미 켜져 있다. 그 창을 쓰면 된다.
- **이 주소에서 온 요청은 받지 않아요** — 허용 목록에 없는 웹 주소다. 직접 쓰는 리수 주소면 `SIMCORE_CLI_ORIGINS`에 넣고 다리를 다시 켠다.
- **Codex가 오래돼서 설정을 끄는 옵션을 몰라요** — Codex를 업데이트한다. 도구를 켠 채 돌지 않으려고 일부러 멈춘 것이다.
- **더블클릭해도 창이 바로 닫힌다** — 2026-10-31 이전의 `cli-bridge.bat`이다(LF 줄바꿈 + 한글을 cmd.exe가 잘못 읽고 죽는다). 새 파일로 바꾸거나 이 폴더에서 `node simcore-cli-bridge.js`를 직접 실행한다. 이 배치 파일은 ASCII + CRLF로 둘 것.

## 배포

리포가 비공개라 플러그인 옆에 zip을 같이 올린다. `node tools/cli-bridge/pack.js` → `배포/SimCore-bridge.zip` (`cli-bridge.bat` · `simcore-cli-bridge.js` · 사용법 `README.txt`).
`.bat`만으로는 안 돈다 — js가 같은 폴더에 있어야 한다. zip은 gitignore라 리포에 안 들어가니 올리기 전에 만든다. 파일을 고치면 다시 만들 것 (zip이 있으면 `test-clibridge`가 안의 파일이 소스와 같은지 본다).

## 배포해도 되는 근거 — 깨지 말 것

구독을 앱에 연결하는 것이 아니라 터미널에서 `claude -p`·`codex exec`를 실행하는 것과 같은 구조다. 노벨 스튜디오·AutoQA는 앱 안에서 이 CLI를 실행하고, 플러그인은 프로세스를 못 띄우니 다리가 그 몫을 한다.
Anthropic [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance) 기준 (2026-10-31 다시 확인, 노벨 스튜디오와 같은 조건):

1. Claude Code 바이너리를 고치지 않는다 — 설치된 그대로 실행만 하고, 인증 방법을 막거나 빼지 않는다.
2. 사용량을 대신 내거나 되팔거나 중개하지 않는다 — 사용자마다 자기 PC의 자기 로그인으로 돈다. 그래서 기본이 `127.0.0.1`이고, 바깥에 열어 남이 쓰게 하면 안 된다.
3. 로그인 정보·토큰을 읽지도 보관하지도 중개하지도 않는다 — 인증 파일을 열지 말 것. 토큰을 꺼내 API를 직접 부르면 문서가 금지하는 길이다.

- 문서는 제품 안에서 Claude Code를 돌릴 때 **배포하는 쪽의** 상업용 약관(Commercial Terms) 동의도 조건으로 둔다. Console 계정을 만들 때 동의하는 API·개발자 약관이고, 돈을 버는지와 상관없다.
- 같은 문서는 제3자 개발자가 구독 자격 증명으로 요청을 대신 보내는 것(`route requests through ... plan credentials on behalf of their users`)을 금지하고, 뒤에서 사용자가 고치지 않은 Claude Code에 자기 구독으로 로그인하는 것은 막지 않는다고 적는다. 다리는 뒤쪽 문장에 기대는 해석이고 Anthropic의 확인을 받은 것이 아니다. 문서는 사전 통보 없는 조치 권한도 남겨 두었다. "규정상 문제없다"고 단정하지 말고 "문서 조건에 맞췄다"까지만 말할 것.
- 구독 한도는 평범한 개인 사용(`ordinary, individual usage`)을 전제한다. 다리가 RP까지 도는 범용 API처럼 쓰이면 위 해석이 약해진다. OpenAI 호환이라 커스텀 모델로 꽂는 것을 기술적으로 막지는 못하니, 안내에서 권하지 말 것.
- `Claude Code` 이름은 설명으로만 쓴다("Claude Code를 실행한다"). 제품·기능 이름이나 파일 이름에 넣지 않는다 — zip이 `SimCore-bridge`인 이유다.
- ⚠ 문서에 `--bare`가 앞으로 `-p`의 기본이 된다고 예고돼 있다. bare는 구독 로그인을 읽지 않으니 그 판이 나오면 구독 길이 멈출 수 있다. 공지가 "업데이트로 갑자기 안 될 수 있다"고 말하는 이유다.
- Codex는 `codex exec`가 공식 비대화 명령이다. 제3자 프로그램이 실행하는 경우를 직접 다룬 OpenAI 문구는 찾지 못했다.

## 테스트

`테스트/test-clibridge.js` — 가짜 Claude Code·Codex(`테스트/_fake-claude.js`, `_fake-codex.js`)로 다리를 띄워 엔드포인트·격리 플래그·평탄화·오류 문구·스트리밍·플러그인 쪽 호출 경로를 본다. 진짜 구독 할당량은 안 쓴다.
