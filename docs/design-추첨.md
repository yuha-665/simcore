# 설계 — 추첨 효과 (후보 풀에서 N개를 목록 변수에)

> 2026-10-10, 커뮤니티 피드백 → 유저 결정("이대로 진행해줘"). **v1.18.0 구현.** 코어 `core/sample.js`(순수), 효과는 `applySets`의 한 분기.

## 0. 발단 (피드백 원문 요지)

"섹못방 같은 봇을 일상용으로 만들어 NPC 목록과 캐릭터 풀을 두고 — 거주지에 N명, 특정 장소로 이동할 때 몇 명, 현재 등장 인물 4명 제한 —
변수로만 하는데, 거주지 N명 로스터를 맨 처음 만들 때 기존 방식은 가챠풀이라 같은 이름을 수백 번 넣게 된다."
요청: 목록 변수에 대한 랜덤 샘플링 · 후보 풀에서 N개 중복 없이 · 후보별 가중치 · 이미 뽑힌 항목과의 관계로 가중치 보정(같은 그룹끼리 같이
뽑히기 쉽게, 너무 많으면 감쇠·최대 인원) · 강제 묶음이 아닌 확률 보정 · 결과는 list 변수에 · 대표/리더를 별도 변수에 · 엔진 RNG(LLM이 이름을
안 짓게) · 풀에 없는 값이 안 들어가게 · 새 채팅·특정 이벤트에서 한 번만 · 파티·주민·학급·길드·등장인물에 두루.

## 1. 지금 엔진으로 안 됐던 이유

목록 효과 `{ list, add, remove, expire }`의 `add`는 **글자 그대로**다 — 식도 추첨도 없다. 그래서 랜덤 이벤트 표에 같은 이름을 수백 번 넣는
가챠풀이 유일한 길이었고, 그마저 중복 없이 N명은 안 됐다. 부품은 다 있었다: 시드 RNG(리롤 안정), 가중 추첨(`fight.pickWeighted`·랜덤
이벤트 weight), `once` 이벤트, 모듈 효과를 꽂는 자리(`{ front }`·`{ gauge }`·`{ checkpoint }`).

## 2. 모양

```json
{ "pools": [ { "id": "npc_pool", "label": "마을 주민 후보",
    "items": [ { "name": "아린", "weight": 2, "group": "경비대" }, "브란", { "name": "세실", "group": "상인" } ],
    "groups": { "경비대": { "affinity": 1.5, "max": 2 }, "상인": { "affinity": 0.5 } } } ],
  "rules": { "events": [ { "id": "seed_residents", "when": "count(residents) == 0", "once": true,
    "effects": [ { "sample": "npc_pool", "into": "residents", "n": 8, "leader": "mayor", "stable": true } ] } ] },
  "actions": [ { "id": "go_market", "label": "🏪 시장에 간다",
    "effects": [ { "sample": "residents", "into": "present", "n": 4, "stable": false } ] } ] }
```

| 자리 | 뜻 |
|---|---|
| `pools[]` | **스키마**(안 변하는 것). `id`(영문, 변수 id와 못 겹침), `label`, `items[]`(`{ name, weight?, group? }` 또는 이름 문자열), `groups`(그룹별 `affinity`·`max`) |
| `{ sample }` | 풀 id **또는 list 변수 id** — 목록이면 그 항목이 후보(가중치·그룹은 풀들에서 이름으로 찾는다 — "로스터 30명 중 지금 자리에 4명") |
| `into` | 뽑힌 이름이 들어갈 list 변수. `append`가 아니면 통째로 새 명단 (목록 효과의 "통째 교체 금지"는 add 얘기 — 추첨은 명단을 만드는 효과라 교체가 뜻이다) |
| `n` | 숫자 또는 식(`count(residents) - 1`). `into.maxItems`를 넘지 않는다(append면 남은 칸) |
| `leader` | 첫 당첨(이미 무작위)을 text/enum 변수에. enum이면 검증이 풀 이름 전부를 enum과 대조 |
| `exclude` | 그 list 변수에 있는 이름은 안 뽑는다 (죽은 사람·떠난 사람 목록) |
| `append` | 있는 항목 뒤에 덧붙인다 — 이미 있는 이름은 안 뽑는다 |
| `stable` | `true` 고정(시드 — 리롤해도 같은 명단) / `false` 리롤마다 새로 / 없으면 전역 `rerollStableRng` |

