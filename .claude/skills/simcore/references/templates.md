# 내장 템플릿 16종 실측표 (v0.93.1 기준)

`SimCore.require('templates').TEMPLATES` 에서 뽑은 값. **가이드나 배포글에 예시를 쓸 때 여기서
고를 것** — 지어내면 유저 화면과 안 맞는다.

다시 뽑으려면 (리포 루트에서):

```bash
cd /c/claude/simcore && node -e "
const fs=require('fs');const src=fs.readFileSync('simcore.plugin.js','utf8');
(0,eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {'))+'\n;globalThis.__SC=SimCore;');
const {TEMPLATES}=globalThis.__SC.require('templates');
// 필요한 것만 골라 출력. 랜덤 이벤트 풀은 rules.randomEvents.table
"
```

## 전체표

| id | vars | derived | allow | 틱/이벤트/랜덤 | 지시문 | 액션 | 프리셋 | 그룹 | 최초설정 | 랜덤% | 시간 | 파티(탭) | 에셋 | 판정 | 시나리오 |
|---|--:|--:|--:|---|--:|--:|--:|--:|:-:|--:|:-:|:-:|:-:|--:|:-:|
| blank | 1 | 0 | 1 | 0/0/0 | 0 | 0 | 0 | 1 | ✕ | 0 | ✕ | ✕ | ✕ | 0 | ✕ |
| daily | 7 | 1 | 6 | 0/1/12 | 4 | 2 | 3 | 2 | ○ | 30 | ○ | ✕ | ✕ | 0 | ✕ |
| rpg | 16 | 3 | 10 | 0/4/3 | 3 | 2 | 2 | 6 | ○ | 15 | ✕ | 2 | ✕ | 0 | 3막 |
| estate | 9 | 2 | 7 | 3/3/2 | 2 | 2 | 3 | 3 | ○ | 25 | ✕ | ✕ | ✕ | 0 | ✕ |
| mystery | 9 | 2 | 6 | 2/4/4 | 4 | 3 | 3 | 3 | ○ | 30 | ✕ | ✕ | ✕ | 0 | ✕ |
| business | 10 | 7 | 6 | 4/4/4 | 3 | 4 | 3 | 3 | ○ | 30 | ✕ | ✕ | ✕ | 0 | ✕ |
| survival | 12 | 9 | 8 | 6/7/5 | 4 | 6 | 3 | 4 | ○ | 35 | ○ | ✕ | ✕ | 0 | ✕ |
| politics | 16 | 4 | 10 | 4/6/5 | 5 | 6 | 3 | 4 | ○ | 35 | ✕ | ✕ | ✕ | 0 | ✕ |
| romance | 13 | 1 | 10 | 3/7/4 | 7 | 4 | 4 | 3 | ○ | 35 | ○ | ✕ | ○ | 0 | ✕ |
| trpg | 12 | 4 | 6 | 2/3/3 | 3 | 3 | 4 | 3 | ○ | 22 | ✕ | ✕ | ✕ | 2 | ✕ |
| vtuber | 16 | 10 | 8 | 7/7/9 | 7 | 8 | 3 | 5 | ○ | 40 | ○ | ✕ | ✕ | 0 | ✕ |
| smith | 11 | 3 | 8 | 1/2/6 | 3 | 5 | 3 | 3 | ○ | 25 | ✕ | ✕ | ✕ | 1 | ✕ |
| fleet | 10 | 0 | 6 | 0/0/2 | 2 | 3 | 3 | 4 | ○ | 12 | ✕ | 3 | ✕ | 0 | ✕ |
| delve | 18 | 4 | 8 | 5/1/5 | 5 | 9 | 3 | 4 | ○ | 40 | ✕ | 2 | ✕ | 2 | ✕ |
| zombie | 16 | 5 | 10 | 0/3/5 | 5 | 8 | 3 | 4 | ○ | 30 | ○ | 2 | ✕ | 1 | ✕ |
| idol | 66 | 55 | 18 | 4/16/24 | 13 | 83 | 3 | 8 | ○ | 35 | ○ | 13 | ✕ | 32 | ✕ |

