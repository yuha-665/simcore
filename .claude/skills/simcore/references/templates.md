# 내장 템플릿 12종 실측표

`SimCore.require('templates').TEMPLATES` 에서 뽑은 값. **가이드나 배포글에 예시를 쓸 때 여기서
고를 것** — 지어내면 유저 화면과 안 맞는다.

다시 뽑으려면:

```bash
cd E:/0.리수봇/simcore && node -e "
const fs=require('fs');const src=fs.readFileSync('simcore.plugin.js','utf8');
(0,eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {'))+'\n;globalThis.__SC=SimCore;');
const {TEMPLATES}=globalThis.__SC.require('templates');
// 필요한 것만 골라 출력
"
```

## 전체표

| id | vars | derived | allow | 틱/이벤트/랜덤 | 지시문 | 액션 | 프리셋 | 그룹 | 최초설정 | 랜덤% |
|---|--:|--:|--:|---|--:|--:|--:|--:|:-:|--:|
| blank | 1 | 0 | 1 | 0/0/0 | 0 | 0 | 0 | 1 | ✕ | 0 |
| daily | 6 | 0 | 5 | 0/0/12 | 3 | 2 | 3 | 2 | ○ | 30 |
| rpg | 10 | 3 | 9 | 0/4/3 | 2 | 2 | 2 | 4 | ○ | 15 |
| estate | 9 | 2 | 7 | 3/3/2 | 2 | 2 | 3 | 3 | ○ | 25 |
| mystery | 9 | 2 | 6 | 2/4/4 | 4 | 3 | 3 | 3 | ○ | 30 |
| business | 10 | 7 | 6 | 4/4/4 | 3 | 4 | 3 | 3 | ○ | 30 |
| survival | 13 | 8 | 8 | 7/7/5 | 4 | 6 | 3 | 4 | ○ | 35 |
| politics | 16 | 4 | 10 | 4/6/5 | 5 | 6 | 3 | 4 | ○ | 35 |
| romance | 9 | 1 | 6 | 3/6/4 | 6 | 3 | 3 | 3 | ○ | 35 |
| trpg | 11 | 4 | 5 | 2/3/3 | 3 | 6 | 4 | 3 | ○ | 22 |
| vtuber | 17 | 9 | 8 | 8/7/9 | 7 | 8 | 3 | 5 | ○ | 40 |
| smith | 11 | 3 | 8 | 1/2/6 | 3 | 5 | 3 | 3 | ○ | 25 |

**`cmd`(채팅 명령)는 전 템플릿 0개.** 액션은 다 들어있는데 명령은 하나도 없다 — 가이드에서
이 대비를 반드시 짚어야 한다. 템플릿 사용자는 우상단 버튼은 이미 보고 있지만 `/명령`은 존재조차 모른다.

**`layout`은 전 템플릿 미지정(=stack).** v0.38 기능이 기본으로는 안 보인다.

## 허용(allow)에서 일부러 뺀 변수 — 설계 의도의 결정체

| 템플릿 | 뺀 것 | 왜 |
|---|---|---|
| daily | `day` | **버튼으로만** 넘어간다 (`💤 하루를 마친다`). AI에게 열면 "며칠 뒤"에 날짜가 튄다 |
| rpg | `level` | exp에서 규칙이 올려 준다 |
| estate | `turn` `famine` | 카운터 / 이벤트 플래그 |
| mystery | `scene` `truth` `solved` | 카운터 / **숨긴 정답** / 진행 플래그 |
| business | `month` `price` `district` `crisis` | 카운터 / 플레이어 정책 / 플래그 |
| survival | `day` `heat` `ration` `shelter` `collapsed` | 카운터 / 플레이어 정책 / 플래그 |
| politics | `week` `econ` `bill_roll` `bill_result` `in_scandal` `ousted` | 카운터 / **주사위·판정** / 플래그 |
| romance | `day` `stage` `confessed` | 카운터 / 관계 단계 / 플래그 |
| trpg | `str` `dex` `wit` `cha` `adv` `dmg` | **캐릭터 시트 + 판정 부속.** 판정 결과 자체(roll/total/grade)는 v0.40부터 변수가 아니라 meta — 뺄 것도 없이 원천 차단 |
| vtuber | `day` `subs` `stream_hours` `editor` `concept` `trend_seed` `burnout` `in_scandal` `career_over` | 카운터 / 규칙 산출값 / 플래그 |
| smith | `skill` `stoked` `noble_next` | 캐릭터 시트 / 판정 소모품(액션·이벤트가 관리) / 의뢰 문턱(선택이 올린다) |

패턴: **카운터 · 주사위/판정값 · 이벤트 플래그 · 플레이어가 고르는 정책 · 숨긴 정답**은 안 연다.

⚠ 규칙이 쓰는 변수와 allow는 **규칙이 있는 템플릿 전부에서 겹친다** (estate `food`, rpg `hp` …).
"규칙이 쓰면 빼라"가 아니라 "서사에 안 나타나면 빼라"가 기준이다.

`whenArmed`(액션 잠금, v0.39)는 **smith만** — 장부가 둘인 유일한 템플릿이다
(`vault`를 `deposit`/`withdraw` 버튼 턴에만 개방). 나머지는 장부가 하나라 필요가 없다.

`checks`(판정, v0.40)는 **trpg 5종** (ck_str/dex/wit/cha/attack — 변수 5개 손조립의 일급화,
vars 16→11) + **smith 1종** (ck_forge — 액션과 랜덤 이벤트가 하나를 나눠 쓰는 예시).

