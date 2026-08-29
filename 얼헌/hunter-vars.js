const __P = (...p) => require('path').resolve(__dirname, ...p);
// 얼터헌터 개조 P1 — 코어 스키마 생성기 (docs/design-얼헌-개조.md)
//
// 원본 봇의 상태창(보조에 채팅 로그 10k~16k 재전송 + 정규식 찐빠 청소)과 always-on 로어북
// (상태창 지침 6.7K자 + 시스템 메시지 4.8K + 측정불가 1.7K)을 이 스키마 하나가 대체한다.
// 게임 규칙은 원본 수치를 그대로 승계한다 — 개조는 이관이지 리밸런스가 아니다:
//   · EXP needed = (Level+1) × 100        · 레벨업마다 스탯 포인트 +2
//   · Max HP = CON×10, MP = INT×10, SP = AGI×10
//   · 랭크 구간(주 스탯): E 10-25 / D 25-40 / C 40-60 / B 60-80 / A 80-100 / S 100+
//
// 원본 토글 17종의 승계 (봇설정.txt 시작 변수):
//   소멸 — status_type/status_model/sysmsg(심코어가 상태창·통지 자체), unmeasurable(지시문 1줄로),
//          fold/LowSpec(렌더 옵션 불필요), metaprompt(카드 프롬프트 몫), lang(한국어 전용),
//          NPC 48종 플래그(P2 랭크 게이팅으로), economy(원본에서도 죽은 변수), clock(시간대 enum 고정),
//          stats(풀 RPG 단일 — 숫자 관리가 심코어의 존재 이유), FuturePlans(백로그)
//   존치 — lore→store_on, faction→faction_on, scenario→action_on (정책 bool 3종, cmd로 전환)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');
const { evaluate, truthy } = SC.require('expr');

// 중첩 3항을 괄호로 안전하게 — [[조건, 값], ...] + 마지막 기본값
const chain = (pairs, last) => pairs.reduceRight((acc, [c, v]) => `(${c} ? ${v} : ${acc})`, last);

// 랭크 구간 (원본 로어북 "4. Stats Explanation" 그대로)
const RANKS = [[100, 'S'], [80, 'A'], [60, 'B'], [40, 'C'], [25, 'D']];
const rankExpr = (v) => chain(RANKS.map(([at, r]) => [`${v} >= ${at}`, `'${r}'`]), `'E'`);
const rankN = (v) => chain(RANKS.map(([at], i) => [`${v} >= ${at}`, `${6 - i}`]), '1');

