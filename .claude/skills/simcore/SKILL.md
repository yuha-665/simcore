---
name: simcore
description: RisuAI/PocketRisu용 시뮬레이션 엔진 플러그인 SimCore의 개발·유지보수 레퍼런스. 스키마 필드, 편집기 UI 구조, 내장 템플릿 11종 실측표, 리수 내부 확정 사실, 아카라이브 배포글 규격을 담는다. simcore.plugin.js를 고치거나, 베리디아 남작령 같은 SimCore 봇 스키마를 만들거나, SimCore 가이드/패치글을 쓸 때 사용.
---

# SimCore — 시뮬 엔진 플러그인

봇에 **숫자로 굴러가는 상태**를 붙이는 RisuAI 플러그인. 스키마 하나로 변수·파생·규칙·이벤트·상태창을
정의하면, 메인 모델에는 상태 블록을, 보조 모델에는 갱신 지시를 내보낸다.

## 파일 위치 (실수 잦음)

| | |
|---|---|
| **소스** (v0.39부터 로컬에 있음) | `E:\0.리수봇\simcore\core\*.js` (엔진 모듈 10개) + `adapter\risu-plugin.js` (헤더·버전·체인지로그) |
| 번들 = 빌드 산출물 | `E:\0.리수봇\simcore\simcore.plugin.js` — 리수에 임포트하는 것. `node build.js` 산출물과 **바이트 일치** 유지 |
| 테스트 | `simcore\테스트\test-*.js` (로컬 실측 28종) + `test\run-tests.js` (코어 단위, Node만 필요) |
| 베리디아 봇 | `simcore\베리디아\estate-vars.js` (생성기 — **여기만 고친다**) |
| 배포글 | `simcore\배포\*.html` |
| 임포트용 사본 | `E:\0.리수봇\플러그인\simcore.plugin.js` — 번들 갱신 시 여기도 같이 교체 |
| ⚠ 손대지 말 것 | `simcore\이전판\` (백업), `dist\`·`playground.html` (빌드 산출물) |

**소스를 고쳤으면** `node build.js` → `dist\simcore.plugin.js`를 번들 자리에 복사.
**번들을 직접 고쳤으면** `node tools/unbundle.js simcore.plugin.js`로 소스에 역반영 →
`node build.js` → `cmp dist/simcore.plugin.js simcore.plugin.js` 바이트 일치 확인. (상세: `SOURCES.md`)

`E:\0.리수봇\simcore`는 **`yuha-665/simcore`(비공개) 리포 그 자체**다 — 고치면 커밋·푸시까지.
회사 clone(`C:\claude\simcore`)·cowork(GitHub 커넥터)에서는 같은 경로를 리포 루트 기준으로 읽는다.

## 고치고 나면 반드시

```bash
cd E:/0.리수봇/simcore
node build.js && cmp dist/simcore.plugin.js simcore.plugin.js      # 소스↔번들 일치
node test/run-tests.js                                             # 코어 단위 (통과 N / 실패 0)
cd 테스트 && for f in test-*.js; do node "$f"; done                # 전부 0 failed
cd ../베리디아 && node estate-vars.js                              # 검증: 통과 / 미치환 없음
```

`//@version` 과 `//@display-name` 을 **같이** 올린다. 배포받은 사람이 자기가 고친 빌드를 받았는지
확인할 수 있는 자리는 플러그인 목록의 display-name 뿐이다.

**유저에게 "다시 임포트하세요"를 반드시 말할 것.** 파일만 고치면 리수에서 도는 건 옛 빌드다.
(실제 사고: 방금 추가한 UI를 유저가 못 찾아 한참 헤맴)

## 상세 문서

| 문서 | 내용 |
|---|---|
| [references/schema.md](references/schema.md) | 스키마 전 필드 · 타입 · 검증 규칙 · 표현식 문법 |
| [references/editor.md](references/editor.md) | 편집기 9개 탭의 UI 라벨과 가져오기 동작 (`TAB_SLICES`) |
| [references/templates.md](references/templates.md) | 내장 템플릿 11종 실측표 — 뭘 열고 뭘 닫았나 |
| [references/risu-facts.md](references/risu-facts.md) | 리수 내부 확정 사실 (소스맵 검증) — 여기 어긋나면 조용히 깨진다 |
| [references/publishing.md](references/publishing.md) | 아카라이브 배포글·가이드 시리즈 규격과 현황 |

## 절대 하면 안 되는 것

1. **`beforeRequest` 리플레이서에서 `type`을 안 보는 것.** 앱의 **모든** LLM 요청에 걸리므로
   `type !== 'model'`이면 아무것도 얹지 말 것. (v0.37.2 사고 — 남의 플러그인·모듈·번역기를 죽였다)
2. **보조 호출을 system 한 통으로 보내는 것.** 구글 계열에서 죽는다. 짧은 user 턴을 붙일 것.
   (v0.37.1 사고)
3. **엔진에만 기능을 넣고 편집기 칸을 안 만드는 것.** AI 설정 탭은 규격 내보내기도 없어서
   칸이 없으면 JSON 손편집 말고는 방법이 없다. v0.35 `cmd`, v0.37 `mentions` 두 번 반복한 사고다.
4. **상태창 HTML에 고정 `id`/`name`을 박는 것.** 상태창은 마커가 달린 **메시지마다** 그려진다.
   메시지 번호(`{uid}`)를 섞지 않으면 최신 글의 탭이 맨 위 글을 건드린다.
5. **새 진단 체크를 전체 템플릿에 돌려 보지 않고 넣는 것.** 규격서가 가르친 패턴을 진단이 결함으로
   신고한 적이 두 번 있다(v0.28 값 자르기, v0.30 프리셋 키 집합). **오탐 0을 확인하고 넣을 것.**
   정적 분석으로 의도를 추측하느니 실제로 굴려서 재는 쪽이 거의 항상 낫다.
6. **`Risuai.alert/alertConfirm`을 패널이 떠 있을 때 쓰는 것.** 우리 iframe이 덮어 보이지도
   눌리지도 않고, `alertConfirm`은 조용히 falsy로 떨어져 "취소"와 구분이 안 된다.
   패널이 열린 동안의 확인은 **패널 자체 UI**로 받을 것(두 번 누르기 등).

## 설계 원칙 (봇 스키마를 만들 때)

- **로어북 = 안 변하는 것**(설정·이유·어휘), **변수 = 플레이가 남긴 흔적.**
  로어북에 "At the start …"라고 적히는 순간 그건 변수 자리다.
- **시스템은 "무엇이 나올 차례"까지, 그게 뭔지는 서사가.**
- **지시문은 AI가 모르는 것만 말한다.** 상태 블록을 되풀이하거나 행동을 강제하면 뺀다.
- **자주 변하는 숫자는 목록 항목에 넣지 않는다.** 목록 끝자리 숫자는 안 변하는 값 전용.
- **금화 상한은 비대칭이다.** 지어낸 수입은 경제를 영구히 망가뜨리지만 손실은 min 0이 받쳐 준다.
- **난이도는 이벤트를 켜고 끄는 게 아니라 문턱을 미는 것.** 끄면 쉬움에서 300턴을 굴려도 그
  이벤트를 못 본다. "시련" 같은 변수를 조건에 섞어 확률을 민다.
