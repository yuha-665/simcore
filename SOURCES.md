# SimCore 소스 트리

`simcore.plugin.js`(배포 번들)의 원본 소스. **`node build.js` 산출물(`dist/simcore.plugin.js`)이
리포의 번들과 바이트 단위로 일치**하도록 유지한다.

## 구조

| 경로 | 내용 |
|---|---|
| `core/*.js` | 엔진 모듈 20개 — `build.js` `CORE` 순서: expr, rng, store, time, fight, validate, assets, party, calendar, scenario, board, messenger, shop, patch, engine, render, session, diagnose, editor, templates (새 모듈은 `CORE`에 넣어야 번들에 실린다) |
| `adapter/risu-plugin.js` | 리스 어댑터 — `//@` 헤더 + 플러그인 본문 (버전·체인지로그도 여기) |
| `build.js` | 번들러. `node build.js` → `dist/simcore.plugin.js` + `playground.html` |
| `tools/unbundle.js` | **역추출기.** 번들을 직접 수정한 판본을 소스로 되돌린다: `node tools/unbundle.js <번들>` |
| `test/` | 테스트 (아래) |

## 작업 규약 (로컬 직수정 ↔ 소스 동기화)

로컬에서 번들(`simcore.plugin.js`)을 직접 고치는 워크플로를 쓰는 경우:

1. 번들 수정 후 리포에 반영할 때 → `node tools/unbundle.js simcore.plugin.js` 로 소스에 역반영
2. `node build.js` → `cmp dist/simcore.plugin.js simcore.plugin.js` 로 **바이트 일치 확인** (다르면 역추출 실패)
3. 소스를 고쳤을 때는 반대로 `node build.js` 산출물을 번들 자리에 복사

버전 올릴 때 `//@version`과 `//@display-name`을 같이 올린다 (adapter/risu-plugin.js 최상단).

## 테스트

```bash
node test/run-tests.js          # 코어 단위 테스트 (Node만 있으면 됨)
node test/smoke-plugin-mock.js  # 모의 리스 API 위 통합 스모크 (playwright 필요)
node test/smoke-playground.js   # 플레이그라운드 UI 스모크 (playwright 필요)
node test/check-lua-bridge.js   # 생성 루아 브리지 문법 검증 (playwright + luaparse 필요)
```

playwright/luaparse는 `npm i --no-save playwright luaparse` 후 사용.
(별도 로컬 실측 테스트 `테스트/test-*.js`가 있다면 그쪽도 함께 돌릴 것.)