const S = {
  simcore: '0.1',
  meta: { name: '얼터헌터' },

  // ── 시간 — 현대 서울, 그레고리력. 진행은 explicit(보조가 skip_day를 적을 때만 날짜가 흐른다).
  // 원본 clock=0(시간대 표기)이 기본이었으므로 정밀 시계(skip_min)는 두지 않는다 —
  // 시각은 서사 전용 enum, 날짜·요일은 시스템이 센다. 게이트 잔여일(P3)이 elapsed를 쓴다.
  time: {
    start: '2026-03-02 08:00',
    advance: 'explicit',
    calendar: 'gregorian',
    format: { date: 'YYYY-MM-DD' },
    weekdays: ['월', '화', '수', '목', '금', '토', '일'],
    seasons: ['봄', '여름', '가을', '겨울'],
    expose: ['date', 'weekday', 'season', 'elapsed'],
  },

  vars: [
    // ── 시간·환경 ──
    // ⚠ 진행 규칙은 desc에 적는다 — 지시문은 메인 전용이라 보조가 못 읽는다 (베리디아 규약 승계).
    { id: 'skip_day', label: '흐른 날', type: 'int', init: 0, min: 0, max: 14,
      desc: 'Days that passed in this response. Next morning = 1, three days later = 3. '
        + 'Leave 0 while the scene stays within the same day — the date and every day-counted '
        + 'timer move only with this.' },
    { id: 'time', label: '시각', type: 'enum', init: '🕗아침',
      enum: ['🌅새벽', '🕗아침', '🕛낮', '🌆저녁', '🌙밤'] },
    { id: 'weather', label: '날씨', type: 'enum', init: '☀️맑음',
      enum: ['☀️맑음', '⛅흐림', '🌧비', '⛈폭우', '❄️눈', '🌫안개', '🔥폭염', '🥶한파'] },
    { id: 'location', label: '위치', type: 'text', init: '서울 · 헌터 협회 본부', maxLength: 30,
      desc: 'Where the scene is. Inside a Gate write "게이트 내부 — <던전 이름>".' },

    // ── 헌터 신상 ──
    // 레벨은 시스템이 올린다 (레벨업 이벤트). 보조는 EXP 증가만 적는다.
    { id: 'level', label: '레벨', type: 'int', init: 1, min: 1, max: 99,
      desc: '시스템이 올린다 (EXP가 차면 자동 레벨업). 직접 바꾸지 마라.' },
    { id: 'exp', label: 'EXP', type: 'int', init: 0, min: 0,
      desc: 'EXP earned this turn from monster kills, quest completion, training. Write the GAIN '
        + 'only — level-ups are handled by the system, never touch level yourself. '
        + 'Typical kills: E-rank monster 10~30, D 40~80, C 100~200. No evidence in the scene = no EXP.' },
    { id: 'stat_pts', label: '스탯 포인트', type: 'int', init: 0, min: 0,
      desc: 'Unspent points (+2 per level-up, system-granted). Spend ONLY when the narrative '
        + 'says training/allocation happened: lower this and raise the matching stat by the same amount.' },
    { id: 'str', label: '근력', type: 'int', init: 10, min: 1, max: 250, cmd: '근력',
      desc: 'Raise only by spending stat_pts (same amount down there) or explicit narrative growth.' },
    { id: 'con', label: '체질', type: 'int', init: 10, min: 1, max: 250, cmd: '체질',
      desc: 'Same rule as str. Max HP = CON×10.' },
    { id: 'agi', label: '민첩', type: 'int', init: 10, min: 1, max: 250, cmd: '민첩',
      desc: 'Same rule as str. Max SP = AGI×10.' },
    { id: 'intel', label: '지능', type: 'int', init: 10, min: 1, max: 250, cmd: '지능',
      desc: 'Same rule as str. Max MP = INT×10.' },
    { id: 'sen', label: '감각', type: 'int', init: 10, min: 1, max: 250, cmd: '감각',
      desc: 'Same rule as str.' },
    { id: 'hp', label: 'HP', type: 'int', init: 100, min: 0,
      desc: 'Life. 0 = incapacitated. Damage taken and healing, as the narrative shows. Cap = CON×10 (system clamps).' },
    { id: 'mp', label: 'MP', type: 'int', init: 100, min: 0,
      desc: 'Mana. Skill/magic use drains it; rest and potions restore. Below 30% = severe strain, casting may fail.' },
    { id: 'sp', label: 'SP', type: 'int', init: 100, min: 0,
      desc: 'Stamina. Exertion and physical skills drain it; light movement does not. Below 30% = severe strain.' },
    // 협회 공인 등급 — 측정치(파생 rank_est)와 다를 수 있다. 승급은 심사 서사를 거쳐야 바뀐다.
    { id: 'license', label: '헌터 라이선스', type: 'enum', init: 'E', cmd: '랭크',
      enum: ['미각성', 'E', 'D', 'C', 'B', 'A', 'S'],
      desc: 'Association-certified rank. Change ONLY when the narrative completes an official '
        + 'evaluation/promotion — raw power growth alone does not move this.' },
    { id: 'job', label: '클래스', type: 'text', init: '없음', maxLength: 30, cmd: '클래스',
      desc: 'Class name with disclosure rank, e.g. "궁수 (일반)", "저승 무사 (히든)". 없음 if none.' },
    { id: 'guild', label: '소속', type: 'text', init: '무소속', maxLength: 24, cmd: '소속',
      desc: 'Guild/team/agency the hunter belongs to. 무소속 if none.' },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100,
      desc: 'How known the hunter is in hunter society and on HunterNet. Rises with public feats, '
        + 'falls with scandals. A rookie stays under 10 for a long while.' },

    // ── 장비·소지 (등급 표기: 일반/레어/유니크 — 레전더리는 서사에 명시됐을 때만) ──
    { id: 'weapons', label: '무기', type: 'list', init: [], maxItems: 2, itemMaxLength: 30, cmd: '무기',
      desc: 'Equipped weapons, max 2 — "철제 활 (일반)". Swap = remove old + add new. Stored gear goes to items.' },
    { id: 'accessories', label: '장신구', type: 'list', init: [], maxItems: 2, itemMaxLength: 30,
      desc: 'Equipped accessories, max 2, same format as weapons.' },
    { id: 'armor', label: '방어구', type: 'text', init: '없음', maxLength: 30,
      desc: 'Equipped armor — "강화 전술복 (일반)". 없음 if none.' },
    { id: 'items', label: '소지품', type: 'list', init: ['하급 회복 포션 2'], maxItems: 10, itemMaxLength: 30, cmd: '아이템',
      desc: 'Carried items with count LAST — "하급 회복 포션 3", "고블린 마정석 5". Consuming/looting '
        + 'updates the count (remove old entry, add updated one). Money is NOT an item.' },
    { id: 'skills', label: '스킬', type: 'list', init: [], maxItems: 14, itemMaxLength: 24, cmd: '스킬',
      desc: 'Learned skills, name only — no numbers. Skills come from skill books, training, Awakening moments.' },
    { id: 'quests', label: '퀘스트', type: 'list', init: [], maxItems: 5, itemMaxLength: 48, cmd: '퀘스트',
      desc: 'Active quests — "제목 — 목표 (보상)". No progress numbers inside; narrate progress instead. '
        + 'Remove on completion/failure. A deadline may be tagged "@+days" — the system expires it.' },

    // ── 재화 ──
    // ⚠ 상한 비대칭 원칙: 지어낸 수입은 경제를 영구히 망가뜨리지만 손실은 min 0이 받쳐 준다.
    { id: 'won', label: '원화', type: 'int', init: 500000, min: 0, format: '{v}원', cmd: '돈',
      desc: 'Korean won. Income needs on-screen evidence (quest payout, sale, salary) — never invent it. '
        + 'Spending follows real-world prices; hunter gear runs millions.' },
    { id: 'coin', label: '코인', type: 'int', init: 0, min: 0, format: '{v}C', cmd: '코인',
      desc: 'Alter Store currency (only meaningful while the store exists in this run). '
        + 'Earned from monster kills and quest completion, small amounts (E-rank kill: 1~5).' },

    // ── 플래그·정책 ──
    { id: 'downed', label: '(내부) 전투불능', type: 'bool', init: false,
      desc: '시스템 래치 — HP 0 이벤트가 세운다. 직접 바꾸지 마라.' },
    { id: 'promo_seen', label: '(내부) 승급 알림', type: 'bool', init: false,
      desc: '시스템 래치. 직접 바꾸지 마라.' },
    { id: 'store_on', label: '알터 스토어', type: 'bool', init: false, cmd: '스토어',
      desc: '유저 정책값 (원본 lore 토글). 켜면 코인·알터 스토어 서사가 활성. 시작 후 바꾸려면 /스토어.' },
    { id: 'faction_on', label: '적대 세력', type: 'bool', init: true, cmd: '적대세력',
      desc: '유저 정책값 (원본 faction 토글). 불신론자·이계 숭배단 서사 축.' },
    { id: 'action_on', label: '액션 서사', type: 'bool', init: true, cmd: '액션',
      desc: '유저 정책값 (원본 scenario 토글). 끄면 일상물 — 게이트 이벤트 빈도가 내려간다.' },
    { id: 'hazard', label: '위험도', type: 'int', init: 30, min: 0, max: 100,
      desc: '세계의 흉흉함 — 프리셋이 정하고 P3 게이트 빈도·이벤트 문턱이 읽는다. 직접 바꾸지 마라.' },
  ],

  derived: [
    { id: 'hp_max', label: '최대 HP', expr: 'con * 10' },
    { id: 'mp_max', label: '최대 MP', expr: 'intel * 10' },
    { id: 'sp_max', label: '최대 SP', expr: 'agi * 10' },
    { id: 'exp_need', label: '필요 EXP', expr: '(level + 1) * 100' },
    { id: 'mainstat', label: '주 스탯', expr: 'max(max(str, con), max(max(agi, intel), sen))' },
    { id: 'rank_est', label: '측정 등급', expr: rankExpr('mainstat') },
    { id: 'est_n', label: '(내부) 측정 등급 수치', expr: rankN('mainstat') },
    { id: 'lic_n', label: '(내부) 라이선스 수치',
      expr: chain([['license == "S"', '6'], ['license == "A"', '5'], ['license == "B"', '4'],
        ['license == "C"', '3'], ['license == "D"', '2'], ['license == "E"', '1']], '0') },
    // 상태창 바 너비 (%)
    { id: 'hp_w', label: '(표시) HP비', expr: 'round(hp * 100 / max(hp_max, 1))' },
    { id: 'mp_w', label: '(표시) MP비', expr: 'round(mp * 100 / max(mp_max, 1))' },
    { id: 'sp_w', label: '(표시) SP비', expr: 'round(sp * 100 / max(sp_max, 1))' },
    { id: 'exp_w', label: '(표시) EXP비', expr: 'round(min(exp, exp_need) * 100 / max(exp_need, 1))' },
  ],

  rules: {
    onTurn: [
      // 현재치는 최대치를 못 넘는다 — 스탯이 내려가도(장비 해제 등) 즉시 정합.
      { set: 'hp', expr: 'min(hp, hp_max)' },
      { set: 'mp', expr: 'min(mp, mp_max)' },
      { set: 'sp', expr: 'min(sp, sp_max)' },
      // 기한 퀘스트(@절대경과값) 자동 만료 — '@+3' 상대 기한이 이 시계로 굳는다.
      { list: 'quests', expire: 'elapsed' },
    ],
    events: [
      // ── 레벨업 — 원본 루아 enforceExpRule의 공식을 시스템이 직접 집행 ──
      // 큰 EXP를 몰아 받으면 다음 턴들에 걸쳐 연쇄 레벨업한다 (턴당 1레벨, 의도된 페이스).
      { id: 'levelup', when: 'exp >= exp_need and level < 99',
        effects: [
          { set: 'exp', expr: 'exp - exp_need' },      // exp_need는 이 시점(레벨 오르기 전) 값
          { set: 'level', expr: 'level + 1' },
          { set: 'stat_pts', expr: 'stat_pts + 2' },
        ],
        notify: '[시스템] 레벨 업 — 스탯 포인트 +2. 본문에 `[시스템] 레벨 업!` 한 줄로 짧게 연출하라. '
          + '포인트 분배는 유저의 몫이니 마음대로 분배하지 마라.' },
      // ── 전투불능 래치 짝 ──
      { id: 'down', when: 'hp <= 0 and not downed',
        effects: [{ set: 'downed', expr: 'true' }],
        notify: 'HP가 0이 됐다 — 전투불능이다. 의식을 잃거나 몸을 가눌 수 없는 상태를 서사에 반영하라. '
          + '죽음으로 확정하지는 마라 (구조·응급처치의 여지는 서사가 정한다).' },
      { id: 'down_clear', when: 'hp > 0 and downed',
        effects: [{ set: 'downed', expr: 'false' }],
        notify: '의식이 돌아왔다 — 회복의 순간을 서사에 반영하라.' },
      // ── 승급 자격 래치 짝 — 측정치가 라이선스를 넘어서면 한 번만 알린다 ──
      { id: 'promo', when: 'est_n > lic_n and lic_n >= 1 and not promo_seen',
        effects: [{ set: 'promo_seen', expr: 'true' }],
        notify: '측정 수치가 현재 라이선스 등급 구간을 넘어섰다. 협회 재측정(승급 심사)을 받을 자격이 '
          + '생겼다 — 주변 인물이나 협회 단말 알림으로 자연스럽게 흘려라. 심사 없이 등급이 바뀌지는 않는다.' },
      { id: 'promo_clear', when: '(est_n <= lic_n or lic_n < 1) and promo_seen',
        effects: [{ set: 'promo_seen', expr: 'false' }] },
    ],
  },

  directives: [
    // 원본 "측정 불가 방지" 로어북(1.7K자)의 한 줄 정제판
    { id: 'no_unmeasurable', when: 'true',
      text: '"측정 불가" 판정을 남발하지 마라 — 미지의 존재라도 대부분 S 구간 안에서 수치화된다. '
        + '수치·랭크의 최종 근거는 상태 블록이다.' },
    { id: 'downed_now', when: 'downed',
      text: '주인공은 전투불능 상태다 — 스스로 움직일 수 없다. 자력 탈출·반격을 묘사하지 마라.' },
    { id: 'hp_low', when: 'hp > 0 and hp <= hp_max * 3 / 10',
      text: 'HP가 30% 아래다 — 중상이다. 통증·출혈·움직임 제약이 서사에 배어야 한다.' },
    { id: 'strain', when: '(mp <= mp_max * 3 / 10 or sp <= sp_max * 3 / 10) and hp > hp_max * 3 / 10',
      text: 'MP 또는 SP가 30% 아래다 — 극심한 소모 상태. 격한 행동·시전은 실패하거나 대가를 치른다.' },
    { id: 'broke', when: 'won <= 0',
      text: '수중에 돈이 한 푼도 없다 — 결제·구매가 필요한 장면은 그 사실에 부딪혀야 한다.' },
    { id: 'pts_idle', when: 'stat_pts >= 4',
      text: '미분배 스탯 포인트가 {stat_pts}점 쌓여 있다. 분배는 유저의 선택이다 — 대신 정하지 말고, '
        + '수련·정비 장면에서 가볍게 상기시켜라.' },
  ],

  updater: {
    contextTurns: 2,
    guide: '헌터물 기록 기준: 게이트 안 전투가 있었으면 그 턴에 HP/MP/SP 소모·소모품 사용·전리품'
      + '(마정석 등 items)·EXP를 함께 정산하라. 근거 없는 수입·EXP는 적지 마라. 시간(skip_day)은 '
      + '날짜가 실제로 넘어갔을 때만. 스탯은 stat_pts를 소모하는 분배 장면에서만 올린다.',
    allow: [
      { id: 'skip_day', maxGain: 14 },
      { id: 'time' },
      { id: 'weather' },
      { id: 'location', maxLength: 30 },
      { id: 'exp', maxGain: 400, maxLoss: 0 },
      { id: 'stat_pts', maxGain: 0, maxLoss: 10 },
      { id: 'str', maxGain: 5, maxLoss: 3 },
      { id: 'con', maxGain: 5, maxLoss: 3 },
      { id: 'agi', maxGain: 5, maxLoss: 3 },
      { id: 'intel', maxGain: 5, maxLoss: 3 },
      { id: 'sen', maxGain: 5, maxLoss: 3 },
      { id: 'hp', maxDelta: 400 },
      { id: 'mp', maxDelta: 400 },
      { id: 'sp', maxDelta: 400 },
      { id: 'license' },
      { id: 'job', maxLength: 30 },
      { id: 'guild', maxLength: 24 },
      { id: 'fame', maxGain: 8, maxLoss: 15 },
      { id: 'weapons' },
      { id: 'accessories' },
      { id: 'armor', maxLength: 30 },
      { id: 'items' },
      { id: 'skills' },
      { id: 'quests' },
      // 원화: 수입은 턴당 5백만이 상한(대박 보상도 분할 정산), 손실은 사실상 무제한 (비대칭 원칙)
      { id: 'won', maxGain: 5000000, maxLoss: 1000000000 },
      { id: 'coin', maxGain: 50, maxLoss: 500 },
    ],
  },

  promptState: {
    systemGuide: '이 세계는 시스템 창이 뜨는 세계다 — 레벨업·스킬 습득·퀘스트 발생 같은 시스템 사건은 '
      + '본문 문단 사이 `[시스템] …` 한 줄로 짧게 연출하라. 수치 정산은 상태 블록의 몫이니 '
      + '숫자를 본문에 나열하지 마라.',
  },

  setup: {
    presets: [
      { id: 'rookie', label: '신인 헌터 — E급 라이선스, 평범한 시작 (표준)', set: {} },
      { id: 'gifted', label: '재능형 각성자 — 두둑한 지원금과 여유 포인트, 세상도 온화하다',
        set: { stat_pts: 4, won: 3000000, fame: 5, hazard: 15 } },
      { id: 'gutter', label: '밑바닥 — 빈 주머니로 시작, 세상은 흉흉하다',
        set: { won: 30000, items: [], hazard: 60 } },
    ],
  },

  statusUI: { mode: 'template', collapsible: false, templates: [] },   // 아래에서 채운다
};

