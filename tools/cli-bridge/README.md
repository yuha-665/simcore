# SimCore CLI 다리 — 이 PC의 Claude Code · Codex로 봇 만들기

SimCore 편집기의 AI 어시스턴트(스키마 생성·💬 대화·에셋 변환·꾸미기)를 리수의 API 모델 대신
**이 PC에 깔린 Claude Code(구독)** 또는 **Codex(ChatGPT 로그인)** 로 돌린다. API 키가 필요 없다.
RP 채팅은 그대로 리수 모델이다 — 이 다리는 편집기 생성에만 쓰인다.

## 되는 곳 · 안 되는 곳

| 환경 | 되나 | 비고 |
|---|---|---|
| 리수 데스크톱 (Tauri) | ✅ | 플러그인의 `nativeFetch`가 네이티브로 localhost에 간다 |
| 리수 셀프호스트 (Node 서버, 같은 PC) | ✅ | 서버 쪽 프록시가 localhost를 부른다 |
| 웹 리수 (risuai.xyz) | ⚠ | 기본은 리수 프록시 서버를 거쳐서 localhost에 못 간다. 설정의 **plain fetch**를 켜면 브라우저가 직접 부른다 |
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
- Codex는 빈 임시 폴더에서 읽기 전용·기록 없이(`--ephemeral`) 돌린다.
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

## 자주 나는 오류

- **로그인되어 있지 않아요** — 터미널에서 `claude` 한 번 실행해 로그인하거나 VS Code 확장에서 로그인. 전역 환경변수 `ANTHROPIC_API_KEY`가 있으면 구독 대신 키를 잡으려 하니 지운다 (다리는 자식 프로세스에서 지우지만 로그인 자체가 키 모드면 안 된다).
- **구독 사용 한도** — 5시간·7일 창이 찼다. 기다리거나 생성 모델을 보조 모델로 돌린다.
- **포트를 못 열었어요** — 다른 다리가 이미 켜져 있다. 그 창을 쓰면 된다.

## 테스트

`테스트/test-clibridge.js` — 가짜 Claude Code·Codex(`테스트/_fake-claude.js`, `_fake-codex.js`)로 다리를 띄워 엔드포인트·격리 플래그·평탄화·오류 문구·스트리밍·플러그인 쪽 호출 경로를 본다. 진짜 구독 할당량은 안 쓴다.
