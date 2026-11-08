# SimCore 소스 트리

`simcore.plugin.js`(배포 번들)의 원본 소스. **`node build.js` 산출물(`dist/simcore.plugin.js`)이
리포의 번들과 바이트 단위로 일치**하도록 유지한다.

## 구조

| 경로 | 내용 |
|---|---|
| `core/*.js` | 엔진 모듈 23개 — `build.js` `CORE` 순서: expr, rng, store, time, fight, validate, assets, party, calendar, scenario, board, messenger, shop, quest, choice, secret, patch, engine, render, session, diagnose, editor, templates (새 모듈은 `CORE`에 넣어야 번들에 실린다) |
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

## 빌려 온 것

| 자리 | 출처 | 라이선스 | 어떻게 |
|---|---|---|---|
| `core/editor.js` `STATUS_DESIGN_GUIDE`·`STATUS_DESIGN_LAYOUT` (v1.22.0) | [Hallmark](https://github.com/Nutlope/hallmark) (Nutlope / Together AI) · [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | MIT · Apache-2.0 | 상태창에 해당하는 원칙만 골라 한국어로 **새로 썼다** (원문 전재 없음). 웹 페이지용 절(히어로·스크롤·사진)은 뺐다 |
| `core/editor.js` `STATUS_MATERIALS` 재질 10종 (v1.22.0) | Hallmark `skills/hallmark/references/themes/` — almanac·vellum·newsprint·darkroom·terminal·blueprint·garden·kiln·sticker·midnight (커밋 407fa68, 2026-11-05) | MIT — Copyright (c) 2026 Hallmark contributors | 테마의 재질 설명과 색 토큰(oklch → hex)을 상태창 클래스에 옮기고, 웹폰트를 기기 글꼴로 바꿨다. CSS는 새로 짰다 |

Hallmark MIT 고지: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction … The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software. (전문: https://github.com/Nutlope/hallmark/blob/main/LICENSE)