// ── 상태창 — 원본 봇 CSS 규격(a-* 클래스) 승계, hunter.css ──
const css = fs.readFileSync(__P('hunter.css'), 'utf8');
const bar = (cls, name, cur, mx, w) =>
  `<div class="a-bar-item a-${cls}"><div class="a-bar-label"><span>${name}</span><span>{${cur}} / {${mx}}</span></div>`
  + `<div class="a-bar-track"><div class="a-bar-fill" style="width:{${w}}%"></div></div></div>`;
const stat = (k, v) => `<div class="a-stat-cell"><span class="k">${k}</span><span class="v">{${v}}</span></div>`;
S.statusUI.templates = [{
  id: 'hunter',
  template: `<style>${css}</style>`
    + '<div class="a-status-window">'
    + '<div class="a-header">STATUS WINDOW<small>Alter-Earth Hunter Interface</small></div>'
    + '<div class="a-top-info-bar">'
    + '<span class="a-info-item">📅 {date} ({weekday})</span>'
    + '<span class="a-info-item">{time}</span>'
    + '<span class="a-info-item">{weather}</span>'
    + '<span class="a-info-item">📍 {location}</span>'
    + '</div>'
    + '<div class="a-core-row">'
    + '<div class="a-rank-badge">{license}</div>'
    + '<div class="a-core-main"><div class="a-name">Lv.{level} · {job}</div>'
    + '<div class="a-sub">측정 등급 {rank_est} · 소속 {guild} · 명성 {fame}</div></div>'
    + '</div>'
    + '<div class="a-bars">'
    + bar('hp', 'HP', 'hp', 'hp_max', 'hp_w')
    + bar('mp', 'MP', 'mp', 'mp_max', 'mp_w')
    + bar('sp', 'SP', 'sp', 'sp_max', 'sp_w')
    + bar('exp', 'EXP', 'exp', 'exp_need', 'exp_w')
    + '</div>'
    + '<div class="a-stats-grid">'
    + stat('STR 근력', 'str') + stat('CON 체질', 'con') + stat('AGI 민첩', 'agi')
    + stat('INT 지능', 'intel') + stat('SEN 감각', 'sen')
    + '</div>'
    + '<div class="a-row"><span>미분배 포인트</span><span class="v">{stat_pts}</span></div>'
    + '<div class="a-row"><span>자산</span><span class="v">{won} · {coin}</span></div>'
    + '<div class="a-sec">EQUIPMENT</div>'
    + '<div class="a-row"><span>무기</span><span class="v">{weapons:tags}</span></div>'
    + '<div class="a-row"><span>장신구</span><span class="v">{accessories:tags}</span></div>'
    + '<div class="a-row"><span>방어구</span><span class="v">{armor}</span></div>'
    + '<div class="a-sec">INVENTORY</div>'
    + '{items:tags}'
    + '<div class="a-sec">SKILLS</div>'
    + '{skills:tags}'
    + '<div class="a-sec">QUESTS</div>'
    + '{quests:tags}'
    + '<div class="a-foot">{lastcheck}</div>'
    + '{commands}'
    + '</div>',
}];