## 3. 추첨 규칙 (가중 비복원 순차)

하나 뽑을 때마다 남은 후보의 가중치를 다시 센다: `w = weight` → 같은 그룹이 이미 뽑혀 있으면 `× affinity` → 그 그룹이 `max`에 닿았으면 `0`.
총 가중치 비례로 하나 뽑고 뺀다. 총 가중치가 0이면 거기서 멈춘다(n보다 적게 뽑힐 수 있다). 가중치 0은 안 뽑힌다.
**확률 보정이지 강제 묶음이 아니다** — affinity 1.5면 같은 그룹이 같이 올 확률이 오르고, 0.5면 흩어진다. 감쇠는 affinity를 1 아래로 두면 된다
(유저 결정: 노브는 affinity·max 둘로 시작).

## 4. 난수 — 효과마다 고정/새로 (유저 결정)

"가챠에 쓸 거면 고정보단 변하는 게 좋고, 아니면 고정이 맞다 — 변수마다 정하는 체크박스". 세션이 턴마다 만드는 `rng`에 `.stable`(시드)·`.free`
(Math.random)를 둘 다 달아 두고(`session._rng`), 효과의 `stable` 칸이 고른다(`sample.pickRng`). 편집기는 셋 중 하나(전역 따름 / 고정 / 새로)
— 체크박스 하나로는 "전역 따름"을 표현할 수 없어서. 진단 시뮬·직접 호출처럼 안 달린 rng는 받은 것 그대로(결정적).
리롤 의미: 리롤하면 그 턴을 이전 스냅샷에서 다시 계산하므로 `once` 이벤트도 다시 발동한다 — "새로"면 새 명단, "고정"이면 같은 명단.

## 5. 어디에 꽂혔나

| 자리 | 무엇 |
|---|---|
| `core/sample.js` | poolsConfig · candidatesFor · drawSample · pickRng · applySampleEffect · effectTargets · validatePools · validateSampleEffect |
| `engine.applySets` | gauge 분기 다음에 sample 분기 (changeLog에 into·leader 변화) |
| `validate` | `checkSet`의 sample 분기 + 끝에 `validatePools`. KNOWN_KEYS에 `pools` 행(AI 필드 사전) + events.effects 설명 |
| `session._rng` | `.stable`/`.free` 부착 |
| `diagnose.writerMap` | 추첨 효과의 into·leader를 쓰기 경로로(고정 변수 오탐 방지) |
| `patch` | `pools`는 패치 병합 미지원(힌트: [변수] 탭 🎲 후보 풀) + 비교 영역 + 변수 이름 바꾸기(sample·into·leader·exclude·n) |
| 편집기 | 두 효과 편집기에 🎲 줄(어디서·몇 개·어디로·대표·빼고·난수·덧붙임) + `[+ 🎲 추첨]`(목록 변수가 있으면), [변수] 탭 맨 아래 🎲 후보 풀 접기(줄 편집: `이름 | 가중치 | 그룹`, `그룹 | 배수 | 최대`), 변수 역색인·삭제 영향·카탈로그·AI 규격서 |

## 6. 함정

1. **이름은 풀에 있는 것만** — 보조 AI가 이 목록을 고치게 하려면 allow에 두고, 아니면 `keep`. 추첨은 엔진이 쓰는 것이라 allow와 무관하게 돈다.
2. **풀 id는 변수 id와 못 겹친다** — `sample`이 풀인지 목록인지 가를 수 없어서(검증 오류).
3. **`maxItems`** — 넘는 만큼은 안 뽑는다. 로스터 상한은 변수에 두는 게 정직하다.
4. **`once` + 조건** — "새 채팅에서 한 번만"은 `once: true` + `when: "count(목록) == 0"`. `setup.presets`는 값만 쓰니 효과 자리가 아니다.
5. **같은 JSON 가져오기 사고와 무관** — 추첨은 캐릭터 객체를 안 건드린다(변수만).