`choices`(갈림길, v0.41)는 **daily 1종** (stray_cat 길고양이, timeout 2 — 랜덤 표) +
**smith 2종** (noble_offer 조건 이벤트: 잠긴 선택지·문턱 재발동 제어 / peddler 랜덤: timeout 2).

**smith는 v0.39~0.42 신기능 총집합** — 새 기능을 실기로 만져 볼 때 이 템플릿 하나면 된다
(클릭 조작은 어느 템플릿이든 범례·선택지에 자동).

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

### rpg — actions
```
🏕 휴식        oneshot  cooldown 2
              inject "[플레이어 액션] 모닥불을 피우고 휴식을 취한다."
              hp = min(hp + round(max_hp*0.5), max_hp) / mp 동일
🧪 회복약 사용  oneshot  when has(inventory, '회복약')
              inject "[플레이어 액션] 회복약을 마신다."
              inventory remove ['회복약'] / hp = min(hp+50, max_hp)
allow 한도     hp 60 / mp 40 / exp 80 / gold 300 / weapon·armor 30자 / location 50 / condition 40
프리셋         신참 모험가 = {}  (빈 프리셋 — 기본 시작값)
              베테랑 용병 = level 5, gold 500, 강철 장검, 사슬 갑옷, 회복약×2 + 낡은 지도
그룹          전투 / 성장 / 소지 / 위치
```

### daily — 유일하게 틱이 없는 템플릿
```
설계 반전   매 턴 자동 처리를 일부러 비웠다. 일상물에서 한 턴은 하루도 한 시간도 아니다 —
           카페에서 세 턴 떠들었다고 저녁이 되면 안 된다.
           시간·날짜는 유저가 버튼으로 넘긴다 (🕐 시간을 보낸다 / 💤 하루를 마친다)
vars       day(버튼 전용) · time(5단계 enum) · weather(5종) · place · money · bag
랜덤(30%)  12종 · 사람 3(만남·낯선이·연락) / 사건 4(소동·습득·지출·수입) / 날씨 4 / 갈림길 1
           → 대부분 effects 없이 notify만. 수치를 굴리는 대신 **서사에 소재를 던진다**
           날씨 이벤트는 `when: weather != "비"` 로 같은 날씨 재알림을 막는다
갈림길      stray_cat(길고양이, timeout 2): 쓰다듬는다(inject만) / 먹이를 사준다(when money≥3000,
           money-3000) / 모른 척 지나친다(마지막 — 조건 없음, 타임아웃 자동 결정용)
지시문 3   궂은 날씨 / 늦은 시각 / 수중에 돈 없음
시간 전이   time == "새벽" ? "아침" : time == "아침" ? "낮" : … (중첩 삼항)
```
관리할 수치가 없는 봇(현대 일상·학원·동거물)에 상태창만 얹고 싶을 때 고른다.

### trpg — checks (v0.40 판정)
```
ck_attack   roll 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)'   mod str_mod   vs dc
등급         대성공(roll==20)  → dmg = 2d8+str_mod · inject "압도적인 일격…"
            대실패(roll==1)   → hp -= 1d4 (반격) · inject "반격까지 허용한 대실패…"
            성공(total>=vs)   → dmg = 1d8+str_mod
            실패(기본 — when 없음)
액션         ⚔ 공격 = check: ck_attack + inject "[행동] 무기를 들어 공격한다."
            + effects [stamina-1, adv=0]  ← 정리는 액션 몫 (굴림이 adv를 먼저 읽는다)
이벤트       do_roll (when need_roll, check: ck_str) — 보조 AI가 판정을 요청하면 시스템이 대신 굴린다
onTurn      dmg = 0 (피해량은 판정 턴에만 의미 — 지시문이 눌어붙지 않게)
```
회귀: 구판(v0.39 손조립)과 같은 시드에서 굴림·등급·피해·반격·기력 **시드별 동일값 800/800** 확인.

### smith — 신기능 총집합 (v0.42.1)
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

### hold(지속형) 액션 — 셋
```
estate  🛡 순찰 강화     gold = gold - 20        "[지속 정책] 병사들이 순찰을 강화하고 있다."
vtuber  🔴 풀타임 방송   when not burnout
                        stream_hours = min(stream_hours+3, 10) / energy = energy - 4
smith   🪞 다듬질        when stamina >= 2       fame+1 / stamina-1  (매 턴 회복 +1과 상쇄)
```

### survival — presets (3단계 난이도의 모범)
```
초겨울 — 여유 있게 시작   temp -12  coal 500  food 480  people 45  hope 70
한겨울 — 이미 빠듯함     temp -28  coal 260  food 230  people 38  hope 50  discontent 30
폐허 — 남은 게 거의 없음  temp -34  coal 120  food  90  people 22  hope 30  discontent 45  sick 5
```

## 그룹 이름 (layout 예시용)

| | |
|---|---|
| rpg | 전투 / 성장 / 소지 / 위치 |
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

## 밸런스 감각 (진단 규격서에서)

- 쉬움과 어려움의 격차는 **버티는 턴 수로 2배 안쪽**. 3배 넘으면 어려움은 아무도 못 깨고
  쉬움은 아무 일도 안 일어난다
- 이벤트 조건은 **도달 가능한지 역산할 것.** 리스크가 턴당 +2인데 발동선이 70이면 35턴이다
- 어디서도 값이 안 바뀌는 변수를 만들지 말 것. 계산으로만 정해지면 처음부터 파생 변수로