// ══════════════════ 검증 ══════════════════
const v = validateSchema(S);
console.log('검증:', v.ok ? '통과' : '실패');
for (const e of v.errors) console.log('  ✗', e.path, e.msg);
for (const w of v.warnings) console.log('  ⚠', w.path, w.msg);
if (!v.ok) process.exit(1);

const d = diagnose(S);
const dHigh = (d.issues || d || []).filter?.((i) => i.severity !== 'low') ?? [];
console.log('진단:', dHigh.length ? `지적 ${dHigh.length}건` : '깨끗');
for (const i of dHigh) console.log('  •', i.severity, i.title || i.msg, '—', (i.detail || '').slice(0, 120));

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ❗ ') + name + (cond ? '' : ` — ${extra}`));
  if (!cond) fails++;
};

// 러너: 보조 델타(changes)를 넣고 한 턴 굴린다
const turn = (st, changes = {}, i = 0) => {
  const send = engine.sendPhase(S, st, { rng: seededRng('h', i, 's') });
  const out = engine.outputPhase(S, send.state, changes, {}, { rng: seededRng('h', i, 'o') });
  return { st: out.state, prompt: send.promptBlock };
};
const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };

console.log('\n━━ 파생 공식 (원본 수치 승계 확인) ━━');
{
  const t = fresh();
  const L = engine.makeLookup(S, t.vars);
  ok('초기 최대치 100/100/100 (스탯 10 기준)', L('hp_max') === 100 && L('mp_max') === 100 && L('sp_max') === 100);
  ok('Lv1 필요 EXP 200 = (1+1)×100', L('exp_need') === 200);
  t.vars.str = 85;
  const L2 = engine.makeLookup(S, t.vars);
  ok('주 스탯 85 → 측정 등급 A', L2('rank_est') === 'A' && L2('est_n') === 5, L2('rank_est'));
  t.vars.str = 100;
  ok('주 스탯 100 → S', engine.makeLookup(S, t.vars)('rank_est') === 'S');
}