- 그룹은 전 템플릿 `mode: auto`. 랜덤 이벤트 풀은 `rules.randomEvents.table`(구 events 키 아님).
- **derived 0은 fleet뿐** (파생 없이 vars·파티 탭만으로 돌아간다). **idol은 전 축 최대급**
  (vars 66 / derived 55 / 액션 83 / 판정 32 / 탭 13) — 규모 감각의 상한 예시로 쓸 것.
- **시나리오는 rpg 하나뿐** ('무너진 봉인' 3막, 아래 실물 예시 참조).
- **에셋은 romance 하나뿐** (partner 팩, `enabled: false` 출고 — 인물 Hana × 감정 6종
  normal/smile/shy/angry/sad/surprised 슬롯, `<img="{name}">` 포맷 예시).
- **달력 패널은 romance(📅 달력, 생일·모임 marks)와 idol(📅 스케줄, 주간 라디오·월말 정산 marks)** 둘.

**`cmd`(채팅 명령)는 3종 5개** — trpg `/능력`(check_stat enum, v0.43 — 상시 판정과 한 세트),
fleet `/태세`(alert enum)·`/가동`(active)·`/손상`(damaged), zombie `/장소`(place enum).
전부 변수에 붙는 var-cmd다. 나머지 13종은 0개 — 가이드에서 이 대비를 반드시 짚어야 한다.
템플릿 사용자는 우상단 버튼은 이미 보고 있지만 `/명령`은 존재조차 모른다.

**`layout` 지정은 3종** — delve `tabs`, zombie `accordion`, idol `tabs`. 나머지 13종은
미지정(=stack)이라, v0.38 레이아웃 기능의 실물 예시는 이 셋에서 골라야 한다.

## 허용(allow)에서 일부러 뺀 변수 — 설계 의도의 결정체

| 템플릿 | 뺀 것 | 왜 |
|---|---|---|
| daily | (`skip_day` 자체를 안 만듦) | **날짜는 버튼으로만** (`💤`). v0.51부터 변수를 아예 안 둬서 구조로 막는다 — AI는 `skip_min`(그날 안에서 흐른 분)만 보고한다 |
| rpg | `level` `front` `rear` `sp` `skill_sword` `skill_heal` | exp에서 규칙이 올려 줌 / **편성 슬롯**(파티 탭이 관리) / **수련 포인트·트리**(포인트 소비 UI가 관리) |
| estate | `turn` `famine` | 카운터 / 이벤트 플래그 |
| mystery | `scene` `truth` `solved` | 카운터 / **숨긴 정답** / 진행 플래그 |
| business | `month` `price` `district` `crisis` | 카운터 / 플레이어 정책 / 플래그 |
| survival | `heat` `ration` `shelter` `collapsed` | 카운터 / 플레이어 정책 / 플래그 |
| politics | `week` `econ` `bill_roll` `bill_result` `in_scandal` `ousted` | 카운터 / **주사위·판정** / 플래그 |
| romance | `stage` `confessed` | 카운터 / 관계 단계 / 플래그 |
| trpg | `str` `dex` `wit` `cha` `adv` `dmg` | **캐릭터 시트 + 판정 부속.** 판정 결과 자체(roll/total/grade)는 v0.40부터 변수가 아니라 meta — 뺄 것도 없이 원천 차단 |
| vtuber | `subs` `stream_hours` `editor` `concept` `trend_seed` `burnout` `in_scandal` `career_over` | 카운터 / 규칙 산출값 / 플래그 |
| smith | `skill` `stoked` `noble_next` | 캐릭터 시트 / 판정 소모품(액션·이벤트가 관리) / 의뢰 문턱(선택이 올린다) |
| fleet | `flag` `ship2` `ship3` `dock1` | **편성·정비창 슬롯 전부** — 파티 탭이 관리, 보조 AI 손 못 댐 |
| delve | `depth` `stairs` `anchor` `wound` `front1` `front2` `back1` `back2` `gold` `best_depth` | 카운터·기록 / 플래그 / **진형 슬롯 4**(파티 탭) / 골드는 액션·판정이 관리 |
| zombie | `bitten` `dead` `barricade` `scout1` `scout2` `guard1` | 감염·사망 플래그 / 방벽(액션이 관리) / **탐색조·야간 슬롯**(파티 탭) |
| idol | 48개 (allow 18개만 개방) | 멤버 시트(`m1_vo`…`m3_fan`), 장부·수익 분해(`funds` `debt` `inc_*` `sales`), 편성 슬롯(`center` `side1/2`), 랭크·판정·플래그 전부 잠금. 열린 건 버즈·인지도·팬·멤버 기분/애정·스케줄·큐·요청·날씨·보유곡·의상뿐 |