console.log('\n━━ 레벨업 — EXP 캡(턴당 400)과 연쇄 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { exp: 550 }, 1));           // 캡 400으로 잘림 → Lv2 (need 200), 잔여 200
  ok('550 시도 → 캡 400 → Lv2 · 잔여 200 · 포인트 2',
    t.vars.level === 2 && t.vars.exp === 200 && t.vars.stat_pts === 2,
    `Lv${t.vars.level} exp${t.vars.exp} pts${t.vars.stat_pts}`);
  ({ st: t } = turn(t, { exp: 400 }, 2));            // 600 ≥ need 300 → Lv3, 잔여 300
  ok('추가 400 → Lv3 · 잔여 300 · 포인트 4', t.vars.level === 3 && t.vars.exp === 300 && t.vars.stat_pts === 4,
    `Lv${t.vars.level} exp${t.vars.exp} pts${t.vars.stat_pts}`);
  const { st: t3 } = turn(t, {}, 3);
  ok('가만히 두면 더 안 오른다 (300 < 400)', t3.vars.level === 3 && t3.vars.exp === 300);
}

console.log('\n━━ 전투불능 래치 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { hp: -100 }, 10));
  ok('HP 0 → downed 세워짐', t.vars.hp === 0 && t.vars.downed === true);
  const p1 = turn(t, {}, 11);
  ok('다음 턴 지시문에 전투불능', p1.prompt.includes('전투불능'), p1.prompt.slice(0, 80));
  ({ st: t } = turn(t, { hp: 40 }, 12));
  ok('회복 → 래치 해제', t.vars.hp === 40 && t.vars.downed === false);
}

console.log('\n━━ 승급 자격 — 한 번만 알린다 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { str: 5, con: 5, str2: 0 }, 20));  // 15 — 아직 E 구간
  ok('E 구간(15)에선 침묵', t.vars.promo_seen === false);
  t.vars.str = 30;                                          // D 구간 진입 (심사 전 라이선스 E)
  ({ st: t } = turn(t, {}, 21));
  ok('D 측정치 → 래치 세워짐', t.vars.promo_seen === true);
  const before = t.vars.promo_seen;
  ({ st: t } = turn(t, {}, 22));
  ok('다음 턴 재발동 없음 (래치 유지)', t.vars.promo_seen === before && t.vars.promo_seen === true);
  ({ st: t } = turn(t, { license: 'D' }, 23));              // 심사 통과
  ok('승급 후 래치 해제 — 다음 구간에서 다시 알릴 준비', t.vars.promo_seen === false);
}

console.log('\n━━ 클램프 — 현재치가 최대치를 못 넘는다 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { hp: 400, mp: 50 }, 30));
  ok('HP 500 시도 → 100로 클램프', t.vars.hp === 100, String(t.vars.hp));
  ({ st: t } = turn(t, { con: 5, stat_pts: -5, hp: 0 }, 31));  // 체질 15 → 최대 150 (분배 가정)
  ok('체질 15 → 최대 150, 현재 유지', engine.makeLookup(S, t.vars)('hp_max') === 150 && t.vars.hp === 100);
}