패턴: **카운터 · 주사위/판정값 · 이벤트 플래그 · 플레이어가 고르는 정책 · 숨긴 정답 · 파티 슬롯**은 안 연다.

⚠ 규칙이 쓰는 변수와 allow는 **규칙이 있는 템플릿 전부에서 겹친다** (estate `food`, rpg `hp` …).
"규칙이 쓰면 빼라"가 아니라 "서사에 안 나타나면 빼라"가 기준이다.

`whenArmed`(액션 잠금, v0.39)는 **3종** — smith `vault`←[deposit, withdraw](장부 둘, 입출금 버튼
턴에만 개방), delve `roster`←[recruit](술집 영입 턴에만 동료 목록 개방), zombie `crew`←[nightfall]
(밤 넘기기 턴에만 인원 명단 개방).

`checks`(판정, v0.40)는 **trpg 2**(ck_free 자유 판정 + ck_attack) + **smith 1**(ck_forge — 액션과
랜덤 이벤트가 하나를 나눠 쓰는 예시) + **delve 2**(ck_delve — 어둠이면 불리굴림 `min(rand,rand)`,
vs가 변수 `danger` / ck_trap vs `danger + 3`) + **zombie 1**(ck_scavenge — 밤이면 불리굴림, vs가
장소별 3항 중첩 `병원 15 > 주유소 13 > 상가 11 > 기본 9`) + **idol 32**(무대·일감 판정 20종
ck_stage/ck_live/ck_venus/방송·지방·음지… + **레슨 트리 티어 판정 12종** `ck_ls_{vo,da,vi}_t{1..4}`).
vs에 변수·조건식이 들어가는 실물은 delve/zombie에서 고를 것.

`suggest`(다음 행동 제안, v0.43)는 **4종** — smith / delve / zombie / idol, 전부 count 3.
가이드 문장이 각각 달라 실물 예시로 좋다 (zombie: "하나는 소리를 덜 내는 쪽으로", idol: "하나는
사람을 챙기는 쪽으로").

`choices`(갈림길, v0.41)는 **daily 1**(stray_cat, timeout 2) + **smith 2**(noble_offer 조건 /
peddler 랜덤) + **delve 1**(big_one — 노획 도박) + **zombie 2**(stranger / the_horde) +
**idol 5**(quarrel / shady_photo / collector / scandal / sudden_offer — 최다).

**smith는 v0.39~0.43 신기능 총집합**이었고, 지금은 **신규 3종(delve/zombie/idol, v0.67~0.69)**이
그 역할을 물려받았다 — layout·whenArmed·checks(변수 vs)·suggest·choices를 전부 실기로 쓴다.
새 기능을 만져 볼 때는 delve(중형) 또는 idol(대형)을 고르면 된다.

## 시간 체계를 쓰는 템플릿 (v0.49~)

| 템플릿 | advance | start | 표시 | 진행 입구 |
|---|---|---|---|---|
| romance | explicit | 2026-03-02 08:30 (월) | M월 D일 / HH:mm | skip_day(≤7) · skip_min(≤720) + 🌙 하루 경계 넘김(v0.99: day_break→wake_at→sync 이벤트) |
| daily | explicit | 2026-05-18 08:00 (월) | M월 D일 / HH:mm | skip_min(≤240)만 + 🕐 2시간 · 💤 다음 08:00 |
| survival | perTurn | 2026-12-01 07:00 (화) | M월 D일 | 없음 (턴마다 하루) |
| vtuber | perTurn | 2026-03-02 20:00 (월) | M월 D일 | 없음 (턴마다 하루) |
| zombie | explicit | 2026-08-14 07:00 (금) | M월 D일 / HH:mm | skip_min(≤240) + 🌙 밤을 넘긴다 (calendar: gregorian) |
| idol | explicit | 2026-04-06 (월) | YYYY-MM-DD (날짜만, 시계 없음) | **skip_day가 allow에 없다** — 🌙 하루를 마친다 버튼만 (calendar: gregorian) |

idol은 daily의 "날짜는 버튼으로만" 선언의 반대편 구현 — 변수(`skip_day`)는 있되 allow에서 빼서
버튼 전용으로 묶었다. 표시용 "N일차"는 perTurn 쪽에서 파생 `day_no = elapsed + 1`(+format
`{v}일차`)로 만든다 — 파생이라 읽기 전용이고 epoch 하나에서 나오므로 옛 `day` 변수처럼 따로 놀
수가 없다. 남은 손 카운터는 business `month`·politics `week` 둘뿐 (perTurn이 1일/턴 고정이라
표현 불가 — 알려진 한계, docs/ai-mistakes.md). `테스트/test-timetpl.js`가 이 둘을 예외 처리하므로
셋째가 생기면 잡힌다.

## 자주 인용하는 실물 예시

### estate — rules
```
매 턴 자동   turn = turn + 1 / gold = gold + net_income / food = food - food_need
조건 이벤트   famine_start : food <= 0 and not famine
             → famine=1, loyalty-10, population - round(population*0.05)
             notify "식량이 바닥나 기근이 시작되었다…"
             famine_end : food > food_need * 2 and famine → famine=0
랜덤(25%)    bandits  weight 3  cooldown 6  when military < 150
             → gold = gold - rand(50,150)   notify "산적 무리가 상단을 습격…"
             merchant weight 2  cooldown 4  (효과 없이 notify만)
지시문        famine → "[상태] 기근이 계속되고 있다. 거리의 굶주림, 흉흉한 민심…"
             gold < 100 → "[상태] 금고가 거의 바닥났다 ({gold}G)…"
그룹          내정 / 군사 / 상황
```

### rpg — 파티 편성 + 수련 트리 + 시나리오 (v0.93 확장)
```
🏕 휴식        oneshot  cooldown 2
              inject "[플레이어 액션] 모닥불을 피우고 휴식을 취한다."
              hp = min(hp + round(max_hp*0.5), max_hp) / mp 동일
🧪 회복약 사용  oneshot  when has(inventory, '회복약')
              inject "[플레이어 액션] 회복약을 마신다."
              inventory remove ['회복약'] / hp = min(hp+50, max_hp)
allow 한도     hp 60 / mp 40 / exp 80 / gold 300 / weapon·armor 30자 / location 50 / condition 40
              + 리스트 inventory·allies (동료 영입은 보조 AI가 allies에 적고, 편성은 파티 탭)
파티(⚔️ 편성)  main 탭: 슬롯 전위(front)·후위(rear), roster = allies
              train 탭: 포인트 sp — skill_sword(cost 1) → skill_heal(cost 1,
              requires "skill_sword >= 2", 라벨 "검술 2 필요") — **되돌릴 수 없는 트리의 최소 실물**
프리셋         신참 모험가 = {}  (빈 프리셋 — 기본 시작값)
              베테랑 용병 = level 5, gold 500, 강철 장검, 사슬 갑옷, 회복약×2 + 낡은 지도
그룹          전투 / 성장 / 소지 / 편성 / 수련 / 위치
```

### rpg — scenario '무너진 봉인' 3막 (v0.93, 유일한 시나리오 실물)
```
1막 여로의 시작   intensity 잠복 — unlock 없음(시작 막)
                secret "변경의 마물 준동은 우연이 아니다 — 옛 봉인이 안쪽에서부터 삭고 있다."
2막 그림자의 조짐  unlock "level >= 3 or scn_turns >= 8"   minTurns 5   intensity 전개
                onEnter: inventory add ['금이 간 인장'] + notify
                secret "봉인을 삭게 만든 것은 … 감시탑 쪽이다."
3막 결전         unlock "level >= 5 or scn_turns >= 10"   minTurns 6   intensity 절정
                notify "봉인의 심장부에 도착했다. 되돌아갈 길은 없다."
```
**unlock 정석 패턴 = `성장 조건 or scn_turns >= N`** — 잘 크면 성장으로, 못 크면 턴수로 어차피
열린다(진행 보증). `scn_turns`는 변수가 아니라 시나리오 엔진이 세는 내장 카운터고, secret은
현재 막에서만 AI에게 몰래 주입된다.

### daily — 유일하게 틱이 없는 템플릿 (v0.51에서 진짜 시계로)
```
설계 반전   매 턴 자동 처리를 일부러 비웠다. 일상물에서 한 턴은 하루도 한 시간도 아니다 —
           카페에서 세 턴 떠들었다고 저녁이 되면 안 된다.
time       start 2026-05-18 08:00(월) · advance explicit · M월 D일 / HH:mm
           옛 시간대 enum(새벽~밤)을 걷고 때(tod)를 hour에서 파생 — 세는 곳이 하나면 안 어긋난다.
           그 전에는 "낮→저녁"에 버튼이 필요했고 그 사이 두 시간을 표현할 방법이 없었다.
액션        🕐 시간을 보낸다 = skip_min 120 · 💤 하루를 마친다 = **하루 경계 넘김 패턴(v0.99)**:
           day_break 깃발 + "시각은 문맥이" inject/지시문 → 보조가 장면의 시간대(wake_at enum)만
           보고 → day_break_sync 이벤트가 다음날 그 시각까지의 분을 계산 (romance도 동일 패턴,
           schema.md time 절 참고. 예전 "다음 08:00 고정"은 야간·교대 서사에서 어긋났다)
skip_day    **일부러 안 만들었다** — "날짜는 버튼으로만"이라는 선언을 구조로 굳힌 것.
           AI는 skip_min만 보고하고 캡 240분이라 한 번에 하루를 못 넘긴다
           (day_break_sync의 next-occurrence 총량도 ≤1440이라 분 하나로 실린다)
startAt     프리셋이 시작 시각을 정한다 (주말=토 13:00 / 월말=29일) — 시계는 예약 키라 set 불가
vars       weather(5종) · place · money · bag · skip_min | 파생 tod(때)
랜덤(30%)  12종 · 사람 3(만남·낯선이·연락) / 사건 4(소동·습득·지출·수입) / 날씨 4 / 갈림길 1
           → 대부분 effects 없이 notify만. 수치를 굴리는 대신 **서사에 소재를 던진다**
           날씨 이벤트는 `when: weather != "비"` 로 같은 날씨 재알림을 막는다
갈림길      stray_cat(길고양이, timeout 2): 쓰다듬는다(inject만) / 먹이를 사준다(when money≥3000,
           money-3000) / 모른 척 지나친다(마지막 — 조건 없음, 타임아웃 자동 결정용)
지시문 3   궂은 날씨 / 늦은 시각(when hour >= 21 or hour < 5) / 수중에 돈 없음
때 파생     hour < 5 ? "새벽" : (hour < 11 ? "아침" : (hour < 17 ? "낮" : (hour < 21 ? "저녁" : "밤")))
```
관리할 수치가 없는 봇(현대 일상·학원·동거물)에 상태창만 얹고 싶을 때 고른다.

### trpg — checks (v0.40 판정 · v0.43 상시 판정)
```
🎲 상시 판정  auto_roll (hold) + check: ck_free — 켜 둔 동안 **매 전송마다** 굴린다
ck_free     roll 'adv ? …' (이점 공용)   vs dc
            mod 'check_stat == "근력" ? str_mod : (… ? dex_mod : (… ? wit_mod : cha_mod))'
            → 능력 선택은 enum 변수 check_stat: 보조 AI가 장면 따라 유지 + /능력 으로 즉석 지정
              (명령은 전송 시점에 먼저 적용 — 같은 턴 굴림에 반영)
ck_attack   roll 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)'   mod str_mod   vs dc
등급         대성공(roll==20)  → dmg = 2d8+str_mod · inject "압도적인 일격…"
            대실패(roll==1)   → hp -= 1d4 (반격) · inject "반격까지 허용한 대실패…"
            성공(total>=vs)   → dmg = 1d8+str_mod
            실패(기본 — when 없음)
액션         ⚔ 공격 = check: ck_attack + inject "[행동] 무기를 들어 공격한다."
            + effects [stamina-1, adv=0]  ← 정리는 액션 몫 (굴림이 adv를 먼저 읽는다)
이벤트       do_roll (when need_roll, check: ck_free) — 보조 AI가 판정을 요청하면 시스템이 대신 굴린다
            (effects로 adv·need_roll 리셋 — v0.43에서 ck_free로 통합된 뒤의 모습)
onTurn      dmg = 0 (피해량은 판정 턴에만 의미 — 지시문이 눌어붙지 않게)
```
회귀: 구판(v0.39 손조립)과 같은 시드에서 굴림·등급·피해·반격·기력 **시드별 동일값 800/800** 확인.

### smith — v0.39~0.43 신기능 묶음 (v0.42.1, 소형 예시로 여전히 유효)
```
whenArmed   allow의 vault 에 whenArmed: ['deposit','withdraw'] — 입금/출금 버튼이 눌린 턴에만
            보조 AI에게 열린다. 두 액션은 effects 없이 inject 만("얼마를 옮겼는지 장면에서 정해
            말하라") — 액수는 서사가 정하고 기록은 보조가, 귀속은 버튼이 정한다
ck_forge    roll 'stoked ? max(rand(1,20), rand(1,20)) : rand(1,20)'   mod skill_mod   vs dc
            대성공 → fame+3, money += 100+total*2 / 대실패 → iron-1, fame-1
            성공 → money += 30+total*2, fame+1 / 실패(기본)
            🔨 벼려낸다(액션 check) 와 rush_order(랜덤 이벤트 check) 가 같은 판정을 공유
갈림길       noble_offer(조건: fame >= noble_next, timeout 3): 받는다 / 웃돈(when fame>=50 — 🔒
            예시) / 정중히 거절(마지막 = 타임아웃 자동). 조건 이벤트엔 쿨다운이 없으므로 세 선택지
            전부 noble_next = fame+25 로 문턱을 올려 재발동을 스스로 제어 — 이 패턴이 정석이다
            peddler(랜덤, timeout 2): 무쇠를 산다(when money>=80) / 소문(inject만) / 손을 내젓는다
주문 회전    walk_in(랜덤)이 '동네 주문' 추가 + dc 재추첨 → 🔨 벼려낸다의 effects 가 remove 로 하나씩
            처리. 남작가의 예장검은 보조 AI가 지운다(queue desc)
과로         burnout: when 'stamina <= 1' — 매 턴 회복(+1)이 이벤트 판정보다 먼저 돌아서
            0으로 걸면 영영 안 터진다. 문턱 1 + 회복 효과로 조건을 스스로 닫는다
```

### 신규 3종 (v0.67~0.69) — delve / zombie / idol

**delve — 미궁 탐사 (layout: tabs)**
```
루프        원정(진형 탭: 전위 2·후위 2 슬롯 + 🕳 진입/⬆ 귀환) ↔ 지상 탭(삯일·보급·치료·술집 영입)
판정        ck_delve: 어둠이면 min(rand,rand) 불리굴림, vs = danger (변수!) / ck_trap vs danger+3
whenArmed   roster ← [recruit] — 술집에서 사람을 구한 턴에만 동료 목록 개방
갈림길       big_one — 노획 도박 (챙겨 나가느냐 더 파느냐)
액션 9      ⛏ 파헤친다(check) / 🪜 더 내려간다 / 🏕 야영 / ⬆ 귀환 / 🕳 진입 / 🪣 삯일 / 🛒 보급 / 🩹 치료 / 🍺 영입
그룹        탐사 / 일행 / 소지 / 기록  (best_depth 기록형 변수)
```

**zombie — 아포칼립스 (layout: accordion)**
```
시간        explicit + 시계(HH:mm) + gregorian — 낮 수색 / 밤 습격의 2박자.
           skip_min ≤240, 밤은 🌙 밤을 넘긴다 버튼
판정        ck_scavenge: 밤이면 불리굴림, vs = 장소별 조건식 (병원 15 / 주유소 13 / 상가 11 / 기본 9)
           — 장소 선택(/장소 cmd·place enum)이 곧 난이도 선택
whenArmed   crew ← [nightfall] — 밤 넘기기 턴에만 인원 명단 개방
파티        탐색조(낮 2슬롯) / 밤(경계 1슬롯)
갈림길       stranger(낯선 생존자) / the_horde(무리)
```

**idol — 아이돌 프로듀스 (layout: tabs) — v0.81~0.87에 걸쳐 풀게임화, 최대 규모**
```
규모        vars 66(멤버 3인 시트 m1~m3 × vo/da/vi/st/fan 포함) / derived 55 / 액션 83 /
           판정 32 / 랜덤 24 / 이벤트 16 / 지시문 13 / 그룹 8 / 파티 탭 13
탭 13      편성(3슬롯: center/side1/side2) / 레슨 / 일감(의뢰판) / 무대 / 팬서비스 / 제작 /
           굿즈 / 콜라보 / 음지 / 음지 굿즈 / 음지 팬서비스 / 관리 / 사무소
레슨 트리    파티 items로 능력치 직접 구매 — cost가 식: round(stat*stat/25)+30 (오를수록 비싸짐)
           + 티어 판정 ck_ls_{vo,da,vi}_t{1..4} 12종
판정 32    무대·방송·지방·심야·잡지·성인·음지 등 일감별 20종 + 레슨 12종
달력        📅 스케줄 (list: schedule, marks: 주간 라디오(금)·월말 정산(28일))
시간        explicit·날짜만(YYYY-MM-DD)·skip_day는 allow 제외 — 🌙 하루를 마친다 버튼 전용
장부        allow 18/66만 개방 — funds/debt/inc_* 수익 분해는 전부 규칙·정산 이벤트(settle) 몫
갈림길 5    quarrel / shady_photo / collector / scandal / sudden_offer
프리셋      신인 셋 / 한 번 터졌다 / 빚에 눌려 (3단계 난이도)
```

**fleet — 함대 편성 (파티 탭의 최소 실물)**
```
derived 0 · 틱/이벤트 0 — 규칙 거의 없이 파티 탭 3개(출격 편성 3슬롯 / 정비창 1슬롯 / 보급)와
액션 3개(⚓ 출격 / 🔧 수리 / 📦 보급)로 도는 구조 시연용. cmd 3종(/태세 /가동 /손상)은 16종 중 최다
```

### hold(지속형) 액션 — 넷 (신규 4종에는 없음)
```
estate  🛡 순찰 강화     gold = gold - 20        "[지속 정책] 병사들이 순찰을 강화하고 있다."
vtuber  🔴 풀타임 방송   when not burnout
                        stream_hours = min(stream_hours+3, 10) / energy = energy - 4
smith   🪞 다듬질        when stamina >= 2       fame+1 / stamina-1  (매 턴 회복 +1과 상쇄)
trpg    🎲 상시 판정     check: ck_free          hold+check = 켜 둔 동안 매 턴 굴림 (v0.43)
```

### survival — presets (3단계 난이도의 모범)
```
초겨울 — 여유 있게 시작   temp -12  coal 500  food 480  people 45  hope 70
한겨울 — 이미 빠듯함     temp -28  coal 260  food 230  people 38  hope 50  discontent 30
폐허 — 남은 게 거의 없음  temp -34  coal 120  food  90  people 22  hope 30  discontent 45  sick 5
```
같은 3단계 패턴이 idol에도 (신인 셋 / 한 번 터졌다 / 빚에 눌려).

## 그룹 이름 (layout 예시용)

| | |
|---|---|
| rpg | 전투 / 성장 / 소지 / 편성 / 수련 / 위치 |
| estate | 내정 / 군사 / 상황 |
| mystery | 수사 / 인물 / 상황 |
| business | 재무 / 영업 / 가게 |
| survival | 기온 / 비축 / 사람 / 정책 |
| politics | 여론 / 세력 / 자원 / 입법 |
| romance | 관계 / 감정 / 기록 |
| trpg | 판정 / 상태 / 능력치 |
| vtuber | 채널 / 방송 / 컨디션 / 수익 / 팬 |
| daily | 지금 / 소지 |
| smith | 장부 / 공방 / 명성 |
| fleet | 출격 편성 / 정비창 / 자원 / 태세 |
| delve | 탐사 / 일행 / 소지 / 기록 |
| zombie | 지금 / 몸 / 물자 / 사람 |
| idol | 프로덕션 / 장부 / 일감 / 관리 / 음지 / 유나 / 세리 / 린 |

idol은 **멤버별 그룹**(유나/세리/린)이라는 유일한 패턴 — 인물 하나당 그룹 하나.

## 밸런스 감각 (진단 규격서에서)

- 쉬움과 어려움의 격차는 **버티는 턴 수로 2배 안쪽**. 3배 넘으면 어려움은 아무도 못 깨고
  쉬움은 아무 일도 안 일어난다
- 이벤트 조건은 **도달 가능한지 역산할 것.** 리스크가 턴당 +2인데 발동선이 70이면 35턴이다
- 어디서도 값이 안 바뀌는 변수를 만들지 말 것. 계산으로만 정해지면 처음부터 파생 변수로