console.log('\n━━ 기한 퀘스트 자동 만료 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { quests: { add: ['긴급 — 붕괴 지하철 게이트 공략 @+3', '길드 의뢰 — 고블린 소탕'] } }, 40));
  ok('두 건 등록', t.vars.quests.length === 2, JSON.stringify(t.vars.quests));
  ({ st: t } = turn(t, { skip_day: 4 }, 41));
  ({ st: t } = turn(t, {}, 42));
  ok('나흘 뒤 기한 건만 소멸, 무기한 건 생존',
    t.vars.quests.length === 1 && t.vars.quests[0].includes('고블린'), JSON.stringify(t.vars.quests));
}

console.log('\n━━ 프리셋 ━━');
for (const p of S.setup.presets) {
  const t = engine.applyPreset(S, engine.initState(S), p.id).state;
  const badKey = Object.keys(p.set).find((k) => !S.vars.some((vv) => vv.id === k));
  ok(`${p.id} — set 키 전부 실존`, !badKey, badKey || '');
  if (p.id === 'gutter') ok('밑바닥 — 3만원 · 소지품 없음 · 위험 60',
    t.vars.won === 30000 && t.vars.items.length === 0 && t.vars.hazard === 60,
    JSON.stringify({ won: t.vars.won, items: t.vars.items, hazard: t.vars.hazard }));
}

console.log('\n━━ 상태창 자리표시자 ━━');
{
  const t = fresh();
  const html = SC.require('render').renderStatusHtml(S, t, null, null, { uid: 7 });
  const leftover = (html.match(/\{[a-z_]+\}/g) || []).filter((m) => !m.includes(':'));
  ok('미치환 자리표시자 없음', leftover.length === 0, leftover.join(' '));
  ok('원본 규격 클래스 렌더', html.includes('a-status-window') && html.includes('a-rank-badge'),
    html.slice(0, 300).replace(/\n/g, ' '));
}

if (fails) { console.log(`\n❗ ${fails}건 실패`); process.exit(1); }

fs.writeFileSync(__P('헌터-신안.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('헌터-신안.json') + '  (변수 ' + S.vars.length + ' · 파생 ' + S.derived.length + ')');
