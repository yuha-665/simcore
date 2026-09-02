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

// ══════════ P2 — NPC 레지스트리 (원본 NPC List 11.3K + Hostile 2.5K의 동적 대체) ══════════
// 정적 기준선(랭크·역할·소속·한 줄)은 여기 표가 유일 출처 → 랭크 그룹별 지시문으로 베이크된다.
// 유저 라이선스 ±1 그룹만 노출 (미각성은 E 대역으로 취급). 이미 서사에 들어온 인물은 대역과
// 무관하게 유지 — 개별 로어북 항목이 이름 키워드로 뜨므로 별도 장치가 필요 없다.
// 변동 정보(승급·이적·장비·부상)는 npc_notes 목록 하나에 "이탈분만" 기록한다.
const NPC_BAND = {
  E: [
    '김민수 Kim Min-soo (20/M): eager naive rookie, E-Rank Tanker (Classless), leans on Rare skill 이목집중',
    '송하늘 Song Ha-neul (20/F): energetic optimist, E-Rank Archer, high potential, hunts to support family, gore-averse',
    '안도현 Ahn Do-hyun (25/M): laid-back practical E-Rank Support (Classless), repair skill 탁월한 손재주',
    '오하나 Oh Ha-na (20/F): purple bob, otaku energy, E-Rank Dealer 투척가 (knives)',
    '최유나 Choi Yu-na (17/F): blunt tsundere secretly kind, E-Rank Tanker, passive 강철 모루',
  ],
  D: [
    '리베아 Rivea (appears 12/F): forgetful detached, D-Rank(?) hidden 잊혀진 신격, kept in Association custody, requires mana',
    '이사벨 헤이즈 Isabelle Hayes (20/F): devout zealous D-Rank Crusader, church-raised, unknowingly holds an Athena-linked Unique Skill',
    '유진성 Yoo Jin-seong (27/M): hearty meticulous D-Rank crafter 대장장이, Hunter Association engineer (7층)',
    '이하은 Lee Ha-eun (21/F): timid earnest D-Rank Cleric, freelance',
  ],
  C: [
    '강유라 Kang Yoo-ra (27/F): tomboyish easygoing C-Rank Striker (Taekwondo), hunts as hobby/stress relief',
    '박소원 Park So-won (25/F): enthusiastic diligent C-Rank Supporter 연금술사, Eunrang Guild',
    '서지한 Seo Ji-han (26/M): calm secretive C-Rank Supporter (buffs/heals), cursed with vampirism, seeks a cure in secret',
    '최민준 Choi Min-jun (35/M): mentor-like patient C-Rank Tank Centurion, runs rookie support agency Stone Square',
  ],
  B: [
    '민채린 Min Chae-rin (24/F): prickly tsundere B-Rank Dealer Shadow Hunter, cat ears she dislikes, prefers solitude',
    '주아람 Joo Ah-ram (29/F): calm calculating B-Rank, Unique Skill 홍선, Heuksa Guild Master',
    '한서연 Han Seo-yeon (23/F): driven reckless B-Rank Fire Mage, 한지원\'s younger sister, inferiority complex',
    '하루 이토 Haru Ito (16/M): sharp-witted youngest B-Rank Elementalist, commands spirits, dual JP/KR',
    '최태현 Choi Tae-hyun (36/M): sly one-eyed B-Rank close Dealer, Association field team 팀장, Unique 소울 홀드, vapes',
  ],
  A: [
    '강민혁 Kang Min-hyuk (24/M): calm pragmatic A-Rank Dealer 검사 (Eclipse Blade aura), avoids S-Rank, Heuksa Guild',
    '강우석 Kang Woo-seok (25/M): polite resolute protective A-Rank Tanker, Baekryeon Guild',
    '사사키 유아 Sasaki Yua (25/F): disciplined ambitious A-Rank Dealer/Tank, hidden 저승 무사, seeks S-Rank',
    '유선화 Yoo Sun-hwa (25/F): fierce loyal A-Rank Tank/Dealer, Eunrang, runs fighting ground 무쇠 천칭, gauntlets 탈로스의 의지',
    '앨리스 크로프트 Alice Croft (22/F, looks 10-12): smug arrogant A-Rank Supporter, hidden Successor of Chronos, British researcher',
    '이지혜 Lee Ji-hye (28/F): lazy indifferent A-Rank Summoner (hidden Nyx), unaffiliated, hunts purely for income',
    '임설희 Lim Seol-hee (26/F): cold misunderstood Ice Princess, A-Rank Dealer, Unique Ice Maker, Baekryeon',
    '진소희 Jin So-hee (26/F): lethargic cynical A-Rank Dealer/Supporter, Unique 퇴마부, 주아람\'s bodyguard',
  ],
  S: [
    '박준호 Park Jun-ho (38/M): taciturn protective S-Rank Tank, hidden 벽운갑주, Jeokho Guild',
    '백휘성 Baek Hwi-Sung (30/M): intense hunter-hostile S-Rank Dealer, hidden Herald of Helios, Association suppression duty',
    '임진태 Im Jin-tae (41/M): hot-blooded protective S-Rank Dealer, hidden Werewolf, Eunrang Guild Master',
    '하월영 Ha Wol-young (28/F): always-drunk unpredictable S-Rank Tanker(?), nicknamed 검귀, three Unique katanas',
    '제이크 밀러 Jake Miller (32/M): rough confrontational S-Rank 무투가, freelance, dismissive',
    '한지원 Han Ji-won (26/F): playful strategic S-Rank Support (barriers/True Gaze), Jeokho, foodie, scouts rookies',
  ],
};
const NPC_STAFF = [
  '권재현 Kwon Jae-hyun (60s/M): Association President, former S-Rank (3rd Gen, Mana Enchant), chronic illness',
  '고은비 Go Eun-bi (22/F): earnest insecure Association 주임, assistant to 최유진',
  '최유진 Choi Yoo-jin (24/F): efficient Association Registration & Assessment 팀장, skilled martial artist',
  '박혜인 Park Hye-in (31/F): cold meticulous Association senior researcher & rank-measurement supervisor',
  '이소윤 Lee So-yoon (28/F): chatty meddlesome Association Settlement Dept 대리, scent-obsessed',
  '윤미래 Yoon Mirae (29/F): gentle yet ruthless Baekryeon Guild Master, non-combatant, uses Foresight',
  '윤지호 Yoon Ji-ho (14/M): resourceful Black Market errand boy, innate item identification',
  '백은하 Baek Eun-ha (24/F): gentle hospital rehab patient (post-coma, partial memory), 백휘성\'s sister',
];
const NPC_HOSTILE = [
  '강태식 Kang Tae-shik (29/M): psychopathic C-Rank Rogue posing as D/E, serial killer preying on low-rank parties',
  '권도윤 Kwon Do-yoon (27/M): calculative venomous B-Rank, Black Market operative',
  '유진혁 Yoo Jin-hyuk (31/M): vengeful fugitive PK, former A-Rank, hidden 에레보스의 피조물, targets 백휘성/high ranks',
  '신우현 Shin Woo-hyun (late 20s/M): manic fanatic 등불 of 이계 숭배단, non-Awakened, corrupted mana stones, 존댓말',
  '나선영 Na Sun-young (28/F): blind seeress, serene zealot 등불 of 이계 숭배단, curse user',
  '장은서 Jang Eun-seo (27/F): nihilistic leader of 상태창 불신론자, Awakened without Status Window, penalty-free cursed items',
  '채하윤 Chae Ha-yoon (26/F): manic free-spirited Vice-Commander of 불신론자, former E-Rank, Rare Mana Bullet, twin pistols Tic&Toc',
];
const roster = (arr) => arr.map((s) => '· ' + s).join(' ');
// 파티 후보 — 명단 전원의 한국어 이름 (P6. 슬롯은 enum: 제작자가 명사를 확정, AI는 못 만든다)
const koName = (s) => (s.match(/^[가-힣]+(?: [가-힣]+)*/) || [''])[0];
const PARTY_NAMES = Object.values(NPC_BAND).flat().map(koName);
// 대역 노출 조건 — 유저 라이선스 ±1 (미각성 0은 E 대역)
const BAND_WHEN = {
  E: 'lic_n <= 2', D: 'lic_n <= 3', C: 'lic_n >= 2 and lic_n <= 4',
  B: 'lic_n >= 3 and lic_n <= 5', A: 'lic_n >= 4', S: 'lic_n >= 5',
};

// ══════════ P3 — 서울 권역 게이트 시스템 ══════════
// 서울 5대 권역 (실제 도시계획 권역 구분). zone_i/grade_i는 "가장 최근 출현" 좌표 —
// 출현 이벤트가 rand로 굴리고, 보드 등록(이름 짓기)은 보조가 한다.
const ZONES = ['도심권', '동북권', '서북권', '서남권', '동남권'];
const ZONE_DESC = '도심권(종로·중구·용산) · 동북권(성북·노원·강북) · 서북권(은평·서대문·마포) '
  + '· 서남권(양천·구로·영등포·관악) · 동남권(서초·강남·송파·강동)';
const GRADES = ['E', 'D', 'C', 'B', 'A', 'S'];

// ── 장비 2축 등급 (2026-08-30 유저 설계): 랭크(E~S) × 희귀도(일반/레어/유니크/레전드) ──
// 단일 희귀도(일반/레어/유니크)로는 "E급이 유니크 먹으면 밸붕"이 구조적이었다 — 랭크 축을
// 끼우면 E급 유니크(10~600C)가 C급 일반(150~800C) 가격대에 앉는다: 좋은 물건이되 세계가
// 안 부서진다. 코인 기준 1C ≈ ₩1,000 (암거래 환율과 정합).
const GEAR_BASE = { E: [1, 60], D: [40, 200], C: [150, 800], B: [600, 3000], A: [2500, 12000], S: [10000, 50000] };
const RARITY_MULT = { '일반': 1, '레어': 3, '유니크': 10, '레전드': 25 };
const GEAR_GRADES = [];
const GEAR_BANDS = {};
for (const [tier, [glo, ghi]] of Object.entries(GEAR_BASE)) {
  for (const [rar, m] of Object.entries(RARITY_MULT)) {
    const g = `${tier}급 ${rar}`;
    GEAR_GRADES.push(g);
    GEAR_BANDS[g] = [Math.max(1, Math.round(glo * m)), Math.round(ghi * m)];
  }
}
const idx1 = (list, v) => chain(list.slice(0, -1).map((name, i) => [`${v} == ${i + 1}`, `'${name}'`]),
  `'${list[list.length - 1]}'`);

// ══════════ 성신의 가호 — 주간 세계 현상 (2026-09-01 유저 설계, 09-01 개편) ══════════
// 컨텍스트 층(vars+directives) 1호 구현: 이벤트=점화 · 변수=상태 · 지시문=지속.
// 개편(유저 확정): "강버프 × 강패널티" 두 축이 아니라 **괴상한 현상 + 거기 딸린 효과**가
// 한 몸인 개그 구조다. 현상을 수행하는 것 자체가 효과의 조건이 된다 (영창 없으면 불발처럼).
// 표는 손 큐레이션 (유저 지정 목록 승계) — 여기가 유일 출처, 늘리려면 행 추가만.
// ⚠ 뒤쪽 BOON_ALTER_N개는 수위 항목 — alter_on 꺼진 판에서는 로테이션이 안 뽑고,
//   활성 중 /수위 0이 되면 지시문도 같이 잠긴다 (에로코미디 이벤트 5종과 같은 게이트).
// ⚠ 효과의 수치는 서사 전용이다 — str/con 실변수를 절대 건드리지 않는다 (지시문이 명시).
const BOON_PAIRS = [
  // ── 기본 (전 수위) ──
  ['말끝마다 "…냥"이 붙는다', '모두가 조금 귀여워진다 — 적의·경계가 눅는다'],
  ['남녀 모두 오죠사마가 되어 "…데스와" 말투를 쓴다', '마정석 드랍이 눈에 띄게 후해진다'],
  ['스킬은 중2병 영창을 해야만 발동 — 빼먹으면 불발', '영창이 길고 멋질수록 위력 상승 (서사가 점수를 매긴다)'],
  ['모든 이의 말투가 사극체가 된다 ("그대", "~하시오")', '위엄이 서려 자신감이 오른다'],
  ['이성 헌터를 보면 구애의 춤부터 춰야 한다', '동성끼리만 있을 때 능력 발휘·자신감 상승'],
  ['모두가 일본 2ch 스레드 말투를 쓴다 ("코이츠www", "우효~ 초럭키")', '스레 민심이 실시간 공유돼 정보·소문이 빨리 돈다'],
  ['모든 결정과 보상이 가챠로 정해진다 — 드랍·협상 결과까지 뽑기', '천장 보정 — 꽝이 이어지면 다음 뽑기가 반드시 터진다'],
  ['뭘 하든 어디선가 얄미운 메스가키 중계 음성이 훈수를 둔다 ("자코 주제에 그걸 하겠다구~?♡")', '얄밉지만 정확하다 — 훈수가 적의 약점과 함정을 짚어준다'],
  // ── 수위 (alter_on 전용 — 반드시 목록 끝에) ──
  ['야하고 천박한 음란 대사로만 대화할 수 있다', '이성과 대화할 때마다 마력이 회복된다'],
  ['입은 것이 적을수록 방어력이 오른다', '전라 상태면 방어력 대폭 상승'],
  ['정조 관념이 남녀 반전된다 — 남자는 노출에 소스라치고, 여자는 노골적으로 품평한다', '뒤집힌 시선 속에서 매력·유혹이 잘 먹힌다'],
];
const BOON_N = BOON_PAIRS.length;
const BOON_BASE_N = 8;                 // 전 수위 항목 수 — 이 뒤는 alter_on 게이트
const BOON_POOL_N = `(alter_on ? ${BOON_N} : ${BOON_BASE_N})`;  // 로테이션 뽑기 폭 (점화 시점 평가)

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
    // 상한 3650(10년)은 한계가 아니라 백스톱 — 보조가 날짜(20260305)를 통째로 적는 사고만 막는다.
    // 옛 14일 상한은 유저가 "한 달 후"라 하면 서사는 한 달, 달력은 14일만 가서 급여일·게이트
    // 잔여일이 전부 서사보다 뒤처졌다. 달력은 서사를 따라간다 — 도약 폭은 유저가 정한다.
    { id: 'skip_day', label: '흐른 날', type: 'int', init: 0, min: 0, max: 3650,
      desc: 'Days that passed in this response. Next morning = 1, three days later = 3, '
        + 'a month later = 30, a year later = 365 — write the real count however large, '
        + 'but only the span the story actually skipped (never invent long gaps). '
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

    // ── 장비·소지 (등급 표기 2축: "랭크급 희귀도" — 예: E급 일반, D급 레어, C급 유니크.
    //    랭크는 장비의 격(E~S), 희귀도는 일반/레어/유니크/레전드. 상점 밴드와 같은 표) ──
    { id: 'weapons', label: '무기', type: 'list', init: [], maxItems: 2, itemMaxLength: 30, cmd: '무기',
      desc: 'Equipped weapons, max 2 — "철제 활 (E급 일반)". Grade = "랭크급 희귀도" pair '
        + '(rank E~S × 일반/레어/유니크/레전드). Swap = remove old + add new. Stored gear goes to items.' },
    { id: 'accessories', label: '장신구', type: 'list', init: [], maxItems: 2, itemMaxLength: 30,
      desc: 'Equipped accessories, max 2, same format as weapons.' },
    { id: 'armor', label: '방어구', type: 'text', init: '없음', maxLength: 30,
      desc: 'Equipped armor — "강화 전술복 (D급 일반)". Same grade pair rule as weapons. 없음 if none.' },
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
    // init true (2026-08-30) — 기본 꺼짐이면 새 채팅마다 상점 버튼이 없어 "버튼 어디 갔지"가
    // 된다 (실기 제보). 스토어는 대표 기능이라 기본 켬, 끄는 쪽을 명령으로.
    { id: 'store_on', label: '알터 스토어', type: 'bool', init: true, cmd: '스토어',
      desc: '유저 정책값 (원본 lore 토글). 켜면 코인·알터 스토어 서사가 활성. 끄려면 /스토어 0.' },
    { id: 'faction_on', label: '적대 세력', type: 'bool', init: true, cmd: '적대세력',
      desc: '유저 정책값 (원본 faction 토글). 불신론자·이계 숭배단 서사 축.' },
    { id: 'action_on', label: '액션 서사', type: 'bool', init: true, cmd: '액션',
      desc: '유저 정책값 (원본 scenario 토글). 끄면 일상물 — 게이트 이벤트 빈도가 내려간다.' },
    // 판정 주사위 — 헌터물에서 주사위는 호불호가 갈린다 (유저 지시 2026-08-29): 기본 켬 + /판정 으로 끔.
    // 끄면 판정 부착 이벤트 4종이 통째로 잠긴다 (판정 자체가 이벤트로만 굴러가므로 게이트가 하나다).
    { id: 'dice_on', label: '판정 주사위', type: 'bool', init: true, cmd: '판정',
      desc: '유저 정책값. 켜면 전투·회피·감지·교섭 국면에서 시스템이 주사위를 굴려 [판정] 줄을 준다. '
        + '끄면 순수 서사 재량. 시작 후 바꾸려면 /판정.' },
    // 원본 toggle_alterNSFW(=2) 승계 — 확장 수위 팩(alter_nsfw)의 when 게이트
    { id: 'alter_on', label: '수위 확장', type: 'bool', init: true, cmd: '수위',
      desc: '유저 정책값 (원본 alterNSFW 토글 승계). 끄면 확장 수위 이미지 팩이 잠긴다 '
        + '(기본 팩은 그대로). 시작 후 바꾸려면 /수위.' },
    // 성신의 가호 — 정책 2종. 축복은 전원 고정, 대가의 주인공 적용만 선택 (유저 판정 2026-09-01)
    // 기본 꺼짐 (유저 판정 2026-09-02) — 원작 세계에 없는 개그 장치라 옵트인. 켜는 턴에 즉시
    // 점화된다 (boon_prev -7 시계 그대로).
    { id: 'boon_on', label: '성신의 가호', type: 'bool', init: false, cmd: '가호',
      desc: '유저 정책값 (기본 꺼짐). 매주 성신이 전 세계 헌터에게 랜덤 현상+효과를 내리는 공인 '
        + '개그 장치. 켜려면 🌠 버튼 또는 /가호 1, 끄려면 /가호 0.' },
    { id: 'boon_self', label: '가호 대가 주인공 적용', type: 'bool', init: true, cmd: '가호주인공',
      desc: '유저 정책값. 켜면 행동 대가가 주인공에게도 걸린다(저항 가능 — 대신 축복이 흐려진다). '
        + '끄면 대가는 NPC만. 바꾸려면 /가호주인공 0.' },
    { id: 'hazard', label: '위험도', type: 'int', init: 30, min: 0, max: 100,
      desc: '세계의 흉흉함 — 프리셋이 정하고 P3 게이트 빈도·이벤트 문턱이 읽는다. 직접 바꾸지 마라.' },

    // ── 게이트 (P3) ──
    { id: 'day_prev', label: '(내부) 지난 정산일', type: 'int', init: 0, min: 0,
      desc: '시스템 전용 — 일 단위 카운트다운의 거울 변수. 직접 바꾸지 마라.' },
    { id: 'pay_prev', label: '(내부) 지난 급여일', type: 'int', init: 0, min: 0,
      desc: '시스템 전용 — 길드 급여 주기(30일)의 거울 변수. 직접 바꾸지 마라.' },
    // 성신의 가호 내부 — init -7이라 첫 턴(elapsed 0)부터 즉시 점화된다 (가호는 세계 상수).
    { id: 'boon_prev', label: '(내부) 지난 가호 갱신일', type: 'int', init: -7, min: -7,
      desc: '시스템 전용 — 가호 주간 로테이션(7일)의 거울 변수. 직접 바꾸지 마라.' },
    // max 16 = 짝 수(8)×2 — 로테이션의 "직전과 다른 짝 보장" 랩어라운드 중간값을 클램프가
    // 못 자르게 여유를 둔다 (effects가 순차라 +rand 직후 잠깐 8을 넘는다).
    { id: 'boon_i', label: '(내부) 가호 짝 번호', type: 'int', init: 0, min: 0, max: BOON_N * 2,
      desc: '시스템 전용 — 이번 주 축복·대가 짝 인덱스 (0=미점화). 직접 바꾸지 마라.' },
    // 잔향 지우기 (유저 우려 2026-09-02: "중간에 끄면 컨텍 오염") — 현상이 바뀌거나 꺼진 뒤
    // 3턴 동안 "직전 현상은 끝났다" 지시문을 싣는다. 지시문은 사라져도 채팅 기록엔 사흘치
    // "…냥"이 남아 있고 모델은 기록을 더 세게 따른다. 매주 갱신 때도 같은 문제라 같이 받는다.
    { id: 'boon_prev_i', label: '(내부) 직전 가호 짝', type: 'int', init: 0, min: 0, max: BOON_N * 2,
      desc: '시스템 전용 — 직전 주기의 짝 인덱스 (잔향 지시문용). 직접 바꾸지 마라.' },
    { id: 'boon_fade', label: '(내부) 가호 잔향', type: 'int', init: 0, min: 0, max: 3,
      desc: '시스템 전용 — 교체·끔 뒤 잔향 지시문이 남는 턴 수 (매턴 -1). 직접 바꾸지 마라.' },
    { id: 'zone_i', label: '(내부) 최근 출현 권역', type: 'int', init: 0, min: 0, max: 5,
      desc: '시스템이 굴린다 (0=없음). 직접 바꾸지 마라.' },
    { id: 'grade_i', label: '(내부) 최근 출현 등급', type: 'int', init: 0, min: 0, max: 6,
      desc: '시스템이 굴린다 (0=없음). 직접 바꾸지 마라.' },
    { id: 'gates', label: '게이트 보드', type: 'list', init: ['도심권 D 붕괴 지하철 게이트 @+9'],
      maxItems: 6, itemMaxLength: 36, cmd: '게이트',
      desc: 'Association board of open Gates — "권역 등급 이름 @+잔여일", e.g. "동북권 D 고블린 소굴 @+6". '
        + 'Register a gate when a [게이트] notice or the narrative establishes one; remove when cleared. '
        + 'A gate whose deadline lapses disappears — other hunters cleared it off-screen, or it closed.' },
    // 브레이크 경보 — 보드에서 "가장 위험한 하나"만 시스템이 초읽기한다 (베리디아 appt 패턴)
    { id: 'break_name', label: '브레이크 경보', type: 'text', init: '', maxLength: 30,
      desc: 'THE one gate whose break the story is racing against; empty if none. '
        + 'ALWAYS set break_in (days left) in the same turn you set this.' },
    { id: 'break_in', label: '브레이크까지', type: 'int', init: 0, min: 0, max: 30,
      desc: 'Days until that gate breaks. The system counts it down; at 0 the break fires. Set only at the start.' },

    // ── 던전 탐사 (P9, 2026-09-01 유저 요청) — 게이트 안 서사 재료 ──
    // "전투한다/더 들어간다"뿐이던 게이트 내부에 탐사 축을 깐다: 탐사도(진행) + 현재 구역 +
    // 조사 포인트(재료). 포인트는 목록이 아니라 **텍스트**다 — 장면마다 통째로 갈리는 값이라
    // 통째 교체 의미론이 맞고("자주 변하는 건 목록에 안 넣는다"), 새 게이트 입장 리셋도
    // effects의 텍스트 set으로 끝난다 (목록 effects엔 clear가 없다 — 엔진 무변경).
    { id: 'explore', label: '탐사도', type: 'int', init: 0, min: 0, max: 100,
      desc: 'How explored THIS gate is (0-100). Raise 5~15 on a turn of active exploration or '
        + 'advancing; 0 while fighting, resting or talking. High explore approaches the boss. '
        + 'The system resets it on entering a new gate.' },
    { id: 'gate_room', label: '현재 구역', type: 'text', init: '', maxLength: 30,
      desc: 'Current chamber/area inside the gate, one short vivid label — e.g. "수맥이 흐르는 종유굴", '
        + '"무너진 개찰구 홀". Update when the party moves; blank outside gates (system clears).' },
    { id: 'gate_poi', label: '조사 포인트', type: 'text', init: '', maxLength: 60,
      desc: 'Investigable things in the CURRENT area, 2~3 short items joined by " · " — e.g. '
        + '"무너진 제단 · 벽의 발톱자국 · 미지근한 물웅덩이". Replace wholesale as the scene moves. '
        + 'Blank outside gates.' },
    { id: 'was_gate', label: '(내부) 게이트 래치', type: 'bool', init: false,
      desc: '시스템 래치 — 입장/퇴장 전이 감지용. 직접 바꾸지 마라.' },
    { id: 'boss_found', label: '(내부) 보스 방 발견', type: 'bool', init: false,
      desc: '시스템 래치 — 탐사도 85+에서 한 번만 발화. 직접 바꾸지 마라.' },

    // ── 의뢰 보드 (P8) — 게이트 보드와 같은 규약: 이벤트가 시키고 보조가 등록, 기한 자동 소멸 ──
    // quests(진행 중)와 별개인 "수락 전 대기열". 발주처 접두가 패널 칸 분류 키다 ({offers:tags:[협회]}).
    { id: 'offers', label: '의뢰 보드', type: 'list', init: ['[협회] 도심권 하수도 정화 지원 (80만원) @+5'],
      maxItems: 6, itemMaxLength: 44, cmd: '의뢰보드',
      desc: 'Association quest board — commissions NOT yet accepted. Format "[발주처] 내용 (보상) @+기한", '
        + '발주처 is one of 협회 / 길드 / 개인 (e.g. "[길드] 마정석 30개 납품 (300만원) @+7"). '
        + 'When the protagonist accepts one ON-SCREEN, remove it here and add it to quests. '
        + 'An expired offer vanished — other hunters took it.' },

    // ── 헌터넷 (P4) — 게이트 안 통신 두절 게이트 ──
    { id: 'in_gate', label: '게이트 안', type: 'bool', init: false,
      desc: 'true while the protagonist is INSIDE a Gate/dungeon (communications cut). '
        + 'Set back to false the moment they exit.' },
    // 교전 상대 등급 — 헌터전 판정의 목표치 소스 (없으면 게이트 등급 → 자기 등급 순 폴백).
    // 상대 주사위는 안 굴린다: 상대의 강함은 목표치가 표현한다 (판정 opp_n 주석 참고).
    { id: 'foe', label: '교전 상대', type: 'enum', init: '없음', cmd: '상대',
      enum: ['없음', 'E', 'D', 'C', 'B', 'A', 'S'],
      desc: 'Rank of the CURRENT opponent when the protagonist faces a hunter or ranked being '
        + 'in direct confrontation (combat, standoff, hostile negotiation). Set it the moment the '
        + 'opponent is established; RESET to 없음 as soon as the confrontation ends. '
        + 'Not for gate monsters — the gate grade already covers those.' },

    // ── NPC 변동 기록 (P2) — 기준선(레지스트리)에서 "달라진 것"만 ──
    { id: 'npc_notes', label: '인물 변동', type: 'list', init: [], maxItems: 14, itemMaxLength: 40, cmd: '인물',
      desc: 'Lasting CHANGES to named NPCs only — promotion, guild move, notable new gear/skill, '
        + 'grave injury, death. Format "이름 — 변화", e.g. "김민수 — D급 승급", "서지한 — 흡혈 저주 해제". '
        + 'Profiles are the baseline; log deviations only, one entry per fact, replace when superseded. '
        + 'NOT for moods, locations or the protagonist.' },

    // ── 파티 (P6) — 영입은 이야기가, 편성은 버튼이 ──
    // 명부(allies)는 보조가 서사를 보고 움직이고, 슬롯(party1~4)은 패널 전용이라
    // updater.allow에 없다 — AI가 마음대로 파티를 짜고 푸는 것을 구조로 막는다.
    { id: 'allies', label: '동료 명부', type: 'list', init: [], maxItems: 12, itemMaxLength: 20, cmd: '동료',
      desc: 'Named hunters who agreed to team up with the protagonist — name only (e.g. "김민수"). '
        + 'Add ONLY when recruitment happens on-screen (헌터넷 모집 지원 수락, 직접 섭외, 협회 매칭). '
        + 'Remove on falling-out, guild poaching, death. Being an ally ≠ being in the current party.' },
    ...[1, 2, 3, 4].map((n) => ({
      id: `party${n}`, label: `파티원 ${n}`, type: 'enum', init: '없음',
      enum: ['없음', ...PARTY_NAMES],
      desc: 'Set from the party panel only — never change this yourself.' })),
  ],

  derived: [
    { id: 'hp_max', label: '최대 HP', expr: 'con * 10' },
    { id: 'mp_max', label: '최대 MP', expr: 'intel * 10' },
    { id: 'sp_max', label: '최대 SP', expr: 'agi * 10' },
    { id: 'exp_need', label: '필요 EXP', expr: '(level + 1) * 100' },
    { id: 'mainstat', label: '주 스탯', expr: 'max(max(str, con), max(max(agi, intel), sen))' },
    { id: 'rank_est', label: '측정 등급', expr: rankExpr('mainstat') },
    { id: 'est_n', label: '(내부) 측정 등급 수치', expr: rankN('mainstat') },
    { id: 'foe_n', label: '(내부) 교전 상대 수치',
      expr: chain([['foe == "S"', '6'], ['foe == "A"', '5'], ['foe == "B"', '4'],
        ['foe == "C"', '3'], ['foe == "D"', '2'], ['foe == "E"', '1']], '0') },
    // 전투 안무 상대 라벨 (v1.6.0) — 개전 때 굳는다. 헌터전이면 등급, 게이트면 "게이트 안의 적"
    { id: 'foe_label', label: '(내부) 교전 상대 라벨',
      expr: 'foe != "없음" ? foe + "급 상대" : (in_gate ? "게이트 안의 적" : "상대")' },
    // 판정 상대 등급 — 우선순위: 교전 상대(foe, 헌터전) > 게이트 등급(grade_i) > 자기 측정
    // 등급(est_n). 목표치가 이걸 읽어 성장을 따라온다 — 고정 목표치(13+hazard/25)는
    // S랭크(보정 +14~+34)에서 주사위가 장식이 되는 실계산 확인. 상대 주사위는 안 굴린다.
    { id: 'opp_n', label: '(내부) 판정 상대 등급',
      expr: 'foe_n > 0 ? foe_n : ((in_gate and grade_i > 0) ? grade_i : est_n)' },
    { id: 'lic_n', label: '(내부) 라이선스 수치',
      expr: chain([['license == "S"', '6'], ['license == "A"', '5'], ['license == "B"', '4'],
        ['license == "C"', '3'], ['license == "D"', '2'], ['license == "E"', '1']], '0') },
    // 상태창 바 너비 (%)
    { id: 'hp_w', label: '(표시) HP비', expr: 'round(hp * 100 / max(hp_max, 1))' },
    { id: 'mp_w', label: '(표시) MP비', expr: 'round(mp * 100 / max(mp_max, 1))' },
    { id: 'sp_w', label: '(표시) SP비', expr: 'round(sp * 100 / max(sp_max, 1))' },
    { id: 'exp_w', label: '(표시) EXP비', expr: 'round(min(exp, exp_need) * 100 / max(exp_need, 1))' },
    // P3 — 게이트 표시
    { id: 'zone_txt', label: '최근 출현 권역', expr: `(zone_i == 0 ? '—' : ${idx1(ZONES, 'zone_i')})` },
    { id: 'grade_txt', label: '최근 출현 등급', expr: `(grade_i == 0 ? '—' : ${idx1(GRADES, 'grade_i')})` },
    { id: 'break_txt', label: '브레이크 상황',
      expr: `(break_name == '' ? '없음' : break_name + ' D-' + break_in)` },
    // 던전 탐사 (P9) — 표시용 (게이트 밖에서는 — 로 접힌다)
    { id: 'explore_txt', label: '탐사도 표시',
      expr: `in_gate ? (boss_found ? explore + '% · 보스 방 발견' : explore + '%') : '—'` },
    { id: 'room_txt', label: '현재 구역 표시',
      expr: `(in_gate and gate_room != '') ? gate_room : '—'` },
    { id: 'poi_txt', label: '조사 포인트 표시',
      expr: `(in_gate and gate_poi != '') ? gate_poi : '—'` },
    // 성신의 가호 — 짝 번호 → 텍스트 (꺼짐/미점화/수위 항목+alter 꺼짐은 —)
    { id: 'boon_quirk', label: '가호 현상',
      expr: `(boon_on and boon_i >= 1 and (boon_i <= ${BOON_BASE_N} or alter_on)) ? (${idx1(BOON_PAIRS.map((p) => p[0]), 'boon_i')}) : '—'` },
    { id: 'boon_prev_txt', label: '직전 가호 현상',
      expr: `boon_prev_i >= 1 ? (${idx1(BOON_PAIRS.map((p) => p[0]), 'boon_prev_i')}) : '—'` },
    { id: 'boon_perk', label: '가호 효과',
      expr: `(boon_on and boon_i >= 1 and (boon_i <= ${BOON_BASE_N} or alter_on)) ? (${idx1(BOON_PAIRS.map((p) => p[1]), 'boon_i')}) : '—'` },
  ],

  rules: {
    onTurn: [
      // 현재치는 최대치를 못 넘는다 — 스탯이 내려가도(장비 해제 등) 즉시 정합.
      { set: 'hp', expr: 'min(hp, hp_max)' },
      { set: 'mp', expr: 'min(mp, mp_max)' },
      { set: 'sp', expr: 'min(sp, sp_max)' },
      // 기한 퀘스트·게이트(@절대경과값) 자동 만료 — '@+3' 상대 기한이 이 시계로 굳는다.
      { list: 'quests', expire: 'elapsed' },
      { list: 'gates', expire: 'elapsed' },
      { list: 'offers', expire: 'elapsed' },   // 기한 지난 의뢰 = 다른 헌터가 가져갔다
      // 브레이크 초읽기 — 흐른 날수만큼 깎는다. ⚠ day_prev 갱신은 반드시 이 뒤에.
      { set: 'break_in', expr: 'break_name != "" ? max(break_in - (elapsed - day_prev), 0) : 0' },
      { set: 'day_prev', expr: 'elapsed' },
      // 급여 시계 — 무소속인 동안엔 거울이 따라가고(주기 정지), 가입한 날부터 30일을 센다.
      { set: 'pay_prev', expr: "guild == '무소속' ? elapsed : pay_prev" },
      // 가호 잔향 — 교체·끔이 3으로 세우고, 매턴 하나씩 꺼진다
      { set: 'boon_fade', expr: 'max(boon_fade - 1, 0)' },
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
      // ── 성신의 가호 — 주간 로테이션 (컨텍스트 층: 점화는 여기, 지속은 지시문이) ──
      // 급여와 같은 이유로 결정 이벤트다 — 주기는 랜덤이 아니다. 내용만 rand()로 뽑는다.
      { id: 'boon_rotate', when: 'boon_on and elapsed - boon_prev >= 7',
        effects: [
          // 직전과 반드시 다른 짝 — +rand(1,N-1) 후 랩어라운드. 같은 짝 재추첨이면
          // "갱신됐는데 그대로네"가 되고, 그건 매너리즘 방지 장치의 자기모순이다.
          // 잔향 — 직전 짝을 기억하고 3턴 지시문 (첫 점화는 prev 0이라 안 뜬다)
          { set: 'boon_prev_i', expr: 'boon_i' },
          { set: 'boon_fade', expr: 'boon_i > 0 ? 3 : 0' },
          // 뽑기 폭 N은 점화 시점의 수위 정책을 따른다 (alter 꺼짐 = 수위 항목 제외).
          { set: 'boon_i', expr: `boon_i == 0 ? rand(1, ${BOON_POOL_N}) : boon_i + rand(1, ${BOON_POOL_N} - 1)` },
          // 빼기 두 패스 — 수위 항목(6~7) 활성 중 /수위 0으로 폭이 5로 줄면 한 번 빼기로는
          // 범위를 못 벗어나는 경우가 있다 (7 + 4 = 11 → 6 > 5). 범위 안이면 no-op.
          { set: 'boon_i', expr: `boon_i > ${BOON_POOL_N} ? boon_i - ${BOON_POOL_N} : boon_i` },
          { set: 'boon_i', expr: `boon_i > ${BOON_POOL_N} ? boon_i - ${BOON_POOL_N} : boon_i` },
          { set: 'boon_prev', expr: 'elapsed' },
        ],
        notify: '[성신의 가호] 주간 갱신 — 성신이 새 축복과 대가를 내렸다 (내용은 지시문에 반영됨). '
          + '밤하늘의 별문양, 협회 공지, 적응하는 헌터들의 소동과 함께 그려라 — 세계 전체가 아는 '
          + '공인 현상이라 뉴스·헌터넷도 이 얘기다.' },
      // ── 길드 급여 — 월급은 랜덤이 아니라 주기다 (가입 30일마다, 라이선스 비례) ──
      { id: 'guild_payday', when: "guild != '무소속' and elapsed - pay_prev >= 30",
        effects: [
          { set: 'won', expr: 'won + 200000 + lic_n * 150000' },
          { set: 'pay_prev', expr: 'elapsed' },
        ],
        notify: '[급여] Guild payday — the monthly salary has landed (amount already settled in the '
          + 'state block). A guild also expects things: attach a small guild errand, notice or meeting.' },
      // ── 게이트 브레이크 (P3) — 초읽기가 0에 닿으면 터진다 ──
      { id: 'gate_break', when: 'break_name != "" and break_in <= 0',
        effects: [
          { set: 'hazard', expr: 'min(hazard + 10, 100)' },
          { set: 'break_name', expr: '""' },
        ],
        notify: '[게이트 브레이크] The watched gate\'s deadline has passed — monsters pour into the city. '
          + 'This is a district-scale disaster: sirens, evacuation, hunter mobilization. The protagonist '
          + 'need not be at the epicenter, but the world must feel it. Remove that gate from the board.' },
      // ── 던전 탐사 (P9) — 리셋은 **퇴장에만** 건다 (래치 짝, 무통지) ──
      // ⚠ 입장 리셋 금지: 보조 델타가 이벤트보다 먼저 반영되므로, 입장 턴에 리셋을 걸면
      // 그 턴의 첫 보고(explore·구역·포인트)를 리셋이 덮어쓴다 (실측). 퇴장이 항상
      // 청소하므로 다음 입장은 이미 깨끗한 상태에서 시작한다.
      { id: 'gate_enter', when: 'in_gate and not was_gate',
        effects: [{ set: 'was_gate', expr: 'true' }] },
      { id: 'gate_exit', when: 'not in_gate and was_gate',
        effects: [
          { set: 'was_gate', expr: 'false' },
          { set: 'explore', expr: '0' },
          { set: 'gate_room', expr: "''" },
          { set: 'gate_poi', expr: "''" },
          { set: 'boss_found', expr: 'false' },
        ] },
      // 보스 방 — 탐사도가 심부에 닿으면 한 번만 연다 (promo_seen 래치 패턴).
      // 발견까지만 시스템 몫이다 — 들어갈지, 언제 싸울지는 유저와 서사가 정한다.
      { id: 'boss_room', when: 'in_gate and explore >= 85 and not boss_found',
        effects: [{ set: 'boss_found', expr: 'true' }],
        notify: '[심부 도달] The party has found the boss chamber of this gate — a threshold moment: '
          + 'changed air, monster density, the architecture converging. Present the door/space and let '
          + 'the user decide when to enter. Do NOT start the boss fight on your own.' },
    ],

    // ── 랜덤 이벤트 (P3) — 원본 로어북 트리거 20종(각 roll 2%)의 흡수·확장 ──
    // 빈도는 문턱으로 민다: hazard(프리셋·브레이크가 조정)와 action_on이 확률식에 들어간다.
    // 끄는 게 아니라 낮추는 것 — 일상 모드에서도 세상은 가끔 움직인다.
    randomEvents: {
      // 게이트 안은 사건의 연속이다 — in_gate ×1.8 (전투·기습 판정이 굴러갈 밀도 확보)
      chancePerTurn: '(action_on ? 0.20 : 0.07) * (0.5 + hazard * 0.01) * (in_gate ? 1.8 : 1)',
      table: [
        // ── 게이트 계열 ──
        { id: 'gate_spawn', weight: 3, cooldown: 3,
          effects: [
            { set: 'zone_i', expr: 'rand(1, 5)' },
            { set: 'grade_i', expr: 'clamp(floor((rand(1, 100) + hazard) / 35) + 1, 1, 5)' },
          ],
          notify: '[게이트] A new Gate has appeared — district and grade are in the state block '
            + '(최근 출현). Weave it in naturally: association alert on the terminal, HunterNet buzz, '
            + 'or a distant siren. Name it and register it on the gates board with a deadline (@+days).' },
        { id: 's_gate', weight: 1, cooldown: 40, when: 'hazard >= 50 or lic_n >= 5',
          effects: [{ set: 'zone_i', expr: 'rand(1, 5)' }, { set: 'grade_i', expr: '6' }],
          notify: '[대형 사태] An S-Grade Gate has formed — national-news scale. Top guilds and the '
            + 'Association scramble; ordinary hunters are ordered to perimeter duty. Register it on the board.' },
        { id: 'hidden_piece', weight: 1, cooldown: 10,
          notify: '[던전 이변] Seed an anomaly for the NEXT dungeon run — a hidden room, a second-layer '
            + 'entrance, an out-of-place relic, or monsters behaving wrong. Foreshadow now; pay off inside.' },
        // ── 사회·기회 계열 ──
        { id: 'quest_sudden', weight: 2, cooldown: 2,
          notify: '[돌발 퀘스트] A quest arises from the current situation — new objective, challenge or '
            + 'opportunity the party may pursue. Announce it as a system quest and add it to the quest list.' },
        { id: 'scout_offer', weight: 1, cooldown: 12, when: 'fame >= 15',
          notify: '[스카웃] A guild or agency has noticed the protagonist — an approach with concrete terms. '
            + 'Pick a plausible one from the cast/guilds; accepting or refusing both carry consequences.' },
        { id: 'assoc_call', weight: 1, cooldown: 8, when: 'lic_n >= 2',
          notify: '[협회] The Hunter Association contacts the protagonist — commissioned subjugation, '
            + 'measurement follow-up, paperwork, or a favor with strings attached. The errand fits '
            + 'the protagonist\'s license band (±1 rank) — the Association files hunters by grade.' },
        // ── 길드·상층부 확충 (2026-09-01 유저 요청) — 두 구멍의 처방:
        //    ① 길드 가입 후 랜덤 콘텐츠 0종 (월급뿐) ② fame 20·lic D+ 위로 게이트 없음.
        //    scout_offer(fame 15 단건 제안)·assoc_call(lic 2+ 일반 행정)의 상위판들 — 중복 아님.
        { id: 'guild_task', weight: 2, cooldown: 5, when: "guild != '무소속'",
          notify: '[길드] Guild life knocks — a joint hunt, a supply-run request, rookie mentoring, '
            + 'or an internal meeting with the protagonist\'s name on the roster. Small obligations '
            + 'that make the guild feel like a workplace. Scale the ask to the protagonist\'s rank '
            + 'and fame — rookies get grunt work, names get named jobs.' },
        { id: 'guild_friction', weight: 1, cooldown: 8, when: "guild != '무소속' and fame >= 10",
          notify: '[길드 경쟁] Friction with a rival guild — overlapping hunting grounds, a poached '
            + 'client, raid-share disputes, or trash talk on HunterNet. The protagonist\'s standing '
            + 'drags their guild into it. Rivals today can be allies tomorrow.' },
        { id: 'poach_war', weight: 1, cooldown: 15, when: "guild == '무소속' and fame >= 35",
          notify: '[영입 전쟁] Multiple guilds bid for the protagonist at once — competing terms, '
            + 'a dinner invitation, a rushed counter-offer. Being wanted is leverage and pressure '
            + 'in equal measure; staying independent is also an answer.' },
        { id: 'celebrity', weight: 1, cooldown: 10, when: 'fame >= 40',
          notify: '[유명세] Fame collects its due — a broadcast/interview offer, fans asking for '
            + 'autographs, a candid shot trending on HunterNet, or an ad deal. Sweet and sticky: '
            + 'attention pays, and it never leaves.' },
        { id: 'assoc_task', weight: 1, cooldown: 12, when: 'lic_n >= 4',
          notify: '[협회 특무] The Association\'s upper floors call — a task-force seat, a classified '
            + 'briefing, disaster-response consultation. The kind of request only a high-rank hunter '
            + 'receives, and the kind that is hard to refuse.' },
        { id: 'blackmarket', weight: 1, cooldown: 10, when: 'faction_on',
          notify: '[암시장] A Black Market thread surfaces — a fence, an unregistered item, a coin-hungry '
            + 'broker. Tempting, illegal, and remembered by the wrong people.' },
        { id: 'hunternet_buzz', weight: 1, cooldown: 6, when: 'fame >= 10',
          effects: [{ set: 'fame', expr: 'min(fame + 2, 100)' }],
          notify: '[헌터넷] Something about the protagonist is trending on HunterNet — clip, rumor or '
            + 'witness thread. Public opinion cuts both ways.' },
        { id: 'pk_shadow', weight: 1, cooldown: 10, when: 'faction_on and hazard >= 40',
          notify: '[불온한 기척] Signs of PK or hostile-faction activity near the protagonist\'s routes — '
            + 'a party that never came back, a tail, a too-friendly stranger. Build dread, no ambush yet.' },
        { id: 'skill_chance', weight: 1, cooldown: 8,
          notify: '[기연] A chance at growth appears — a skill book drop, a master\'s passing advice, or an '
            + 'awakening trigger under pressure. It must be earned in the scene, not given.' },
        // ── 서사 클리셰 계열 (원본 트리거 압축 승계) ──
        { id: 'npc_meet', weight: 2, cooldown: 3,
          notify: '[인물] Introduce an NPC who fits the current scene naturally — support, information, or '
            + 'a quest hook. Prefer the registered cast in the current rank band; a fresh face is allowed. '
            + 'Not while the protagonist is in lodging, private space, or intimacy.' },
        { id: 'npc_odd', weight: 1, cooldown: 5,
          notify: '[의외의 인물] Introduce someone who does NOT fit the scene — wrong place, wrong rank, '
            + 'wrong manner. Their presence itself is a question the story should answer later.' },
        { id: 'npc_rival', weight: 1, cooldown: 6, when: 'faction_on',
          notify: '[적대적 인물] Introduce or surface an antagonist — rival hunter, saboteur, or a hostile '
            + 'faction contact. Menace through behavior, not immediate violence.' },
        { id: 'twist', weight: 1, cooldown: 8,
          notify: '[반전] Reveal that something established was not what it seemed — an ally\'s motive, '
            + 'a quest\'s true client, an item\'s origin. Twist facts, never retcon them.' },
        { id: 'hard_choice', weight: 1, cooldown: 8,
          notify: '[어려운 결정] Force a dilemma with no clean answer — save one or the other, profit or '
            + 'principle, speed or safety. Lay out stakes clearly and let the user choose.' },
        { id: 'discovery', weight: 1, cooldown: 8,
          notify: '[비밀 발견] The protagonist stumbles onto something hidden — a document, an overheard '
            + 'conversation, a gate anomaly. Knowing it is a burden as much as an asset.' },
        { id: 'windfall', weight: 1, cooldown: 6,
          notify: '[행운] A small good thing happens — a generous payout, a rare drop, unexpected kindness. '
            + 'Keep it proportionate; the world stays tough.' },
        { id: 'bad_day', weight: 1, cooldown: 6,
          notify: '[악재] Something goes wrong — gear breaks, a payment is delayed, a rumor sours, weather '
            + 'turns. A complication, not a catastrophe.' },
        { id: 'aftermath', weight: 1, cooldown: 6,
          notify: '[여파] A consequence of a PAST scene arrives now — gratitude, a grudge, a bill, '
            + 'a summons. Pull from what actually happened in this story.' },
        { id: 'bond', weight: 2, cooldown: 4,
          notify: '[관계] Deepen a relationship already on screen — a meal, a favor repaid, a quiet '
            + 'conversation that shifts how two people see each other.' },
        { id: 'growth_moment', weight: 1, cooldown: 10,
          notify: '[자아] Give the protagonist a beat of self-discovery — why they hunt, what they fear, '
            + 'what the Awakening changed. Interior, quiet, earned.' },
        // ── 에로코미디 환기 이벤트 (2026-08-30 유저 지시) — 암울 축(변종·숭배단)만 쌓이면
        //    이야기가 무거워져 뇌절로 달린다. 랜덤 테이블에 가벼운 질량을 넣는 환기 장치.
        //    전부 alter_on 게이트 (/수위 0이면 통째 잠김 — dice_on과 같은 정책 결).
        { id: 'ero_trap_gate', weight: 1, cooldown: 10, when: 'alter_on',
          notify: '[에로트랩] Word spreads of an "ero-trap" gate variant — slime that dissolves only '
            + 'fabric, grabby flora with suspicious aim, puzzle walls that grade your poses. Raunchy '
            + 'comedy, not horror: nobody dies in an ero-trap gate, only dignity does.' },
        { id: 'ero_armor_meta', weight: 1, cooldown: 10, when: 'alter_on',
          notify: '[장비 유행] Eros-line armor is this season\'s meta — bikini plate, battle lingerie '
            + 'with high-grade enchants, and drop tables lately seem to agree. Hunters swear it is '
            + '"for the conductivity". Fashion comedy: a shop shelf, a scandalized senior, a convert.' },
        { id: 'mana_expose_study', weight: 1, cooldown: 12, when: 'alter_on',
          notify: '[속보] Association researchers publish: skin exposure correlates with mana '
            + 'conductivity. HunterNet erupts, gear makers pivot overnight, and nobody can argue '
            + 'with peer review. Play the absurdity dead serious — that is the joke.' },
        { id: 'macho_fashion', weight: 1, cooldown: 12, when: 'alter_on',
          notify: '[마초 패션] Male hunters embrace the leather-belt-and-briefs meta — oiled muscle, '
            + 'tactical suspenders, nothing else, citing "the conductivity study". Straight-faced '
            + 'beefcake comedy; the city has opinions.' },
        { id: 'succubus_gate', weight: 1, cooldown: 12, when: 'alter_on',
          notify: '[서큐버스] A succubus/incubus outbreak — charm auras, dream visits, monsters more '
            + 'dangerous to composure than to life. Ero-comedy encounter: clearing it is embarrassing, '
            + 'profitable, and extremely post-worthy on HunterNet.' },
        // ── 판정 이벤트 (dice_on 정책 — /판정 으로 온오프) ──
        // 굴림·정산은 엔진(checks), 여기는 "언제 굴리나"만. 끄면 이 4종이 통째로 잠기고
        // (목표치는 opp_n — 게이트 등급이 밀어 올린다. checks 섹션 주석 참고)
        // 나머지 이벤트는 그대로다 — 주사위 호불호가 콘텐츠 손실로 이어지지 않는다.
        // 교전 중(fight_on)엔 잠근다 — 라운드는 ⚔가 굴린다 (이벤트 굴림은 평판정이라 게이지를 안 움직인다)
        { id: 'gate_clash', weight: 4, cooldown: 3, when: 'dice_on and in_gate and not fight_on', check: 'gate_fight',
          notify: '[전투] A combat beat inside the Gate — the [판정] line already decided how it goes. '
            + 'Narrate the clash to MATCH that grade; never flip the result.' },
        { id: 'ambush_hit', weight: 1, cooldown: 6, when: 'dice_on and (in_gate or hazard >= 40)', check: 'evade',
          notify: '[기습] Something strikes from a blind angle — follow the [판정] evasion result. '
            + 'Outside a gate this can be a hostile hunter, a breakout stray, or an accident.' },
        { id: 'omen_sense', weight: 1, cooldown: 7, when: 'dice_on', check: 'sense',
          notify: '[낌새] There is something to notice in this scene. Follow the [판정] result: on success '
            + 'hand over a real clue (tie it to gates, factions or a quest); on failure the moment passes by.' },
        { id: 'parley_beat', weight: 1, cooldown: 9, when: 'dice_on', check: 'parley',
          notify: '[교섭] A negotiation beat — price haggling, information trading, or talking someone '
            + 'down. The [판정] grade sets how far words carry.' },
        // ── 길드·사회 보강 (2026-08-29 이벤트 확충 — 액션 대신 이벤트로, 유저 지시) ──
        // (급여는 여기 없다 — 월급은 랜덤이 아니라 주기라서 rules.events의 결정 이벤트다)
        // 전리품 — "드랍 순간"을 여는 이벤트. 목록 정산은 items/coin 기존 규칙대로 보조가.
        { id: 'loot_drop', weight: 2, cooldown: 4, when: 'in_gate',
          effects: [{ set: 'coin', expr: 'store_on ? coin + rand(2, 8) : coin' }],
          notify: '[전리품] The kill pays out — mana stones, monster parts, or a piece of gear worth '
            + 'keeping. Show the drop moment and update the inventory (grade tag, count last). '
            + 'Coins are already settled when the store exists.' },
        // ── 던전 탐사 인터럽트 (P9) — 시스템은 "무엇이 나올 차례"만, 정체는 서사가 ──
        { id: 'chest', weight: 2, cooldown: 5, when: 'in_gate',
          notify: '[보물상자] The party comes upon a chest/cache in this area. Contents cap at the '
            + 'gate\'s grade (an E-gate chest never holds unique gear). It may be locked, trapped or '
            + 'a mimic — your call, but pay out honestly when opened. Update inventory.' },
        { id: 'vein', weight: 2, cooldown: 6, when: 'in_gate',
          notify: '[채집] A harvestable find — a mana stone vein, herb cluster, monster nest with '
            + 'usable parts. Harvesting takes time and makes noise: worth vs. risk is the beat. '
            + 'Yield follows the gate grade.' },
        { id: 'hidden_space', weight: 1, cooldown: 8, when: 'in_gate and explore >= 30',
          notify: '[숨겨진 공간] A concealed passage/room reveals itself — shortcut deeper, a relic '
            + 'niche, or a dead hunter\'s last camp. Entering is the user\'s choice; foreshadow what '
            + 'might wait inside.' },
        { id: 'trace', weight: 1, cooldown: 10, when: 'in_gate and explore >= 50',
          notify: '[흔적] Signs of a previous raid party — gear wreckage, a journal page, claw-marked '
            + 'barricades, or worse. World-texture beat: what happened to them, and does it warn or '
            + 'tempt? May seed a quest or a board post.' },
        // 변종 — "정체불명의 마수"는 상시 분위기가 아니라 이벤트가 여는 예외다 (유저 지시
        // 2026-08-30: 컨텍 오염 제거의 짝). 상위 게이트·흉흉한 세계에서만, 드물게.
        { id: 'aberrant', weight: 1, cooldown: 12, when: 'in_gate and (grade_i >= 4 or hazard >= 60)',
          notify: '[변종] An aberrant appears — a mutated or unidentifiable entity that does not '
            + 'belong at this gate grade. Treat it as a real anomaly (the Association will want a '
            + 'report), never as the norm.' },
        { id: 'offer_post', weight: 2, cooldown: 3,
          notify: '[의뢰] New work hits the quest board — register 1~2 offers on the offers board, '
            + 'format "[협회|길드|개인] 내용 (보상) @+days". Pitch difficulty at the protagonist\'s '
            + 'license band (±1 rank) — a board never hands an E-rank an A-rank subjugation, and a '
            + 'high-ranker gets work worth their license. Rewards follow the economy (E-rank errands '
            + 'run 수십만원대); post a 길드 offer only if the protagonist belongs to one. '
            + 'Mention it in one line at most — a terminal ping, not a scene.' },
        { id: 'gate_race', weight: 1, cooldown: 6,
          notify: '[경쟁] Another party is moving on the same gate or quarry — permits, speed, or a '
            + 'split negotiation. Rivals today can be allies tomorrow; prefer the registered cast.' },
        { id: 'smear', weight: 1, cooldown: 12, when: 'fame >= 20',
          effects: [{ set: 'fame', expr: 'max(fame - rand(3, 7), 0)' }],
          notify: '[구설수] HunterNet turns on the protagonist — an unflattering clip, a twisted rumor, '
            + 'a hit thread. Fame already dropped; show where it came from and who fans the flames.' },
        { id: 'drill_call', weight: 1, cooldown: 8, when: 'stat_pts > 0',
          notify: '[수련] An opening to train — a mentor\'s offer, an empty training hall, a lesson '
            + 'drawn from a recent fight. If the user commits, the scene may spend stat points '
            + '(분배는 유저의 의사가 우선이다).' },
      ],
    },
  },

  // ── 판정 (v0.40 checks) — "완벽 주사위". 유저 정책 dice_on(/판정)으로 온오프 ──
  // 굴림·등급·정산 전부 엔진: 결과는 meta.lastCheck (보조가 만질 형태 자체가 없다),
  // 시드 굴림이라 리롤해도 같은 눈. 트리거는 위 판정 이벤트 4종뿐 — 액션이 없는 봇이라
  // "이벤트가 국면을 열고 주사위가 판을 정하는" 결이다. d20 + 스탯/10 보정.
  //
  // 목표치는 상대 등급(opp_n = 게이트 안이면 게이트 등급, 밖이면 자기 등급)이 정한다.
  // 처음 공식(13 + hazard/25)은 상대가 없어서, 보정이 +1→+34로 자라는 동안 목표치가
  // 13~17에 묶여 S랭크부터 주사위가 장식이 됐다 (유저 지적 — 원본 스탯 스케일은 S=100+).
  // 등급 연동이면 같은 급 상대는 끝까지 팽팽하고(굴림 9~12 필요), 한 급 위는 +3씩 벽,
  // 급 아래는 시원하게 쓸린다 — 헌터물 성장 문법 그대로. hazard는 잔가시(+0~4)로만 남는다.
  // ── 액션 (P7) — 막간 (v1.5.0 엔진 기능) ──
  // 유저 제안: 페르소나가 프롬프트에 있으면 모델이 주인공을 억지로 등장시켜, 조연들끼리
  // 굴러가는 장면이나 흑막 쪽 이야기를 볼 수가 없다. 이 버튼을 켜 둔 동안 주인공은 무대
  // 밖이고, 유저 입력은 "무엇을 비출지" 정하는 연출 지시로 읽힌다. 끄면 원래대로.
  // 상태 변수는 안 건드린다 — 주인공이 안 나오는 장면이라 HP도 명성도 움직일 일이 없다.
  actions: [
    { id: 'offstage', label: '🎬 막간 — 주인공 없이', mode: 'hold', offstage: true,
      inject: '[막간] 지금은 주인공의 시야 밖에서 세계가 움직이는 장면이다. 헌터넷·협회·길드·다른 헌터들, '
        + '혹은 아직 주인공과 마주치지 않은 인물들 쪽으로 카메라를 옮겨라.' },
    // 가호 켬/끔 — 명령(/가호) 말고 버튼으로도 (유저 요청 2026-09-01). oneshot 토글:
    // 누르면 ✅ 대기, 다음 전송의 액션 소비(1단계)가 반전시키므로 그 턴의 지시문·상태
    // 블록부터 새 정책이다. inject는 양방향을 한 문구로 커버한다.
    { id: 'boon_toggle', label: '🌠 가호 켬/끔', mode: 'oneshot',
      effects: [
        { set: 'boon_prev_i', expr: 'boon_on ? boon_i : boon_prev_i' },   // 끄는 경우만 직전 짝 갱신
        { set: 'boon_fade', expr: 'boon_on ? 3 : 0' },                     // 끄면 잔향 3, 켜면 0
        { set: 'boon_on', expr: 'boon_on ? false : true' },
      ],
      inject: '[성신의 가호] 가호 정책이 방금 전환되었다 — 상태 블록·지시문의 현재 상태를 따르라. '
        + '켜졌다면 성신의 장난이 돌아온 소동을, 꺼졌다면 세계가 문득 멀쩡해진 위화감을 짧게 그려라.' },
    // 전투 안무 (v1.6.0, 유저 결정 2026-09-02) — 라운드 입구는 이 버튼 하나. 안 누른 턴은 유저 구도
    // (게이지 불변 + 상시 줄), 누르고 짧게 쓰면 시스템 안무, 누르고 길게 쓰면 유저 수 + 유효 레벨만.
    // 결착은 여기서만 난다 — "이얍 → 끄앙 → 이겼다"가 구조적으로 불가능해진다.
    { id: 'fight_round', label: '⚔ 교전 — 한 라운드', mode: 'oneshot', when: 'dice_on', check: 'gate_fight' },
    { id: 'fight_leave', label: '🏃 이탈 — 도주·항복', mode: 'oneshot', when: 'fight_on', check: 'evade', fightEnd: true,
      inject: '[이탈] 주인공이 교전에서 빠져나가려 한다 — 도주든 항복이든, 위 회피 판정이 그 성패다.' },
  ],

  checks: [
    { id: 'gate_fight', label: '전투 판정', roll: 'rand(1, 20)',
      mod: 'floor(mainstat / 10) + floor(level / 10)',
      vs: '10 + opp_n * 3 + floor(hazard / 25)',
      // 전투 안무 (v1.6.0) — ⚔ 액션이 이 판정을 라운드로 굴린다. 게이지 = 30 + 상대 등급×25
      // (E 55 · C 105 · S 180): 우세(25) 기준 E 2~3라운드 · C 4 · S 7 — 고전(10)이 잦은 격차전은
      // 더 길고, 육성이 오르면 압도(50)가 잦아져 짧아진다. 반격은 evade 판정이 피해를 낸다
      // (직격 -20 · 피격 -10 — 숫자는 시스템). 결착 = 게이지 만땅(승) / hp 0(주인공 붕괴).
      fight: { gauge: '30 + opp_n * 25', reply: 'evade', foe: '{foe_label}',
        win: { effects: [{ set: 'foe', expr: '"없음"' }],
          inject: '헌터전이었다면 상대의 처지(부상·체면·원한)를 한 줄 남겨라.' },
        lose: { when: 'hp <= 0', inject: '죽음은 아니다 — 의식이 끊기는 데서 끝내라. 뒷일은 시스템(전투불능)이 잇는다.' } },
      grades: [
        { when: 'roll == 1', label: '치명적 실수', gain: 0, effects: [{ set: 'hp', expr: 'max(hp - 15, 0)' }],
          inject: '치명적인 실수가 나왔다 — 부상급 대가를 치르고 국면이 급격히 나빠진다.' },
        { when: 'total >= vs + 7', label: '압도', gain: 50, effects: [{ set: 'fame', expr: 'min(fame + 1, 100)' }],
          inject: '기대 이상의 전과다 — 지켜본 이가 있다면 소문이 날 만한 장면으로 그려라. '
            + '전리품도 후하게 떨어진다 (마정석·부산물·장비 — 소지품 갱신).' },
        { when: 'total >= vs', label: '우세', gain: 25, inject: '전투의 주도권을 잡는다 — 유효타를 그려라.' },
        { label: '고전', gain: 10, effects: [{ set: 'sp', expr: 'max(sp - 15, 0)' }],
          inject: '결정타가 나오지 않는다 — 소모전이다. 밀리는 국면을 그려라.' },
      ] },
    // 회피·감지·교섭은 주 스탯이 아닌 스탯을 쓴다 — 상대는 같은 opp_n이므로, 부스탯이
    // 약한 빌드는 그 국면이 실제로 어렵다 (스탯 분배가 판정에서 체감되는 자리).
    { id: 'evade', label: '회피 판정', roll: 'rand(1, 20)', mod: 'floor(agi / 10)',
      vs: '9 + opp_n * 3 + floor(hazard / 25)',
      grades: [
        { when: 'roll == 1', label: '직격', effects: [{ set: 'hp', expr: 'max(hp - 20, 0)' }],
          inject: '피할 수 없었다 — 직격이다.' },
        { when: 'total >= vs + 7', label: '완벽 회피', inject: '종이 한 장 차이로 흘리고 반격 자세까지 잡는다.' },
        { when: 'total >= vs', label: '회피', inject: '아슬아슬하게 피한다.' },
        { label: '피격', effects: [{ set: 'hp', expr: 'max(hp - 10, 0)' }],
          inject: '미처 다 피하지 못했다 — 가볍지 않은 대가다.' },
      ] },
    { id: 'sense', label: '감지 판정', roll: 'rand(1, 20)', mod: 'floor(sen / 10)',
      vs: '11 + opp_n * 2',
      grades: [
        { when: 'total >= vs + 7', label: '통찰', inject: '숨겨진 것의 정체까지 짚어낸다 — 정보를 아끼지 말고 줘라.' },
        { when: 'total >= vs', label: '감지', inject: '무언가 눈치챈다 — 단서 하나를 쥐여줘라.' },
        { label: '무감', inject: '낌새를 놓쳤다 — 그 대가는 나중에 온다.' },
      ] },
    { id: 'parley', label: '교섭 판정', roll: 'rand(1, 20)',
      mod: 'floor(intel / 10) + floor(fame / 20)', vs: '11 + opp_n * 2',
      grades: [
        { when: 'total >= vs + 7', label: '설복', effects: [{ set: 'fame', expr: 'min(fame + 1, 100)' }],
          inject: '상대가 완전히 넘어온다 — 기대 이상의 조건을 끌어내라.' },
        { when: 'total >= vs', label: '타결', inject: '대화가 통한다 — 합리적인 선에서 성사시켜라.' },
        { label: '결렬', inject: '말이 먹히지 않는다 — 상대의 태도가 굳는다. 다른 길을 찾게 하라.' },
      ] },
  ],

  directives: [
    // 원본 "측정 불가 방지" 로어북(1.7K자)의 한 줄 정제판.
    // ⚠ "미지의 존재" 같은 떡밥 단어를 넣지 말 것 (2026-08-30 컨텍 오염 실사고) — 매턴
    // 실리는 금지문이 그 개념을 계속 상기시켜, 첫 게이트부터 "정체불명의 마수 변이체"가
    // 쏟아졌다. 금지문에는 금지할 문구만 남긴다. 변종은 aberrant 이벤트가 정식으로 연다.
    { id: 'no_unmeasurable', when: 'true',
      text: '수치·랭크의 최종 근거는 상태 블록이다. 어떤 존재든 "측정 불가"로 얼버무리지 말고 '
        + 'S 구간 안에서 수치화하라.' },
    // 몬스터 격 가이드 — 판정 DC는 게이트 등급이 미는데(opp_n) 서사 속 몬스터의 격은 안
    // 묶여 있었다. 초반 게이트가 초반답게 굴러가게 격을 등급에 귀속시킨다.
    { id: 'gate_scale', when: 'in_gate',
      text: '게이트 몬스터의 격은 게이트 등급을 따른다 — E·D급은 흔한 마수 수준이다. '
        + '정체불명·변종·이상 개체는 상위 게이트나 브레이크, 또는 [변종] 이벤트가 열 때만 꺼내라.' },
    // ── 던전 탐사 (P9) — "전투한다/더 들어간다"뿐이던 게이트 내부의 서사 재료 ──
    { id: 'gate_explore_dir', when: 'in_gate',
      text: '게이트 내부는 조사할 거리가 있는 공간이다 — 매 응답, 장면에 조사 가능한 요소 1~2개를 '
        + '자연스럽게 깔아라 (구조물·흔적·소리·빛·냄새). 유저가 조사하면 결과를 정직하게 — 수확도 '
        + '꽝도 있다. 지금 탐사도 {explore}%: 0~30 입구부(잔몹·흔적), 30~70 중층(구조 변화·수확), '
        + '70+ 심부(위험도 급등, 굵은 수확, 보스의 기척). 전투만 있는 턴엔 탐사도가 늘지 않는다.' },
    { id: 'gate_loot_dir', when: 'in_gate',
      text: '드랍 기준 — 마정석: 처치의 6할쯤, 게이트 등급 상응. 장비 드랍: 드물다(1할 이하, 게이트 '
        + '등급 이하만). 보물상자·채집물도 등급이 상한이다. 보스: 마정석 확정 + 장비/스킬북 3할 — '
        + '등급을 넘는 물건은 나오지 않는다. 클리어 정산은 경제 시세표를 따른다.' },
    // 뇌절 방지 페이싱 (2026-08-30 유저 제보: "뭐만 각 보이면 스토리가 파국으로 달린다") —
    // 에로코미디 이벤트 5종과 짝인 환기 장치. 모든 떡밥의 결말을 파국으로 잡는 습관을 끊는다.
    { id: 'pacing', when: 'true',
      text: '모든 떡밥을 파국으로 키우지 마라 — 헛소동, 오해, 소소한 해프닝으로 끝나는 갈래도 '
        + '세계의 일부다. 무거운 국면이 이어졌으면 일상·유머로 환기하라.' },
    { id: 'downed_now', when: 'downed',
      text: '주인공은 전투불능 상태다 — 스스로 움직일 수 없다. 자력 탈출·반격을 묘사하지 마라.' },
    { id: 'hp_low', when: 'hp > 0 and hp <= hp_max * 3 / 10',
      text: 'HP가 30% 아래다 — 중상이다. 통증·출혈·움직임 제약이 서사에 배어야 한다.' },
    { id: 'strain', when: '(mp <= mp_max * 3 / 10 or sp <= sp_max * 3 / 10) and hp > hp_max * 3 / 10',
      text: 'MP 또는 SP가 30% 아래다 — 극심한 소모 상태. 격한 행동·시전은 실패하거나 대가를 치른다.' },
    { id: 'broke', when: 'won <= 0',
      text: '수중에 돈이 한 푼도 없다 — 결제·구매가 필요한 장면은 그 사실에 부딪혀야 한다.' },
    // 경제 시세표 (2026-08-30) — 메인이 상한을 몰라 720만 정산을 약속하고 장부는 500만만
    // 기록한 실사고의 처방. 서사가 부를 금액의 근거를 준다 (1차 방어는 이 표, 상한은 백스톱).
    // 분할 지급 규칙은 안 둔다 (유저 판정) — 잔금 약속을 모델이 기억해야 해서 유령 잔금이 된다.
    // 기존 확정 수치와 정합: 길드 기본급 20만+등급×15만/월, D게이트 3인 정산 720만, 장비 수백만~.
    { id: 'economy', when: 'true',
      text: '돈 시세 기준 — 게이트 클리어 정산(인당): E 50~200만, D 200~800만, C 800만~3천만, '
        + 'B 3천만~1억, A 1~5억, S 5억+. 평균 월수입(정산 포함): E 100~300만, D 300만~1천만, '
        + 'C 1천~5천만, B 5천만~2억, A 2억+. 길드 기본급은 별도(월 20만+등급×15만). '
        + '표는 1인 몫 기준 — 파티 사냥은 총 보상을 인원수로 N분해 주인공 몫만 입금하라. '
        + '정산은 한 번에 지급하고 끝내라 — 잔금·후불 약속을 만들지 마라.' },
    { id: 'pts_idle', when: 'stat_pts >= 4',
      text: '미분배 스탯 포인트가 {stat_pts}점 쌓여 있다. 분배는 유저의 선택이다 — 대신 정하지 말고, '
        + '수련·정비 장면에서 가볍게 상기시켜라.' },

    // ── 성신의 가호 — 지속 층 (완전 자각 세계 현상. boon_self로 문구가 갈려 지시문 2종.
    //    수위 항목(boon_i > BASE_N)은 alter_on까지 열려야 실린다 — 파생과 같은 게이트) ──
    { id: 'boon_all', when: `boon_on and boon_i >= 1 and boon_self and (boon_i <= ${BOON_BASE_N} or alter_on)`,
      text: '[성신의 가호 — 공인 주간 현상] 성신이 매주 전 세계 각성자에게 장난 같은 현상을 내린다. '
        + '이번 주 현상: "{boon_quirk}" — 딸린 효과: "{boon_perk}". 주인공 포함 모든 헌터에게 적용 중이며, '
        + '효과는 현상을 수행할 때만 붙는다. NPC 헌터들은 진지한 얼굴로 충실히 수행 중이다 — 그 대비가 '
        + '개그다. 주인공은 현상을 거스를 수 있으나 그 장면에서는 효과도 사라진다. 상태 블록의 수치는 '
        + '불변이다: 효과는 실전 발휘·서사로만 연출하라. 세계 전체가 이 현상을 알고, 매주 헌터넷의 '
        + '단골 소재다.' },
    // 잔향 지우기 — 교체·끔 뒤 3턴. 기록에 남은 옛 말투를 "지난 주기의 흔적"으로 못 박는다.
    { id: 'boon_fade_dir', when: 'boon_fade > 0 and boon_prev_i >= 1',
      text: '[성신의 가호 — 교체됨] 직전 현상 "{boon_prev_txt}"은(는) 끝났다. 앞선 대화에 남아 있는 '
        + '그 말투·행동은 지난 주기의 흔적이니 더 이어 쓰지 마라 — 인물들은 이미 원래대로(또는 새 '
        + '현상대로) 돌아와 있고, 누군가 습관처럼 옛 말투가 튀어나오면 스스로 민망해하는 정도다.' },
    { id: 'boon_npc', when: `boon_on and boon_i >= 1 and not boon_self and (boon_i <= ${BOON_BASE_N} or alter_on)`,
      text: '[성신의 가호 — 공인 주간 현상] 성신이 매주 전 세계 각성자에게 장난 같은 현상을 내린다. '
        + '이번 주 현상: "{boon_quirk}" — 딸린 효과: "{boon_perk}". 주인공을 제외한 모든 헌터에게 적용 '
        + '중이다 (이번 주기 주인공은 비켜갔다 — 홀로 멀쩡한 것이 오히려 눈에 띈다). NPC 헌터들은 진지한 '
        + '얼굴로 충실히 수행 중이다 — 그 대비가 개그다. 상태 블록의 수치는 불변이다: 효과는 실전 발휘·'
        + '서사로만 연출하라. 세계 전체가 이 현상을 알고, 매주 헌터넷의 단골 소재다.' },

    // ── 게이트 (P3) ──
    { id: 'seoul_zones', when: 'true',
      text: `Seoul hunter administration divides the city into 5 zones: ${ZONE_DESC}. `
        + 'Gate notices and the gates board use these zone names.' },
    { id: 'break_soon', when: 'break_name != "" and break_in <= 2',
      text: '브레이크 임박 — "{break_name}"이(가) {break_in}일 안에 터진다. 도시의 긴장(대피 안내, '
        + '헌터 소집, 헌터넷 술렁임)이 배경에 깔려야 한다.' },
    { id: 'daily_mode', when: 'not action_on',
      text: '일상물 페이스다 — 전투·게이트 서사를 앞세우지 말고 생활·관계·직업의 결을 그려라.' },
    // 알터 스토어 (P4.5) — 로어북 항목(lore 토글로 굽는 과정에서 소거)의 핵심만 지시문으로.
    // 상세 진열·거래는 상점 패널이 전담하므로 여기는 "존재와 규칙"만.
    { id: 'alter_store', when: 'store_on',
      text: 'This world has the Alter Store — an ethereal system shop only the Awakened can open '
        + '(a translucent interface, summoned at will outside Gates). It trades in Coin, not money. '
        + 'Purchases and sales are handled by the store panel; the [알터 스토어] notices in events are '
        + 'settled facts. Non-hunters cannot see or use it. Coin trading is officially forbidden — the '
        + 'Black Market is the only exception (rate ≈ ₩1,000 per Coin, risky back-alley deals). '
        + '[암거래 환전] notices are such deals, already settled — narrate the shady exchange, not the math.' },

    // ── NPC 등장 규칙 (P2) — 원본 NPC List(always 11.3K)의 동적 대체 ──
    { id: 'npc_cast', when: 'true',
      text: 'The named cast listed below are this world\'s recurring figures. Introduce naturally only '
        + 'those whose rank band fits the scene; the rest exist off-screen unless an event, reputation '
        + 'or the user pulls them in. Anyone already in the story stays available regardless of band. '
        + 'If a [인물 변동] entry exists for someone, it overrides their profile baseline.' },
    ...Object.entries(NPC_BAND).map(([band, arr]) => ({
      id: `npc_${band.toLowerCase()}`, when: BAND_WHEN[band],
      text: `${band}-Rank hunters natural to encounter now: ${roster(arr)}`,
    })),
    { id: 'npc_s_far', when: 'lic_n <= 4',
      text: 'S-Rank celebrities everyone knows from media and HunterNet (distant figures, not walk-ons): '
        + '박준호 · 백휘성 · 임진태 · 하월영(검귀) · 제이크 밀러 · 한지원.' },
    // 파티 동행 (P6) — 편성된 슬롯만 (지시문은 renderTemplate을 타서 {party1}이 이름으로 치환)
    ...[1, 2, 3, 4].map((n) => ({
      id: `party_${n}`, when: `party${n} != '없음'`,
      text: `Party member accompanying the protagonist: {party${n}} — present in scenes by default `
        + '(dialogue, combat role, opinions per their profile) until the narrative parts ways.',
    })),
    { id: 'npc_staff', when: 'true',
      text: `Institutional figures met by function, not rank: ${roster(NPC_STAFF)}` },
    { id: 'npc_hostile', when: 'faction_on',
      text: `Hostile figures (use sparingly, for tension arcs): ${roster(NPC_HOSTILE)} `
        + '— factions: 상태창 불신론자 (anti-System extremists) · 이계 숭배단 (Gate-worship cult).' },
    // ── 이미지 명령 규칙 (원본 Image Command Instructions 승계 — 어휘는 assets 팩이 준다) ──
    { id: 'img_rules', when: 'true',
      text: 'Image rules: whenever a listed character appears, is spotlighted, or speaks, put one '
        + '<img="…"> tag in that character\'s paragraph — one tag per character, even if none were '
        + 'shown last turn. Base tag is the name alone; append an emotion only when their state '
        + 'visibly shifts. NEVER print an image for the protagonist/user. Characters not in the '
        + 'lists are extras: use <img="Male"> or <img="Female"> only, no emotion.' },
    // 의뢰 보드 (P8) — 수락 전 대기열이라는 것을 메인도 알아야 한다
    { id: 'offer_rule', when: 'true',
      text: 'The offers board lists OPEN commissions no one has taken — picking one up requires '
        + 'accepting it in the scene (association terminal, guild desk, the client). Only then does '
        + 'it become an active quest. Never treat an unaccepted offer as already in progress.' },
  ],

  updater: {
    contextTurns: 2,
    guide: '헌터물 기록 기준: 게이트 안 전투가 있었으면 그 턴에 HP/MP/SP 소모·소모품 사용·전리품'
      + '(마정석 등 items)·EXP를 함께 정산하라. 근거 없는 수입·EXP는 적지 마라. 시간(skip_day)은 '
      + '날짜가 실제로 넘어갔을 때만 — 유저가 "한 달 후"·"1년 후"처럼 건너뛰면 그 일수(30·365)를 '
      + '깎지 말고 그대로 적어라. 스탯은 stat_pts를 소모하는 분배 장면에서만 올린다. '
      + '게이트 안에서는 탐사도(explore)·현재 구역(gate_room)·조사 포인트(gate_poi)를 장면에 맞춰 갱신하라.',
    allow: [
      { id: 'skip_day', maxGain: 3650 },
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
      { id: 'offers' },
      { id: 'npc_notes' },
      { id: 'allies' },
      { id: 'in_gate' },
      // 던전 탐사 (P9) — 탐사도는 상승 전용 (지도를 잊을 수는 없다), 리셋은 시스템 몫
      { id: 'explore', maxGain: 15, maxLoss: 0 },
      { id: 'gate_room', maxLength: 30 },
      { id: 'gate_poi', maxLength: 60 },
      { id: 'foe' },
      { id: 'gates' },
      { id: 'break_name', maxLength: 30 },
      { id: 'break_in', maxGain: 30, maxLoss: 30 },
      // 원화: 상한은 경제 밸브가 아니라 뇌절 백스톱 (2026-08-30 재설계). 5백만 상한이
      // 정상 정산(720만)을 잘라 서사와 장부가 어긋났고, 분할 서사는 유령 잔금이 된다 —
      // 금액의 1차 방어는 economy 시세표, 여기는 터무니없는 액수만 막는다. S급 정산(5억+)도
      // 한 방에 통과하는 10억. 손실도 10억 (min 0이 받친다).
      { id: 'won', maxGain: 1000000000, maxLoss: 1000000000 },
      { id: 'coin', maxGain: 50, maxLoss: 500 },
    ],
  },

  // ⚠ 장면 앵커 (2026-08-31 유저 제보: "순정과 달리 스토리를 혼자 몇 편 건너뛴다").
  // 원본은 always-on 로어북 두 장(상태창 6.7K + 시스템 메시지 4.8K)이 매 응답마다 모델에게
  // "지금 시각·위치·퀘스트 진행"을 직접 쓰게 시켰고, 그게 곧 진행 폭의 앵커였다. 심코어는
  // 그 기록을 시스템이 대신하면서(토큰이 준 이유) 앵커까지 같이 걷어냈다 — 남은 지시문 14종에
  // 응답 한 통이 다룰 폭을 정하는 줄이 하나도 없어서 모델이 제 기본값(요약 진행)으로 돌아갔다.
  // pacing 지시문은 사건의 '강도'(파국 금지) 담당이라 이 구멍을 못 막는다.
  // 자리는 systemGuide — 지시문 층은 에셋 사전(7K자) 앞이라 묻힌다. 여기가 프롬프트 끝자락이다.
  promptState: {
    // ⚠ 상태 블록 (2026-09-01) — 이식 때 통째로 빠져 있던 칸. 내장 템플릿 16종은 16/16이
    // 이걸 채우는데 얼헌만 비어 있었고, 그래서 **메인 모델이 날짜·시각·위치·소지금을
    // 하나도 못 봤다**. 상태창(7.5K자 HTML)은 display 훅 산물이라 모델에 안 가고,
    // 채팅 변수 미러(chat.scriptstate)는 CBS로 불러 써야 프롬프트에 드는데 이식 때
    // 원본 CBS를 전부 구워버려서 읽는 곳이 한 군데도 없었다 — 값이 새는 유일한 샛길이던
    // 지시문 6개도 {stat_pts}·{break_in}뿐. 즉 메인은 "지금 언제 어디"를 모른 채 썼다.
    // 원본이 always-on 로어북 6.7K자로 하던 일을 300자로 되살린다 (토큰 이득은 유지).
    template: '[현재 상태 — 시스템이 관리하는 사실이다. 이 값과 어긋나게 쓰지 마라]\n'
      + '지금: {date} ({weekday}) {time} · {weather} · {location}\n'
      + '주인공: {license}랭크 Lv{level} · {job} · {guild} · 명성 {fame}\n'
      + '몸: HP {hp}/{hp_max} · MP {mp}/{mp_max} · SP {sp}/{sp_max}\n'
      + '지갑: {won}원 · {coin}코인 | 장비: {armor} / {weapons}\n'
      + '소지품: {items}\n'
      + '진행 중 퀘스트: {quests}',
    systemGuide: '이 세계는 시스템 창이 뜨는 세계다 — 레벨업·스킬 습득·퀘스트 발생 같은 시스템 사건은 '
      + '본문 문단 사이 `[시스템] …` 한 줄로 짧게 연출하라. 수치 정산은 상태 블록의 몫이니 '
      + '숫자를 본문에 나열하지 마라. '
      + '진행은 한 응답에 한 장면이다 — 지금 이 자리에서 벌어지는 일을 끝까지 그리고 거기서 멈춰라. '
      + '여러 국면을 요약해 건너뛰거나(접수·측정·구인·입장을 한 통에), 유저가 아직 겪지 않은 장면을 '
      + '이미 지난 일처럼 언급하지 마라. 장면을 넘길지는 유저가 정한다.',
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

  // ── 헌터넷 (P4) — 커뮤니티 보드 (v0.95 엔진 기능) ──
  // 원본 헌터넷의 개념만 승계한 자체 구현. 게이트 안(in_gate)에서는 새 글이 안 올라온다
  // (단말기 통신 두절 — 원본 로어북 "Inaccessible in Gates" 승계).
  board: {
    label: '헌터넷', icon: '🌐',
    topics: '게이트 출현·공략 소식, 헌터 목격담과 소문, 장비·마정석 시세, 협회/길드 뒷말, '
      + '랭크 측정 후기, 몬스터 정보 공유, 각성 관련 잡담, 성인 칸의 음지 잡담',
    guide: 'Anonymous hunter forum in Korean internet-community register: 반말, 마침표 생략, '
      + '축약·밈·드립, 낚시글과 헛소문 섞임. 닉네임은 짧은 한국어 (예: ㅇㅇ, 각성실패자, '
      + '노원구주민, 창술만12년). 글이 다 진실일 필요 없다 — 과장·유언비어·광고성 글도 게시판의 결이다. '
      + 'Posts reference the current gates board, recent public events, and famous hunters. '
      + '모집 칸 글은 "구역/게이트 등급/구하는 역할·인원" 꼴 (예: 동북권 D급, 탱커 1 딜러 2 구함). '
      + '유저의 모집 글에는 명단(cast)의 헌터가 지원 댓글을 달 수 있다 — 유저 랭크대에 맞는 인물만, 실명으로. '
      // 성인 칸 (원본 헌터넷 2대 인기 코너 승계) — 익명 음지판의 결. 수위는 열되 정보 규칙은 같다.
      + '성인 칸은 익명 음지 게시판이다: 디시식 반말·저속한 드립 그대로, 수위 제한 없이 — 헌터 대상 '
      + '망상글, 게이트 뒤풀이·원나잇 후기, 만남 구인, 짤 내놔 드립, 던전 텐트 썰. 진지함 금지, '
      + '허세와 구라가 반쯤. 실명 헌터를 소재로 삼는 건 소문·망상 수준까지만 — 전지적 정보 금지는 '
      + '여기도 같다. 성인 칸 글은 반드시 cat을 "성인"으로.',
    categories: ['자유', '정보', '모집', '성인'],
    // 자율형 [4,5] (v1.1.0) — 반응형 2였을 땐 매턴 주인공 서사가 박제돼 다양성이 죽었다
    // (유저 지목). 이제 매턴 4~5글, 대부분 주인공 무관한 세계의 글. maxPosts 20 롤링 유지.
    postsPerTurn: [4, 5], maxPosts: 20,
    // 현재 화제 (v1.1.0) — 5턴마다 갱신되는 세계급 뉴스 기사. 게시글과 별개의 고정 슬롯.
    hot: {
      label: '현재 화제', every: 5,
      guide: '헌터 전문지·속보 기사체(존댓말 데스크 톤, 커뮤니티 반말 금지). 소재 로테이션: '
        + 'S랭크 헌터의 근황·이적·스캔들, 게이트 브레이크에서 활약한 무명 헌터 특집, 협회 '
        + '정책·연구 발표, 대형 길드 동향, 해외 게이트 소식, 신기록·경매 낙찰가. 실존 '
        + '명단(cast) 인물은 공개 활동 수준까지만.',
    },
    when: 'not in_gate',
    // 패널 스킨 — 상태창과 같은 다크네이비/스틸블루 규격 (a-* 팔레트)
    css: `
.scg-card.scb-wide { background: linear-gradient(145deg, #13151c, #1c1f29); border-color: rgba(82,110,157,.35); }
.scg-title { color: #8aa2cc; font-family: 'Rajdhani', 'Noto Sans KR', sans-serif; letter-spacing: 1px; }
.scb-btn { background: rgba(25,30,40,.7); border-color: rgba(138,162,204,.3); color: #c5d0e6; }
.scb-btn:hover { background: rgba(138,162,204,.15); border-color: #8aa2cc; }
.scb-row { border-bottom-color: rgba(138,162,204,.12); }
.scb-row:hover { background: rgba(138,162,204,.07); }
.scb-row .scb-title { color: #dce6f5; }
.scb-view-title { color: #dce6f5; }
.scb-body { background: rgba(10,12,18,.6); border-color: rgba(138,162,204,.15); color: #c5d0e6; }
.scb-re { border-top-color: rgba(138,162,204,.12); }
.scb-re .scb-re-a { color: #8aa2cc; }
.scb-input, .scb-ta { background: rgba(10,12,18,.6); border-color: rgba(138,162,204,.2); color: #dce6f5; }
.sch-tab { background: rgba(25,30,40,.7); border-color: rgba(138,162,204,.3); color: #c5d0e6; }
.sch-tab.sch-on { background: #33549e; border-color: #8aa2cc; }`,
  },

  // ── 파티 + 게이트 지도 (P6) — 편성표 (v0.55 탭 + v0.89 대장 템플릿·fab) ──
  // 영입은 이야기가(allies — 보조·/동료), 편성은 버튼이(party1~4 — 패널 전용).
  // 지도는 새 패널이 아니라 대장 템플릿 탭: {gates:tags:권역}(v0.98 필터)이 게이트 보드를
  // 서울 5권역 칸에 나눠 꽂는다. fab 🗺️로 바로 열린다.
  party: {
    label: '파티', icon: '🤝', empty: '없음',
    tabs: [
      { id: 'members', label: '파티 편성', roster: 'allies',
        note: '동료 명부에 오른 헌터만 편성할 수 있어요 — 영입(모집글·섭외)은 이야기에서.',
        slots: [{ var: 'party1' }, { var: 'party2' }, { var: 'party3' }, { var: 'party4' }] },
      { id: 'map', label: '게이트 지도', fab: '🗺️',
        template: `
<div class="hmap">
  <div class="hmap-head">SEOUL GATE MAP<span class="hmap-hz">위험도 {hazard}</span></div>
  <div class="hmap-grid">
    <div class="hmap-zone hmz-nw"><div class="hmap-zn">서북권</div><div class="hmap-zd">은평 · 서대문 · 마포</div>{gates:tags:서북권}</div>
    <div class="hmap-zone hmz-ne"><div class="hmap-zn">동북권</div><div class="hmap-zd">성북 · 노원 · 강북</div>{gates:tags:동북권}</div>
    <div class="hmap-zone hmz-ct"><div class="hmap-zn">도심권</div><div class="hmap-zd">종로 · 중구 · 용산</div>{gates:tags:도심권}</div>
    <div class="hmap-zone hmz-sw"><div class="hmap-zn">서남권</div><div class="hmap-zd">양천 · 구로 · 영등포 · 관악</div>{gates:tags:서남권}</div>
    <div class="hmap-zone hmz-se"><div class="hmap-zn">동남권</div><div class="hmap-zd">서초 · 강남 · 송파 · 강동</div>{gates:tags:동남권}</div>
  </div>
  <div class="hmap-foot">최근 출현: {zone_txt} · 기한(@+N)이 지난 게이트는 다른 헌터들이 공략한다</div>
</div>` },
      // 의뢰 보드 (P8) — 발주처 접두([협회]/[길드]/[개인])가 칸 분류 키
      { id: 'questboard', label: '의뢰 보드', fab: '📋',
        template: `
<div class="hqb">
  <div class="hmap-head">QUEST BOARD<span class="hmap-hz">수락은 이야기에서</span></div>
  <div class="hqb-grid">
    <div class="hmap-zone"><div class="hmap-zn">협회</div><div class="hmap-zd">공인 의뢰 · 토벌 지원</div>{offers:tags:[협회]}</div>
    <div class="hmap-zone"><div class="hmap-zn">길드</div><div class="hmap-zd">소속 길드 내부 의뢰</div>{offers:tags:[길드]}</div>
    <div class="hmap-zone"><div class="hmap-zn">개인·사설</div><div class="hmap-zd">사연 있는 일감</div>{offers:tags:[개인]}</div>
  </div>
  <div class="hqb-foot">진행 중 퀘스트는 상태창에 · 기한(@+N)이 지난 의뢰는 다른 헌터가 가져간다</div>
</div>` },
    ],
    // 상태창과 같은 다크네이비/스틸블루 규격 + 지도 전용 스타일
    css: `
.scg-card { background: linear-gradient(145deg, #13151c, #1c1f29); border-color: rgba(82,110,157,.35); }
.scg-title { color: #8aa2cc; font-family: 'Rajdhani', 'Noto Sans KR', sans-serif; letter-spacing: 1px; }
.hmap-head { display: flex; justify-content: space-between; align-items: baseline; color: #8aa2cc;
  font-family: 'Rajdhani', 'Noto Sans KR', sans-serif; font-weight: 700; letter-spacing: 2px; margin: 2px 0 8px; }
.hmap-hz { font-size: 11.5px; color: #c9a86a; letter-spacing: 0; }
.hmap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  grid-template-areas: 'nw ne' 'ct ct' 'sw se'; }
.hmz-nw { grid-area: nw } .hmz-ne { grid-area: ne } .hmz-ct { grid-area: ct }
.hmz-sw { grid-area: sw } .hmz-se { grid-area: se }
.hmap-zone { border: 1px solid rgba(138,162,204,.22); border-radius: 10px; padding: 8px 9px;
  background: rgba(10,12,18,.55); min-height: 72px; }
.hmap-zn { color: #8aa2cc; font-weight: 700; font-family: 'Rajdhani', 'Noto Sans KR', sans-serif;
  letter-spacing: 1px; font-size: 13px; }
.hmap-zd { color: #5f6c85; font-size: 10.5px; margin: 1px 0 6px; }
.hmap-zone .sim-tag { display: block; width: fit-content; max-width: 100%; margin: 3px 0;
  background: rgba(138,162,204,.1); border: 1px solid rgba(138,162,204,.28); border-radius: 7px;
  padding: 2px 7px; color: #dce6f5; font-size: 11.5px; }
.hmap-zone .sim-empty { color: #4d5870; font-size: 11px; }
.hqb-grid { display: grid; gap: 8px; }
.hqb-foot { color: #5f6c85; font-size: 10.5px; margin-top: 8px; }
.hmap-foot { margin-top: 8px; color: #7d8aa5; font-size: 11px; border-top: 1px dashed rgba(138,162,204,.18);
  padding-top: 6px; }`,
  },

  // ── 단말기 메신저 (P4.7) — 메신저 (v1.2.0 엔진 기능) ──
  // 유저 제안: "헌터 단말기답게 연락처 교환한 상대와 문자". 연락처 풀 = allies 동료 명부
  // ("파티를 맺을 정도면 연락처는 안다" — 유저 결정). 게이트 안 통신 두절은 헌터넷과 동일.
  // 활성 방 하나만 서사로 전달 — 나머지는 순수 패널 대화 (토큰 설계의 핵심, 유저 안).
  messenger: {
    label: '단말기', icon: '📱',
    contactsVar: 'allies', notesVar: 'npc_notes',
    firstChance: 0.25, cooldown: 3,
    guide: '헌터들의 문자 말투: 짧고 용건 위주, 이모티콘·초성체(ㅇㅋ, ㄱㄱ, ㅅㄱ) 섞임. '
      + '인물별 말투·성격은 로어북/명단 프로필 그대로 — 문자라고 캐릭터가 바뀌지 않는다. '
      + '단골 소재: 게이트 일정 맞추기, 의뢰 나눠 갖기, 정산 얘기, 안부, 시답잖은 짤 얘기. '
      + '관계 진전은 서사에서 실제 벌어진 일까지만 반영.',
    when: 'not in_gate',
    // 상태창과 같은 다크네이비/스틸블루 규격 — 말풍선만 단말기 느낌으로
    css: `
.scg-card.scb-wide { background: linear-gradient(145deg, #13151c, #1c1f29); border-color: rgba(82,110,157,.35); }
.scg-title { color: #8aa2cc; font-family: 'Rajdhani', 'Noto Sans KR', sans-serif; letter-spacing: 1px; }
.scm-bubble { background: rgba(25,30,40,.85); border-color: rgba(138,162,204,.3); }
.scm-mine .scm-bubble { background: #33549e; border-color: #8aa2cc; }
.scm-from { color: #8aa2cc; }
.scb-btn { background: rgba(25,30,40,.7); border-color: rgba(138,162,204,.3); color: #c5d0e6; }
.scb-btn:hover { background: rgba(138,162,204,.15); border-color: #8aa2cc; }`,
  },

  // ── 알터 스토어 (P4.5) — 상점 (v0.96 엔진 기능) ──
  // 원본 로어북 상점의 고질병(유저 지목): "S랭크 스킬북 뇌절 + 가격 계산 힘듦" →
  // 등급 어휘·가격 밴드를 여기 못박아 시스템이 강제한다. 코인 경제 기준: E랭크 킬 1~5C.
  shop: {
    label: '알터 스토어', icon: '🛒',
    currency: 'coin', buyTo: 'items', sellFrom: 'items',
    categories: ['추천', '인기', '소모품', '장비', '스킬북', '기타'],
    // 2축 등급 (GEAR_GRADES/BANDS 상수 참고) — "E급 유니크"처럼 랭크급+희귀도 짝 표기 강제.
    // 맨 희귀도("유니크")만 쓰면 어휘 밖이라 거부된다 — 짝 표기를 시스템이 지킨다.
    grades: GEAR_GRADES,
    bands: GEAR_BANDS,
    // ⚠ guide는 한 키로만 — 예전에 guide가 두 번 선언돼 뒤 것이 앞 것을 덮는 사고가 있었다
    // (2축 짝 표기 지시가 통째로 죽어 있었음). 코인 기준·짝 표기·큐레이션을 전부 여기 병합.
    guide: 'Coin economy baseline: an E-rank monster kill pays 1~5 Coin — price everything relative '
      + 'to that. Practical hunter goods (potions, whetstones, antidotes, mana crystals, skill books, '
      + 'gear). 진열은 주인공 라이선스 ±1랭크대 위주로. 등급은 반드시 "랭크급 희귀도" 짝 표기 '
      + '(예: D급 레어). 레전드는 극히 드물게 — 한 입고에 최대 1개. 추천/인기 are curation '
      + 'shelves — reuse items from other categories with a hook. Occasional 한정 상품 (qty).',
    // perCat: 총량 지시만으로는 카테고리당 2~3개로 뭉개졌다 (유저 지목) → 카테고리마다 4~6개.
    // 6카테고리 × 6 = 36이 maxStock 상한.
    sellRate: 0.6, maxStock: 36, perCat: [4, 6],
    when: 'store_on',
    // 환전 — 원작 캐논: 코인의 공식 거래는 금지, 블랙 마켓만 예외 (시세 1코인 ≈ ₩1,000).
    // spread 0.2가 암거래 리스크 프리미엄: 살 때 1,200원 / 팔 때 800원.
    exchange: { var: 'won', rate: 1000, spread: 0.2, label: '암거래 환전' },
    // 상태창과 같은 다크네이비/스틸블루 규격
    css: `
.scg-card.scb-wide { background: linear-gradient(145deg, #13151c, #1c1f29); border-color: rgba(82,110,157,.35); }
.scg-title { color: #8aa2cc; font-family: 'Rajdhani', 'Noto Sans KR', sans-serif; letter-spacing: 1px; }
.sch-tab { background: rgba(25,30,40,.7); border-color: rgba(138,162,204,.3); color: #c5d0e6; }
.sch-tab.sch-on { background: #33549e; border-color: #8aa2cc; }
.sch-item { border-bottom-color: rgba(138,162,204,.12); }
.sch-item .sch-name { color: #dce6f5; }
.sch-grade { border-color: rgba(138,162,204,.3); color: #8aa2cc; }
.sch-price { color: #c9a86a; }
.scb-btn { background: rgba(25,30,40,.7); border-color: rgba(138,162,204,.3); color: #c5d0e6; }
.scb-btn:hover { background: rgba(138,162,204,.15); border-color: #8aa2cc; }
.sch-wallet { color: #c9a86a; }`,
  },

  // ── 에셋 팩 (P5) — 원본 이미지 지침의 심코어 이관 (2026-08-29 유저 제공 지침서) ──
  // 계기: 팩을 모듈 매니페스트(⚙simcore-pack)로 실었더니 모듈 업데이트마다 날아감 —
  // 스키마 소유로 옮기면 신안 재적용이 곧 복원이다. 이미지 실물은 여전히 에셋 모듈에 산다
  // (verify:false — 이름 목록 대조 불가 환경). moduleManifests는 켜 둔다 (애드온 통로 +
  // 매니페스트 모듈 이미지의 실존 대조 합류, id 충돌은 스키마 우선이라 안전).
  // by:'main' — 원본과 같은 결: 메인이 인물 문단마다 인라인으로 태그를 찍는다
  // (다인원 동시 표시 — aux 1장 모드로는 원본 UX 재현 불가). 규칙은 img_rules 지시문.
  assets: {
    by: 'main',
    moduleManifests: true,
    packs: [
      {
        id: 'sexual_scene_positions',
        source: '얼헌 원본 Sexual scene Character Image Guidelines',
        sep: ' ', format: '<img="{name}">', verify: false,
        usage: '성애 장면 필수 — 체위·국면에 맞는 태그를 문맥대로. 여성 인물 전용.',
        slots: [
          { id: 'who', label: '인물', values: [
            'Min Chae-rin', 'Song Ha-neul', 'Alice Croft', 'Isabelle Hayes', 'Lim Seol-hee',
            'Lee Ha-eun', 'Choi Yu-na', 'Ha Wol-young', 'Han Ji-won', 'Han Seo-yeon',
            'Go Eun-bi', 'Yoon Mirae', 'Choi Yoo-jin', 'Joo Ah-ram', 'Kang Yoo-ra',
            'Jang Eun-seo', 'Na Sun-young', 'Sasaki Yua', 'Rivea', 'Oh Ha-na',
            'Jin So-hee', 'Yoo Sun-hwa', 'Lee Ji-hye', 'Park So-won', 'Chae Ha-yoon',
            'Baek Eun-ha', 'Park Hye-in', 'Lee So-yoon',
          ], fallback: 'Min Chae-rin' },
          { id: 'position', label: '체위 및 동작', values: [
            'cowgirl after sex', 'cowgirl ejaculation', 'cowgirl grinding', 'cowgirl happy sex',
            'cowgirl hard sex', 'cowgirl imminent penetration', 'cowgirl sex',
            'doggystyle after sex', 'doggystyle ejaculation', 'doggystyle fingering',
            'doggystyle happy sex', 'doggystyle hard sex', 'doggystyle imminent penetration',
            'doggystyle sex', 'handholding cowgirl after sex', 'handholding cowgirl ejaculation',
            'handholding cowgirl grinding', 'handholding cowgirl happy sex',
            'handholding cowgirl hard sex', 'handholding cowgirl imminent penetration',
            'handholding cowgirl sex', 'handholding missionary after sex',
            'handholding missionary ejaculation', 'handholding missionary fingering',
            'handholding missionary happy sex', 'handholding missionary hard sex',
            'handholding missionary imminent penetration', 'handholding missionary sex',
            'missionary after sex', 'missionary ejaculation', 'missionary fingering',
            'missionary happy sex', 'missionary hard sex', 'missionary imminent penetration',
            'missionary sex', 'reverse standing after sex', 'reverse standing ejaculation',
            'reverse standing fingering', 'reverse standing happy sex', 'reverse standing hard sex',
            'reverse standing imminent penetration', 'reverse standing sex', 'standing after sex',
            'standing ejaculation', 'standing fingering', 'standing happy sex', 'standing hard sex',
            'standing imminent penetration', 'standing sex', 'upright straddle after sex',
            'upright straddle ejaculation', 'upright straddle grinding',
            'upright straddle happy sex', 'upright straddle hard sex',
            'upright straddle imminent penetration', 'upright straddle sex',
          ], fallback: 'missionary sex' },
        ],
      },
      {
        id: 'sexual_scene_alter_nsfw',
        source: '얼헌 원본 Sexual scene Guidelines (alterNSFW)',
        sep: ' ', format: '<img="{name}">', verify: false,
        when: 'alter_on',   // 원본 toggle_alterNSFW=2 승계 — /수위 로 온오프
        usage: '확장 수위 — 추가 행위·특수 상황·상태 묘사. 여성 인물 전용.',
        slots: [
          { id: 'who', label: '인물', values: [
            'Min Chae-rin', 'Song Ha-neul', 'Alice Croft', 'Isabelle Hayes', 'Lim Seol-hee',
            'Lee Ha-eun', 'Choi Yu-na', 'Ha Wol-young', 'Han Ji-won', 'Han Seo-yeon',
            'Go Eun-bi', 'Yoon Mirae', 'Choi Yoo-jin', 'Joo Ah-ram', 'Kang Yoo-ra',
            'Jang Eun-seo', 'Na Sun-young', 'Sasaki Yua', 'Rivea', 'Oh Ha-na',
            'Jin So-hee', 'Yoo Sun-hwa', 'Lee Ji-hye', 'Park So-won', 'Chae Ha-yoon',
            'Baek Eun-ha', 'Park Hye-in', 'Lee So-yoon',
          ], fallback: 'Min Chae-rin' },
          { id: 'action', label: '행위 및 상태', values: [
            'after sex', 'anal after sex', 'anal ejaculation', 'anal happy sex',
            'anal imminent penetration', 'anal sex', 'bathing', 'buttjob over clothes',
            'cum on back', 'cum on belly', 'cum on face', 'cunnilingus', 'deepthroat',
            'fellatio', 'fellatio cum', 'fellatio skilled', 'finger sucking', 'footjob',
            'footjob cum', 'french kiss during sex', 'grabbing breast', 'grabbing breast open bra',
            'grabbing breast open clothes', 'handjob', 'handjob over clothes', 'licking glans',
            'licking testicle', 'masturbation', 'mixed-bathing washing back',
            'mixed-bathing washing body', 'mixed-bathing washing hair', 'nipple pull open bra',
            'nude', 'nude grabbing breast', 'nude nipple pull', 'orgasm', 'paizuri', 'paizuri cum',
            'pillow humping', 'reverse cowgirl after sex', 'reverse cowgirl ejaculation',
            'reverse cowgirl happy sex', 'reverse cowgirl imminent penetration',
            'reverse cowgirl sex', 'reverse footjob', 'reverse footjob cum',
            'sexual frustration doggystyle', 'sexual frustration sitting',
            'sexual frustration standing', 'underwear', 'kiss', 'imminent kiss', 'after kiss',
            'french kiss', 'cheek pulling', 'headpat', 'acting cute double v',
            'acting cute heart hands', 'acting cute Rabbit',
          ], fallback: 'kiss' },
        ],
      },
      // 추가 복장 모듈 (2026-08-30 유저 제공 지침) — 원본 지침 3절(Casual/Homewear/Underwear)을
      // 팩 하나로 접었다: 복장을 필수 칸으로 두면 인물+복장 구조라 감정 팩(인물만 필수)과
      // 구조 공존하고, 감정 어휘도 한 번만 실린다 (원본은 절마다 감정 51종 전문 반복 — 3배 길이).
      // "평상시 = 태그 없음(기본 복장)"은 이 팩을 안 쓰는 것 — 기본 1장은 감정 팩 담당.
      {
        id: 'outfits',
        source: '얼헌 추가 복장 에셋 모듈 (Casual/Homewear/Underwear Guidelines)',
        sep: ' ', format: '<img="{name}">', verify: false,
        // 인물별 보유 목록·끝번호(1/2)·세부번호(2-1 등)는 usage에 안 싣는다 — 원본 지침부터
        // "로어북 참조"고, 그 인물별 표기는 추가 모듈 로어북이 이름 키워드로 띄운다.
        // 여기는 불변 규칙만 (매 턴 실리는 한 줄 — 200자 린트).
        usage: '환복이 명시될 때만 — 평상시는 태그 없음(기본 복장). Casual은 사적·친밀 상황만'
          + '(공무·초면 금지), Homewear는 자택, Underwear는 속옷. 보유·끝번호(1추움/2더움)·'
          + '세부번호는 로어북 표기대로만. School uniform=Choi Yu-na 등하교, '
          + 'Underworld Samurai=Sasaki Yua 전투.',
        slots: [
          { id: 'who', label: '인물', values: [
            'Go Eun-bi', 'Baek Eun-ha', 'Lee So-yoon', 'Sasaki Yua', 'Isabelle Hayes',
            'Park Hye-in', 'Han Seo-yeon', 'Han Ji-won', 'Choi Yoo-jin', 'Min Chae-rin',
            'Jang Eun-seo', 'Jin So-hee', 'Kang Yoo-ra', 'Yoo Sun-hwa', 'Park So-won',
            'Lim Seol-hee', 'Joo Ah-ram', 'Oh Ha-na', 'Kim Min-soo', 'Im Jin-tae',
            'Na Sun-young', 'Chae Ha-yoon', 'Lee Ha-eun', 'Yoon Mirae', 'Rivea',
            'Song Ha-neul', 'Ha Wol-young', 'Choi Yu-na', 'Lee Ji-hye', 'Alice Croft',
          ], fallback: 'Go Eun-bi' },
          { id: 'outfit', label: '복장', values: [
            'Casual clothes', 'Casual clothes1', 'Casual clothes2',
            'Casual clothes 2-1', 'Casual clothes 2-2',
            'Homewear', 'Homewear1', 'Homewear2', 'Underwear',
            'School uniform', 'School uniform1', 'School uniform2', 'Underworld Samurai',
          ], fallback: 'Casual clothes' },
          { id: 'emo', label: '감정', optional: true, values: [
            'acting coy', 'angry', 'annoyed', 'aroused', 'blushing shyly', 'bored', 'bridling',
            'chuunibyou', 'confused', 'contemptuous', 'coughing', 'crying with eyes closed',
            'crying with eyes open', 'curious', 'default', 'depressed', 'determined',
            'disappointed', 'embarrassed', 'enraged', 'eureka', 'full-face blush', 'giggling',
            'grudging', 'guilty', 'happy tears', 'indifferent', 'jealous', 'lustful',
            'middle finger', 'nervous pouting', 'nervous', 'pouting', 'proud', 'sad', 'serious',
            'smile', 'smirk', 'smug', 'sniggering', 'stupefied', 'surprised', 'suspicious',
            'thinking', 'worried', 'disgusted', 'scared', 'excited', 'relieved', 'laughing',
            'pleading', 'imminent kiss', 'kiss', 'after kiss', 'cheek', 'cheek pulling', 'headpat',
          ], fallback: 'default' },
        ],
      },
      {
        id: 'char_emotions',
        source: '얼헌 원본 Characters/Status Command List',
        sep: ' ', format: '<img="{name}">', verify: false,
        // v1.4.0 문구 수정 — "감정이 크게 움직이면"이 콜드 스타트를 만들던 실사고
        // (배포 유저 "에셋이 안 든다" + 제작자 실기 "0장이다가 한두 번 나오면 그 뒤로 잘 나옴").
        // 감정 칸을 예외가 아니라 기본 동작으로: 발화마다 대화문 앞에 이름+감정.
        usage: '인물이 등장하거나 말할 때마다 대화문 앞에 1장 — 이름+지금 감정으로. 감정을 못 고르겠으면 이름만(기본 표정).',
        slots: [
          { id: 'who', label: '인물', values: [
            'Kang Min-hyuk', 'Kim Min-soo', 'Min Chae-rin', 'Baek Hwi-Sung', 'Song Ha-neul',
            'Alice Croft', 'Isabelle Hayes', 'Im Jin-tae', 'Lim Seol-hee', 'Lee Ha-eun',
            'Jake Miller', 'Choi Min-jun', 'Choi Tae-joon', 'Choi Yu-na', 'Ha Wol-young',
            'Han Ji-won', 'Han Seo-yeon', 'Haru Ito', 'Go Eun-bi', 'Yoon Mirae',
            'Choi Yoo-jin', 'Seo Ji-han', 'Kang Yoo-ra', 'Joo Ah-ram', 'Jang Eun-seo',
            'Na Sun-young', 'Sasaki Yua', 'Rivea', 'Yoo Jin-hyuk', 'Oh Ha-na',
            'Jin So-hee', 'Park Jun-ho', 'Kang Woo-seok', 'Yoo Sun-hwa', 'Lee Ji-hye',
            'Park So-won', 'Kang Tae-shik', 'Yoon Ji-ho', 'Chae Ha-yoon', 'Kwon Jae-hyun',
            'Yoo Jin-seong', 'Kwon Do-yoon', 'Ahn Do-hyun', 'Shin Woo-hyun', 'Baek Eun-ha',
            'Park Hye-in', 'Lee So-yoon', 'Choi Tae-hyun',
          ] },
          { id: 'emo', label: '감정', optional: true, values: [
            'acting coy', 'angry', 'annoyed', 'aroused', 'blushing shyly', 'bored', 'bridling',
            'chuunibyou', 'confused', 'contemptuous', 'coughing', 'crying with eyes closed',
            'crying with eyes open', 'curious', 'default', 'depressed', 'determined',
            'disappointed', 'embarrassed', 'enraged', 'eureka', 'full-face blush', 'giggling',
            'grudging', 'guilty', 'happy tears', 'indifferent', 'jealous', 'lustful',
            'middle finger', 'nervous pouting', 'nervous', 'pouting', 'proud', 'sad', 'serious',
            'smile', 'smirk', 'smug', 'sniggering', 'stupefied', 'surprised', 'suspicious',
            'thinking', 'worried', 'disgusted', 'scared', 'excited', 'relieved', 'laughing',
            'pleading',
          ], fallback: 'default' },
        ],
      },
      {
        id: 'extra_char',
        source: '얼헌 원본 Extra Character Image Guidelines',
        sep: ' ', format: '<img="{name}">', verify: false,
        usage: '명단에 없는 엑스트라 전용 — Male/Female만, 감정 칸 없이.',
        slots: [{ id: 'who', label: '엑스트라', values: ['Male', 'Female'] }],
      },
    ],
  },
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
    // 성신의 가호 — 세계 배너 (인적 정보가 아니라 top-info-bar 바로 아래). 꺼짐/미점화은 — → —
    + '<div class="a-row"><span>🌠 성신의 가호</span><span class="v">{boon_quirk} → {boon_perk}</span></div>'
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
    // 던전 탐사 (P9) — 게이트 안에서만 값이 차고, 밖에서는 전부 — 로 접힌다
    + '<div class="a-sec">EXPLORATION</div>'
    + '<div class="a-row"><span>탐사도</span><span class="v">{explore_txt}</span></div>'
    + '<div class="a-row"><span>현재 구역</span><span class="v">{room_txt}</span></div>'
    + '<div class="a-row"><span>조사 포인트</span><span class="v">{poi_txt}</span></div>'
    + '<div class="a-sec">GATE BOARD</div>'
    + '<div class="a-row"><span>최근 출현</span><span class="v">{zone_txt} · {grade_txt}급</span></div>'
    + '<div class="a-row"><span>브레이크 경보</span><span class="v">{break_txt}</span></div>'
    // 교전 상대 — 판정 DC 소스가 눈에 보여야 잔류(리셋 깜빡)를 유저가 잡을 수 있다 (/상대 없음)
    + '<div class="a-row"><span>교전 상대</span><span class="v">{foe}</span></div>'
    + '{fight}'   // 전투 안무 게이지 칩 (v1.6.0) — 교전 중일 때만 그려진다
    + '{gates:tags}'
    + '<div class="a-sec">PEOPLE — 인물 변동</div>'
    + '{npc_notes:tags}'
    // {lastcheck}는 안 쓴다 — "마지막 굴림"이 다음 굴림까지 상시 잔류해 전투 중으로 오독됐고
    // (유저 제보), 판정 턴에는 변화 카드(🎲)가 이미 보여준다.
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

console.log('\n━━ 판정 — dice_on 정책 게이트 (호불호 온오프) ━━');
{
  const diced = S.rules.randomEvents.table.filter((r) => r.check);
  ok('판정 부착 이벤트 4종', diced.length === 4, String(diced.length));
  ok('전부 dice_on 게이트 (끄면 통째로 잠긴다)', diced.every((r) => /\bdice_on\b/.test(r.when || '')), '');
  ok('판정 id 전부 실존', diced.every((r) => S.checks.some((c) => c.id === r.check)), '');
  // 같은 시드로 dice_on만 바꿔 30턴 방치 — 켜면 판정이 굴러가고 끄면 0회
  const run = (diceOn) => {
    let t = fresh(); t.vars.dice_on = diceOn; t.vars.in_gate = true; t.vars.hazard = 80;
    let n = 0;
    for (let i = 0; i < 30; i++) {
      ({ st: t } = turn(t, {}, 700 + i));
      if (t.meta.lastCheck) { n++; t.meta.lastCheck = null; }
    }
    return n;
  };
  const on = run(true), off = run(false);
  ok(`켜면 판정이 실제로 굴러간다 (30턴 중 ${on}회)`, on >= 1, String(on));
  ok('끄면 0회 — 다른 이벤트는 그대로', off === 0, String(off));
}

console.log('\n━━ 판정 — 목표치는 상대 등급이 민다 (S랭크에서 주사위가 살아있나) ━━');
{
  const vsOf = (id, vars) => evaluate(S.checks.find((c) => c.id === id).vs,
    engine.makeLookup(S, vars), seededRng('dc', 1, 'e'));
  const modOf = (id, vars) => evaluate(S.checks.find((c) => c.id === id).mod,
    engine.makeLookup(S, vars), seededRng('dc', 2, 'e'));
  // 신인: 게이트 밖·등급 미상 → 상대는 자기 등급(E=1). 예전 공식(13~14)과 같은 체감.
  const rookie = fresh().vars;
  ok('신인 전투 DC 13대 (구공식과 동체감)', vsOf('gate_fight', rookie) === 14, String(vsOf('gate_fight', rookie)));
  // S랭크가 S게이트(grade_i 6)에 들어감 — 구공식이면 DC 14에 보정 +19로 주사위 장식.
  const sHigh = { ...fresh().vars, str: 120, level: 70, in_gate: true, grade_i: 6 };
  const dc = vsOf('gate_fight', sHigh), mo = modOf('gate_fight', sHigh);
  const need = dc - mo;   // 이 눈 이상이어야 우세
  ok(`S랭크 vs S게이트 — 성공에 굴림 ${need} 필요 (2~20 = 주사위 살아있음)`, need >= 2 && need <= 20,
    `DC ${dc}, 보정 +${mo}`);
  ok('한 급 아래(A게이트)는 벽이 3 낮다', vsOf('gate_fight', { ...sHigh, grade_i: 5 }) === dc - 3, '');
  // 게이트 등급 미상(grade_i 0)이면 자기 등급이 상대 — S랭크끼리라 여전히 팽팽
  const noGate = { ...sHigh, grade_i: 0 };
  ok('등급 미상 폴백 = 자기 등급 (S랭크 DC 28+)', vsOf('gate_fight', noGate) >= 28, String(vsOf('gate_fight', noGate)));
  // 헌터전 (foe) — 상대 주사위 없이 등급이 목표치를 민다. 우선순위: foe > 게이트 > 자기
  ok('교전 상대가 게이트 등급보다 우선 (S게이트 안에서 A헌터전 = DC -3)',
    vsOf('gate_fight', { ...sHigh, foe: 'A' }) === dc - 3, '');
  ok('교전 끝(없음)이면 게이트로 복귀', vsOf('gate_fight', { ...sHigh, foe: '없음' }) === dc, '');
  const rookieVsS = { ...rookie, foe: 'S' };
  ok('E랭크 vs S헌터 — DC 29 (절망이 맞다)', vsOf('gate_fight', rookieVsS) === 29, String(vsOf('gate_fight', rookieVsS)));
  ok('foe 보조 관리 허용 (allow 등재)', S.updater.allow.some((a) => a.id === 'foe'), '');
  // 상시 잔류 오독 건 — 상태창 템플릿에서 {lastcheck}를 뺐다
  ok('상태창에 {lastcheck} 상시 노출 없음', !S.statusUI.templates[0].template.includes('{lastcheck}'), '');
}

console.log('\n━━ 컨텍 오염 — 변종은 상시 분위기가 아니라 이벤트다 (2026-08-30) ━━');
{
  // 매턴 금지문이 "미지의 존재"를 상기시켜 첫 게이트부터 정체불명 변이체가 쏟아진 실사고
  const dir = (id) => S.directives.find((d) => d.id === id);
  ok('측정 불가 금지문에 떡밥 단어 없음', !/미지|정체불명|변종/.test(dir('no_unmeasurable').text), '');
  ok('몬스터 격 가이드 — 게이트 안에서만', dir('gate_scale').when === 'in_gate'
    && dir('gate_scale').text.includes('게이트 등급을 따른다'), '');
  const ab = S.rules.randomEvents.table.find((r) => r.id === 'aberrant');
  ok('변종 이벤트 존재 (상위 게이트·고위험 전용)', !!ab
    && ab.when === 'in_gate and (grade_i >= 4 or hazard >= 60)', ab?.when ?? '없음');
  // 신인 첫 게이트(D급·hazard 30)에서는 발화 조건 자체가 닫혀 있다
  const rk = fresh(); rk.vars.in_gate = true; rk.vars.grade_i = 2;
  ok('신인 D게이트에선 잠김', !truthy(evaluate(ab.when, engine.makeLookup(S, rk.vars), seededRng('ab', 1, 'e'))), '');
  const hi = fresh(); hi.vars.in_gate = true; hi.vars.grade_i = 5;
  ok('A게이트에선 열림', truthy(evaluate(ab.when, engine.makeLookup(S, hi.vars), seededRng('ab', 2, 'e'))), '');
}

console.log('\n━━ 환기 — 에로코미디 이벤트 5종 (alter_on 게이트) + 페이싱 지시문 ━━');
{
  const ECO_IDS = ['ero_trap_gate', 'ero_armor_meta', 'mana_expose_study', 'macho_fashion', 'succubus_gate'];
  const rows = ECO_IDS.map((id) => S.rules.randomEvents.table.find((r) => r.id === id));
  ok('에로코미디 5종 전부 존재', rows.every(Boolean), rows.map((r, i) => r ? '' : ECO_IDS[i]).join(','));
  ok('전부 alter_on 게이트 (/수위 0이면 통째 잠김)', rows.every((r) => r.when === 'alter_on'), '');
  ok('전부 저가중치·긴 쿨다운 (양념이지 주식이 아니다)',
    rows.every((r) => r.weight === 1 && r.cooldown >= 10), '');
  const off = fresh(); off.vars.alter_on = false;
  ok('수위 끄면 발화 조건 닫힘', rows.every((r) =>
    !truthy(evaluate(r.when, engine.makeLookup(S, off.vars), seededRng('ec', 1, 'e')))), '');
  const pace = S.directives.find((d) => d.id === 'pacing');
  ok('페이싱 지시문 상시 (뇌절 방지 환기)', !!pace && pace.when === 'true'
    && pace.text.includes('파국으로 키우지 마라'), '');
}

console.log('\n━━ 모델용 상태 블록 — 메인이 "지금 언제 어디"를 아는 유일한 통로 ━━');
{
  // 이식 때 통째로 빠져 있던 칸 (2026-09-01 규명). 상태창은 화면 전용이고 채팅 변수 미러는
  // 읽는 곳이 없어서, 이게 없으면 메인 모델은 날짜도 소지금도 모른 채 쓴다 — "서사가 날아간다"의 뿌리.
  const t = fresh();
  const pb = engine.sendPhase(S, t, { rng: seededRng('st', 1, 's') }).promptBlock;
  ok('상태 블록이 프롬프트에 실림', pb.includes('[현재 상태'), pb.slice(0, 80));
  ok('★ 날짜·요일·시각·위치 노출', /2026-03-02 \(.\) .*아침/.test(pb) && pb.includes('헌터 협회 본부'),
    (pb.match(/지금:.*/) || [''])[0]);
  ok('★ 소지금·HP 노출', pb.includes('500000원') && pb.includes('HP 100/100'),
    (pb.match(/지갑:.*/) || [''])[0]);
  ok('맨 앞자리 (대화 맥락보다 먼저 서는 사실)', pb.indexOf('[현재 상태') === 0, String(pb.indexOf('[현재 상태')));
  ok('미치환 자리표시자 없음', !/\{[a-z_]+\}/.test((pb.match(/\[현재 상태[\s\S]*?\n\n/) || [''])[0]), '');
  const v = SC.require('validate').validateSchema(S);
  ok('상태 블록 누락 경고 안 뜸', !v.warnings.some((w) => w.path === '$.promptState.template'), '');
}

console.log('\n━━ 장면 앵커 — 한 응답 = 한 장면 (원본 상태창 출력이 하던 몫) ━━');
{
  // 제보: "순정과 달리 2·4·6·7을 안 그리고 혼자 진행해 버린다". 원본의 always-on 상태창/시스템
  // 메시지가 매 턴 현재 시점을 쓰게 만들던 앵커였는데, 심코어가 그 기록을 가져가며 같이 사라졌다.
  const sg = (S.promptState || {}).systemGuide || '';
  ok('진행 폭 규칙 존재 (한 응답 = 한 장면)', sg.includes('한 응답에 한 장면'), sg.slice(0, 60));
  ok('요약 건너뛰기 금지 + 미체험 장면 선취 금지',
    sg.includes('요약해 건너뛰') && sg.includes('아직 겪지 않은 장면'), '');
  ok('장면 전환 결정권은 유저', sg.includes('넘길지는 유저가 정한다'), '');
  // 자리 검증 — 지시문·에셋 사전보다 뒤, 즉 프롬프트 끝자락에 실려야 무게가 산다
  const t = fresh(); t.vars.in_gate = true; t.meta.turn = 6;
  const pb = engine.sendPhase(S, t, { rng: seededRng('pace', 1, 's') }).promptBlock;
  const iAnchor = pb.indexOf('한 응답에 한 장면');
  const iDir = pb.indexOf('파국으로 키우지 마라');
  ok('매 턴 실린다', iAnchor >= 0, '');
  ok('지시문·에셋 사전보다 뒤 (끝자락)', iAnchor > iDir && iAnchor > pb.length * 0.8,
    `${iAnchor}/${pb.length}`);
}

console.log('\n━━ 경제 — 시세표 지시문 + 상한은 백스톱 (서사 720 vs 장부 500 사고) ━━');
{
  const eco = S.directives.find((d) => d.id === 'economy');
  ok('시세표 지시문 상시 (게이트 정산·월수입·기본급)', !!eco && eco.when === 'true'
    && /게이트 클리어 정산.*월수입.*기본급/s.test(eco.text), '');
  const won = S.updater.allow.find((a) => a.id === 'won');
  ok('수입 상한 10억 — S급 정산도 한 방 (밸브가 아니라 뇌절 백스톱)', won.maxGain === 1000000000, String(won.maxGain));
  // 분할은 유령 잔금이 된다 (유저 판정) — 한 번에 지급 + 파티 N분(원작 결)만 남는다
  ok('분할 지급 규칙 없음 + 후불 금지 문구', !eco.text.includes('분할') && eco.text.includes('한 번에 지급'), '');
  ok('파티 N분 — 주인공 몫만 입금', /N분.*주인공 몫만 입금/.test(eco.text), '');
  ok('손실 백스톱 동일 (min 0이 받친다)', won.maxLoss === 1000000000, '');
}

console.log('\n━━ 급여 — 월급은 주기다 (가입 30일마다, 라이선스 비례) ━━');
{
  let t = fresh(); t.vars.guild = '백호 길드';
  const w0 = t.vars.won;
  ({ st: t } = turn(t, { skip_day: 14 }, 800));
  ({ st: t } = turn(t, { skip_day: 14 }, 801));    // 28일 — 아직
  ok('30일 전엔 침묵', t.vars.won === w0, String(t.vars.won - w0));
  ({ st: t } = turn(t, { skip_day: 3 }, 802));     // 31일 — 급여일
  ok('한 달 차면 급여 = 20만 + 라이선스×15만 (E: 35만)', t.vars.won - w0 === 350000, String(t.vars.won - w0));
  ({ st: t } = turn(t, { skip_day: 14 }, 803));
  ok('받은 뒤엔 다음 달을 다시 센다 (14일 차 침묵)', t.vars.won - w0 === 350000, String(t.vars.won - w0));
  // 무소속: 거울이 따라가서 주기가 아예 돌지 않는다
  let u = fresh();
  ({ st: u } = turn(u, { skip_day: 14 }, 810));
  ({ st: u } = turn(u, { skip_day: 14 }, 811));
  ({ st: u } = turn(u, { skip_day: 14 }, 812));
  ok('무소속은 급여 없음 (42일)', u.vars.won === w0, String(u.vars.won));
}

console.log('\n━━ 시간 도약 — 달력은 서사를 따라간다 (14일 상한 철폐) ━━');
{
  // 유저가 "한 달 후"라 하면 서사는 한 달인데 달력은 14일만 가던 어긋남 — 급여일·게이트
  // 잔여일이 전부 서사보다 뒤처졌다. 도약 폭은 유저가 정한다; 남는 상한은 사고 백스톱뿐.
  const T = SC.require('time');
  const ev = (t) => T.exposedValues(T.timeConfig(S), t.vars[T.EPOCH_KEY]);
  let t = fresh();
  ({ st: t } = turn(t, { skip_day: 30 }, 850));
  ok('"한 달 후" → 30일 그대로 (옛 상한 14에 깎이지 않음)',
    ev(t).elapsed === 30 && ev(t).date === '2026-04-01', JSON.stringify(ev(t)));
  ({ st: t } = turn(t, { skip_day: 365 }, 851));
  ok('"1년 후" → 365일', ev(t).elapsed === 395 && ev(t).date === '2027-04-01', JSON.stringify(ev(t)));
  ok('소비 후 skip_day 0 복귀', t.vars.skip_day === 0, String(t.vars.skip_day));
  // 백스톱 — 보조가 날짜를 일수 칸에 통째로 적는 사고(20260305)만 10년에서 멈춘다
  let u = fresh();
  ({ st: u } = turn(u, { skip_day: 20260305 }, 852));
  ok('날짜를 일수 칸에 적는 사고 → 3650일 백스톱', ev(u).elapsed === 3650, String(ev(u).elapsed));
  const sd = S.vars.find((v) => v.id === 'skip_day');
  const al = S.updater.allow.find((a) => a.id === 'skip_day');
  ok('var max·allow maxGain 둘 다 3650 (한쪽만 올리면 다른 쪽이 깎는다)',
    sd.max === 3650 && al.maxGain === 3650, `${sd.max}/${al.maxGain}`);
  ok('보조 어휘 — 한 달=30·1년=365 (desc) + 깎지 말라 (guide)',
    /month later = 30/.test(sd.desc) && /year later = 365/.test(sd.desc) && S.updater.guide.includes('깎지 말고'), '');
}

console.log('\n━━ 전투 안무 (v1.6.0) — ⚔ 매 라운드, 결착은 게이지가 정한다 ━━');
{
  // 유저 결정(2026-09-02): 결착을 시트에 박으면 한 응답에 전투가 끝난다 → 공격 유효 레벨(등급 gain)을
  // 게이지에 누적. 라운드 입구는 ⚔ 하나 — 안 누르면 자기 구도, 누르고 "대충 싸웠다"면 시스템 안무.
  const F = SC.require('fight');
  const K = F.FIGHT_KEYS;
  const press = (st, id, i, text = '') => {
    const armed = id ? engine.toggleAction(S, st, id).state : st;
    const send = engine.sendPhase(S, armed, { rng: seededRng('fight', i, 's'), userText: text });
    return { st: engine.outputPhase(S, send.state, {}, {}, { rng: seededRng('fight', i, 'o') }).state, pb: send.promptBlock };
  };
  const gf = S.checks.find((c) => c.id === 'gate_fight');
  ok('gate_fight에 fight — 반격은 evade, 게이지는 상대 등급식, 결착 lose = hp 0',
    gf.fight && gf.fight.reply === 'evade' && /opp_n/.test(gf.fight.gauge) && gf.fight.lose.when === 'hp <= 0', '');
  ok('등급 gain: 압도 50 · 우세 25 · 고전 10 · 치명적 실수 0',
    ['압도', '우세', '고전', '치명적 실수'].map((l) => gf.grades.find((g) => g.label === l).gain).join() === '50,25,10,0', '');
  ok('⚔ 라운드 액션(dice_on) + 🏃 이탈(fightEnd, fight_on 게이트, evade 판정)',
    S.actions.some((a) => a.id === 'fight_round' && a.check === 'gate_fight' && a.mode === 'oneshot')
    && S.actions.some((a) => a.id === 'fight_leave' && a.fightEnd === true && a.when === 'fight_on' && a.check === 'evade'), '');
  const clash = [...(S.rules.events || []), ...(S.rules.randomEvents?.table || [])].find((e) => e.id === 'gate_clash');
  ok('gate_clash 이벤트는 교전 중 잠김 (⚔가 굴린다)', !!clash && /not fight_on/.test(clash.when), clash?.when);
  ok('상태창 템플릿에 {fight} 칩', JSON.stringify(S.statusUI).includes('{fight}'), '');
  ok('예약 이름 충돌 없음 (foe_label은 예약 밖)', !S.vars.concat(S.derived).some((v) => F.FIGHT_RESERVED.includes(v.id)), '');

  let t = fresh(); t.vars.foe = 'C';
  let r = press(t, 'fight_round', 1, '대충 싸웠다');
  ok('★ ⚔ + 짧은 입력 → 안무 시트 (개시 비트, C급 게이지 105, 상대 라벨 "C급 상대")',
    r.pb.includes('[전투 안무 — 1라운드 · 상대: C급 상대') && r.pb.includes('① 개시 —') && r.st.vars[K.max] === 105, r.pb.slice(0, 300));
  ok('[판정] 줄·판정 규칙 줄은 시트에 흡수', !r.pb.includes('[판정]') && !r.pb.includes('※ 위 [판정]'), '');
  ok('상태 블록은 그대로 나간다 (시트가 상태를 밀어내지 않음)', r.pb.includes('[현재 상태 —'), '');
  r = press(r.st, null, 2, '검을 겨눈 채 상대를 노려본다');
  ok('★ ⚔ 없는 턴 → [교전 중] 상시 줄, 라운드 불변', r.pb.includes('[교전 중 — 상대: C급 상대') && r.st.vars[K.round] === 1, '');
  r = press(r.st, 'fight_round', 3, '검기 베기로 목을 노린다 — 상대의 왼쪽 어깨가 열린 순간을 놓치지 않고 파고든다');
  ok('⚔ + 긴 입력 → 개시 비트 없이 "유저가 쓴 수를 그대로", 2라운드',
    !r.pb.includes('① 개시 —') && r.pb.includes('유저가 쓴 수를 그대로') && r.st.vars[K.round] === 2, '');
  // 게이트 안 — 상대 라벨은 게이트, 목표치는 게이트 등급(opp_n)에서
  let g = fresh(); g.vars.in_gate = true;
  const gr = press(g, 'fight_round', 5, '싸운다');
  ok('게이트 안(foe 없음) → 상대 라벨 "게이트 안의 적"', gr.st.vars[K.foe] === '게이트 안의 적', gr.st.vars[K.foe]);
  // 결착까지 — E급은 2라운드 이후에만 (게이지 55 > 압도 50)
  let u = fresh(); u.vars.foe = 'E'; let ended = null, rounds = 0;
  for (let i = 10; i < 30 && !ended; i++) { const q = press(u, 'fight_round', i, '싸운다'); u = q.st; rounds++; if (/결착 —/.test(q.pb)) ended = q.pb; }
  ok('★ E급 상대 — 결착은 2라운드 이후 (한 응답 결착 없음), 교전 닫힘', !!ended && rounds >= 2 && !F.fightActive(u.vars), `${rounds}라운드`);
  ok('결착 승리면 foe 리셋 (win effects)', !ended || ended.includes('주인공 붕괴') || u.vars.foe === '없음', u.vars.foe);
  // 이탈
  let w = fresh(); w.vars.foe = 'C';
  let q = press(w, 'fight_round', 40, '싸운다'); q = press(q.st, 'fight_leave', 41, '도망친다');
  ok('🏃 이탈 → [판정] 회피 + [이탈] inject + [교전 종료], 교전 닫힘',
    q.pb.includes('[판정] 회피 판정') && q.pb.includes('[이탈]') && q.pb.includes('[교전 종료] 유저가 교전에서 이탈') && !F.fightActive(q.st.vars), '');
  // 검증 통과 (fight_on when·{fight} 자리표시자 포함)
  const fv = validateSchema(S);
  ok('전투 안무 포함 스키마 검증 통과', fv.ok, JSON.stringify(fv.errors));
}

console.log('\n━━ 전리품 — 드랍 순간을 여는 이벤트 ━━');
{
  const row = S.rules.randomEvents.table.find((r) => r.id === 'loot_drop');
  ok('게이트 안 전용', row && row.when === 'in_gate', row?.when);
  // 코인은 스토어가 켜진 세계에서만 굴러들어온다 (정책 조건이 effects 식 안에)
  const tOff = fresh(); tOff.vars.store_on = false;   // 기본 켬(init true)이라 명시로 끈다
  const L0 = engine.makeLookup(S, tOff.vars);
  ok('스토어 꺼짐 — 코인 불변', evaluate(row.effects[0].expr, L0, seededRng('lt', 1, 'e')) === 0, '');
  const tOn = fresh(); tOn.vars.store_on = true;
  const got = evaluate(row.effects[0].expr, engine.makeLookup(S, tOn.vars), seededRng('lt', 2, 'e'));
  ok('스토어 켜짐 — 2~8C 범위', got >= 2 && got <= 8, String(got));
  ok('압도 등급에 전리품 인젝트', S.checks.find((c) => c.id === 'gate_fight')
    .grades.find((g) => g.label === '압도').inject.includes('전리품'), '');
}

console.log('\n━━ P5 — 에셋 팩 (원본 이미지 지침 이관) ━━');
{
  const pk = (id) => S.assets.packs.find((p) => p.id === id);
  ok('팩 5종 (체위·확장수위·복장·감정·엑스트라)', S.assets.packs.length === 5,
    S.assets.packs.map((p) => p.id).join(','));
  // 복장 팩 (2026-08-30 추가 복장 모듈) — 원본 지침 3절을 팩 하나로
  ok('복장 팩 — 인물 30 · 복장 13 · 감정 57(생략 가능)',
    pk('outfits').slots[0].values.length === 30
    && pk('outfits').slots[1].values.length === 13
    && pk('outfits').slots[2].values.length === 57 && pk('outfits').slots[2].optional === true, '');
  ok('복장 팩은 감정 팩보다 앞 (필수 2칸 → 1칸 공존 순서)',
    S.assets.packs.findIndex((p) => p.id === 'outfits')
      < S.assets.packs.findIndex((p) => p.id === 'char_emotions'), '');
  ok('복장 규칙 핵심이 지침에 있음 (세부는 로어북 위임)', /로어북.*School uniform.*Underworld Samurai/s
    .test(pk('outfits').usage), '');
  ok('복장 usage 200자 린트 통과', pk('outfits').usage.length <= 200, String(pk('outfits').usage.length));
  ok('감정 팩 — 인물 48 · 감정 51 (감정은 생략 가능 칸)',
    pk('char_emotions').slots[0].values.length === 48
    && pk('char_emotions').slots[1].values.length === 51
    && pk('char_emotions').slots[1].optional === true, '');
  ok('체위 팩 — 여성 28 · 체위 56', pk('sexual_scene_positions').slots[0].values.length === 28
    && pk('sexual_scene_positions').slots[1].values.length === 56, '');
  ok('확장 팩 — 행위 59 · alter_on 게이트', pk('sexual_scene_alter_nsfw').slots[1].values.length === 59
    && pk('sexual_scene_alter_nsfw').when === 'alter_on', '');
  ok('모듈 매니페스트 통로 유지 (애드온 + 실존 대조 합류)', S.assets.moduleManifests === true, '');
  // by:'main' — 주입문이 메인 프롬프트에 실리고, 정책이 팩을 실제로 잠근다
  const t = fresh();
  const p1 = engine.sendPhase(S, t, { rng: seededRng('as', 1, 's') }).promptBlock;
  ok('메인 주입문 존재 ([Image tags])', p1.includes('[Image tags]'), '');
  ok('감정·체위·확장 어휘 실림', p1.includes('full-face blush') && p1.includes('missionary sex')
    && p1.includes('paizuri'), '');
  ok('이미지 규칙 지시문 (인물마다 1장·유저 금지·엑스트라 Male/Female)',
    p1.includes('one tag per character') && p1.includes('<img="Male">'), '');
  t.vars.alter_on = false;
  const p2 = engine.sendPhase(S, t, { rng: seededRng('as', 2, 's') }).promptBlock;
  ok('/수위 끄면 확장 어휘만 빠진다', !p2.includes('paizuri') && p2.includes('missionary sex'), '');
}

console.log('\n━━ P2 — NPC 랭크 게이팅 ━━');
{
  // E급 신인: E·D 대역 상세 + S 셀럽 한 줄, A급 상세는 없어야
  let t = fresh();
  const pE = turn(t, {}, 50).prompt;
  ok('E유저 — E·D 대역 상세 노출', pE.includes('김민수') && pE.includes('리베아'));
  ok('E유저 — A급 상세 미노출', !pE.includes('Eclipse Blade'), 'A급 강민혁 상세가 실림');
  ok('E유저 — S 셀럽은 원거리 한 줄만', pE.includes('distant figures') && !pE.includes('벽운갑주'));
  ok('E유저 — 협회 직원·적대 인물 상시', pE.includes('고은비') && pE.includes('강태식'));

  // B급: C·B·A 대역, E 신인 상세는 빠진다
  t = fresh(); t.vars.license = 'B';
  const pB = turn(t, {}, 51).prompt;
  ok('B유저 — C·B·A 대역 노출', pB.includes('강유라') && pB.includes('민채린') && pB.includes('Eclipse Blade'));
  ok('B유저 — E 신인 상세 미노출', !pB.includes('김민수'));
  ok('B유저 — S는 아직 원거리 한 줄', pB.includes('distant figures') && !pB.includes('벽운갑주'));

  // S급: A·S 상세, 셀럽 한 줄은 사라진다
  t = fresh(); t.vars.license = 'S';
  const pS = turn(t, {}, 52).prompt;
  ok('S유저 — A·S 상세 노출', pS.includes('벽운갑주') && pS.includes('Eclipse Blade'));
  ok('S유저 — 원거리 한 줄 소멸', !pS.includes('distant figures'));
  ok('S유저 — 하위 대역 미노출', !pS.includes('김민수') && !pS.includes('강유라'));

  // 적대 서사 끔
  t = fresh(); t.vars.faction_on = false;
  const pF = turn(t, {}, 53).prompt;
  ok('faction_on=false — 적대 인물 목록 미노출', !pF.includes('강태식'));

  // 변동 기록이 기준선을 이긴다는 규칙이 상시 실려 있나
  ok('변동 우선 규칙 상시', pE.includes('overrides their profile baseline'));
  let t2 = fresh();
  ({ st: t2 } = turn(t2, { npc_notes: { add: ['김민수 — D급 승급'] } }, 54));
  ok('변동 기록 등록', t2.vars.npc_notes.length === 1 && t2.vars.npc_notes[0].includes('김민수'));
}

console.log('\n━━ P3 — 게이트 브레이크 초읽기 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { break_name: '노원 C급 게이트', break_in: 3 }, 60));
  ok('경보 등록 (같은 날 — 초읽기 그대로)', t.vars.break_name !== '' && t.vars.break_in === 3,
    `${t.vars.break_name} ${t.vars.break_in}`);
  ({ st: t } = turn(t, { skip_day: 1 }, 61));
  ok('하루 뒤 D-2', t.vars.break_in === 2, String(t.vars.break_in));
  const p = turn(t, {}, 62);
  ok('D-2 — 임박 지시문 깔림', p.prompt.includes('브레이크 임박'));
  ({ st: t } = turn(t, { skip_day: 3 }, 63));
  ok('기한 경과 → 브레이크 발화 (경보 해제 + hazard +10)',
    t.vars.break_name === '' && t.vars.hazard === 40, `name="${t.vars.break_name}" hz${t.vars.hazard}`);
  const p2 = turn(t, {}, 64);
  ok('브레이크 통지가 다음 전송에 실림', p2.prompt.includes('게이트 브레이크'));
  ok('경보 없으면 초읽기 0 고정', p2.st.vars.break_in === 0);
}

console.log('\n━━ P3 — 게이트 보드 기한 ━━');
{
  let t = fresh();
  ({ st: t } = turn(t, { gates: { add: ['동북권 D 고블린 소굴 @+4'] } }, 70));
  ok('보드 2건 (시작 1 + 등록 1)', t.vars.gates.length === 2, JSON.stringify(t.vars.gates));
  ({ st: t } = turn(t, { skip_day: 5 }, 71));
  ({ st: t } = turn(t, {}, 72));
  ok('닷새 뒤 기한 건 소멸 (오프스크린 공략) · 잔여 확인',
    t.vars.gates.length === 1 && t.vars.gates[0].includes('붕괴 지하철'), JSON.stringify(t.vars.gates));
}

console.log('\n━━ P3 — 출현 굴림 공식 (경계) ━━');
{
  // grade 공식: clamp(floor((roll + hazard) / 35) + 1, 1, 5)
  const g = (roll, hz) => Math.max(1, Math.min(5, Math.floor((roll + hz) / 35) + 1));
  ok('hazard 30 — E~B 범위 (S 불가)', g(1, 30) === 1 && g(100, 30) === 4);
  ok('hazard 0 — E~C 범위', g(1, 0) === 1 && g(100, 0) === 3);
  ok('hazard 100 — 최소 C, 최대 A (S는 전용 이벤트)', g(1, 100) === 3 && g(100, 100) === 5);
  const t = fresh(); t.vars.zone_i = 2; t.vars.grade_i = 6;
  const L = engine.makeLookup(S, t.vars);
  ok('파생 매핑 — zone 2=동북권, grade 6=S', L('zone_txt') === '동북권' && L('grade_txt') === 'S');
  const L0 = engine.makeLookup(S, fresh().vars);
  ok('출현 전에는 — 표시', L0('zone_txt') === '—' && L0('grade_txt') === '—');
}

console.log('\n━━ P3 — 이벤트 표 구성 (프리셋별 후보) ━━');
{
  for (const p of S.setup.presets) {
    const t = engine.applyPreset(S, engine.initState(S), p.id).state;
    t.meta.setupDone = true;
    const L = engine.makeLookup(S, t.vars);
    const cand = S.rules.randomEvents.table.filter((ev) => !ev.when || truthy(evaluate(ev.when, L, null)));
    const chance = evaluate(S.rules.randomEvents.chancePerTurn, L, null);
    console.log(`  ${p.id.padEnd(8)} 후보 ${String(cand.length).padStart(2)}/${S.rules.randomEvents.table.length}종 · 턴당 ${Math.round(chance * 100)}%`);
    ok(`${p.id} — 확률 0~1 범위`, chance > 0 && chance <= 1, String(chance));
  }
  // 일상 모드에서도 0이 아니어야 (끄지 않고 낮춘다)
  const t = fresh(); t.vars.action_on = false;
  const chance = evaluate(S.rules.randomEvents.chancePerTurn, engine.makeLookup(S, t.vars), null);
  ok('일상 모드 — 낮지만 0 아님', chance > 0 && chance < 0.1, String(chance));
}

console.log('\n━━ P3 — 60턴 방치 실발화 (시드 고정 — 결정적) ━━');
{
  let t = fresh();
  for (let i = 0; i < 60; i++) {
    const send = engine.sendPhase(S, t, { rng: seededRng('run', i, 's') });
    t = engine.outputPhase(S, send.state, { skip_day: 1 }, {}, { rng: seededRng('run', i, 'o') }).state;
  }
  // 발화 흔적은 eventLastFired로 센다 (엔진이 이벤트 발화 턴을 meta에 남긴다)
  const randomIds = new Set(S.rules.randomEvents.table.map((e) => e.id));
  const cds = Object.keys(t.meta.eventLastFired || {}).filter((id) => randomIds.has(id));
  ok('랜덤 이벤트가 실제로 발화했다', cds.length >= 3, JSON.stringify(Object.keys(t.meta.eventLastFired || {})));
  ok('출현 굴림이 유효 범위에 들어왔다',
    t.vars.zone_i >= 0 && t.vars.zone_i <= 5 && t.vars.grade_i >= 0 && t.vars.grade_i <= 6,
    `zone${t.vars.zone_i} grade${t.vars.grade_i}`);
}

console.log('\n━━ P4 — 헌터넷 (커뮤니티 보드) ━━');
{
  let t = fresh();
  ok('보드 부착 (빈 게시판)', t.board && Array.isArray(t.board.posts) && t.board.posts.length === 0);
  const aux = engine.buildAuxPrompt(S, t, '거리를 걷는다', null);
  ok('보조 프롬프트에 헌터넷 갱신 요청', aux.includes('헌터넷') && aux.includes('"board"'));
  // 성인 칸 (원본 2대 인기 코너 승계) — 탭 어휘와 음지판 지침이 보조 계약에 실린다
  ok('칸 4종 (자유·정보·모집·성인)', S.board.categories.join(',') === '자유,정보,모집,성인',
    S.board.categories.join(','));
  ok('성인 칸 어휘가 보조 계약에 전파', aux.includes('자유 | 정보 | 모집 | 성인'), '');
  ok('성인 칸 지침 — 디시톤·수위 개방·전지적 금지 유지', S.board.guide.includes('디시식')
    && S.board.guide.includes('수위 제한 없이') && S.board.guide.includes('전지적 정보 금지는 여기도 같다'), '');
  t.vars.in_gate = true;
  ok('게이트 안 — 갱신 요청 차단 (통신 두절)', !engine.buildAuxPrompt(S, t, '던전 안', null).includes('"board"'));
  t.vars.in_gate = false;
  ({ st: t } = turn(t, {}, 80));
  // 델타는 outputPhase opts로 들어간다 — 러너 turn()은 changes만 받으므로 직접 굴린다
  const send = engine.sendPhase(S, t, { rng: seededRng('h', 81, 's') });
  t = engine.outputPhase(S, send.state, {}, {}, {
    rng: seededRng('h', 81, 'o'),
    board: { new: [{ title: '동북권 D급 목격', author: '노원구주민', body: '협회 알림 옴' }] },
  }).state;
  ok('보조 델타로 글 등록', t.board.posts.length === 1 && t.board.posts[0].author === '노원구주민',
    JSON.stringify(t.board.posts));
  const p = turn(t, {}, 82);
  ok('메인에 화제 한 줄 (원문 없이)', p.prompt.includes('[헌터넷]') && p.prompt.includes('동북권 D급 목격')
    && !p.prompt.includes('협회 알림 옴'), '');
  // v1.1.0 다양성 리워크 — "사용자 서사가 헌터넷에 계속 박제돼 다양성이 죽는다" (유저 지목)
  const aux2 = engine.buildAuxPrompt(S, t, '거리를 걷는다', null);
  ok('자율형 [4,5] — 매턴 4~5글 지시', S.board.postsPerTurn.join(',') === '4,5'
    && aux2.includes('새 글 4~5개') && aux2.includes('게시판은 세계와 함께 굴러간다'), '');
  ok('다양성 지시 — 주인공 무관 위주 + 관련 글 최대 1개',
    aux2.includes('무관한') && aux2.includes('최대 1개'), '');
  ok('반응형 문구("반응할 일이 없으면") 소멸', !aux2.includes('반응할 일이 없으면'), '');
  // 현재 화제 기사 (v1.1.0) — 5턴 주기 세계 뉴스 슬롯
  const boardMod = SC.require('board');
  ok('hot 설정 — 5턴 주기 + 기사체 지침', S.board.hot.every === 5
    && S.board.hot.guide.includes('기사체') && S.board.hot.guide.includes('게이트 브레이크'), '');
  ok('빈 슬롯 — 첫 턴부터 기사 요청', aux2.includes('"hot"') && aux2.includes('[현재 화제 — 5턴 주기 기사]'), '');
  t = engine.outputPhase(S, engine.sendPhase(S, t, { rng: seededRng('h', 83, 's') }).state, {}, {}, {
    rng: seededRng('h', 83, 'o'),
    board: { hot: { title: 'S랭크 진서연, 3년 만의 이적설', body: '헌터 전문지 단독 보도…' } },
  }).state;
  ok('기사 적용 — 슬롯 + 갱신 턴 기록', t.board.hot.title.includes('진서연')
    && typeof t.board.hot.turn === 'number', JSON.stringify(t.board.hot));
  const aux3 = engine.buildAuxPrompt(S, t, '거리', null);
  ok('주기 미도래 — 기사 요청 안 실림 (글 요청은 그대로)', !aux3.includes('"hot"') && aux3.includes('새 글 4~5개'), '');
  const cfgB = boardMod.boardConfig(S);
  ok('5턴 경과 — 다시 기사 차례 + 직전 기사와 다른 주제 지시', (() => {
    const t5 = JSON.parse(JSON.stringify(t)); t5.meta.turn = t.board.hot.turn + 5;
    return boardMod.hotDue(cfgB, t5)
      && engine.buildAuxPrompt(S, t5, '거리', null).includes('직전 기사("S랭크 진서연');
  })(), '');
  ok('메인에 기사 헤드라인 한 줄 (본문 없이)', (() => {
    const line = boardMod.mainLine(S, t);
    return line.includes('현재 화제 기사') && line.includes('진서연') && !line.includes('단독 보도');
  })(), '');
}

console.log('\n━━ P4.7 — 단말기 (메신저) ━━');
{
  const msgrMod = SC.require('messenger');
  const cfg = msgrMod.msgrConfig(S);
  let t = fresh();
  ok('메신저 부착 (빈 방 목록)', t.msgr && Array.isArray(t.msgr.rooms) && t.msgr.rooms.length === 0);
  ok('연락처 = 동료 명부 연동 (allies)', cfg.contactsVar === 'allies' && cfg.notesVar === 'npc_notes', '');
  // 방은 유저만 — 연락처(allies)에 있는 상대만
  ok('연락처 밖 인물 거부', !msgrMod.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] }).ok, '');
  t.vars.allies = ['김민수', '서지한', '이하늘'];
  const r1 = msgrMod.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] });
  ok('동료와 1:1 방 생성', r1.ok, JSON.stringify(r1));
  const rg = msgrMod.createRoom(cfg, t, { kind: 'group', members: ['서지한', '이하늘'], name: '레이드 준비방' });
  ok('단체방 생성 (본인 포함 파티 5인 캡)', rg.ok && msgrMod.CAPS.GROUP_MEMBERS === 4, '');
  // 선톡 — 시드 해시라 같은 턴 = 같은 결과 (리롤 안정). 턴 3은 김민수 방이 뜨는 턴 (실측)
  t.meta.turn = 3;
  const first = msgrMod.firstContactRoom(cfg, t);
  ok('선톡 발동 턴 — 김민수 방 (시드 해시, 리롤 재현)', first?.id === r1.id
    && msgrMod.firstContactRoom(cfg, t)?.id === first.id, JSON.stringify(first));
  ok('선톡 요청이 보조에 실림 (+형식)', (() => {
    const aux = engine.buildAuxPrompt(S, t, '거리', null);
    return aux.includes('[단말기 — 주인공의 단말기]') && aux.includes('먼저 메시지를 보낼') && aux.includes('"msgr"');
  })(), '');
  // 게이트 안 통신 두절 — 같은 턴이라도 요청이 빠진다
  t.vars.in_gate = true;
  ok('게이트 안 — 선톡 차단 (통신 두절)', !engine.buildAuxPrompt(S, t, '던전 안', null).includes('[단말기'), '');
  t.vars.in_gate = false;
  // 발신·답장 — from은 멤버만, 활성 방만 서사로
  msgrMod.userMsg(S, t, r1.id, '내일 게이트 갈래?');
  msgrMod.applyDelta(S, t, [{ id: r1.id, msgs: [
    { from: '김민수', body: 'ㅇㅋ 몇 시?' },
    { from: '위조범', body: '난 멤버 아님' },
  ] }]);
  const room1 = t.msgr.rooms.find((r) => r.id === r1.id);
  ok('답장 부착 + 비멤버 위조 차단', room1.msgs.length === 2 && room1.msgs[1].from === '김민수', JSON.stringify(room1.msgs));
  ok('비활성 방 — 안읽음 배지', room1.unread === 1, String(room1.unread));
  ok('비활성 — 서사에 안 실림', !engine.sendPhase(S, t, { rng: seededRng('m', 1, 's') }).promptBlock.includes('ㅇㅋ 몇 시?'), '');
  msgrMod.setActive(t, r1.id);
  const pb = engine.sendPhase(S, t, { rng: seededRng('m', 2, 's') }).promptBlock;
  ok('활성 방 — 대화 원문이 서사로 전달', pb.includes('[단말기]') && pb.includes('ㅇㅋ 몇 시?')
    && pb.includes('내일 게이트 갈래?'), '');
  // 답장 프롬프트 — 인격 컨텍스트 (npc_notes 델타 발췌)
  t.vars.npc_notes = ['김민수 — D급 승급', '박무관 — 은퇴'];
  const ip = msgrMod.interactionPrompt(S, t, r1.id, { persona: '◆ 김민수\n무뚝뚝한 창잡이', narrative: '어제 같이 사냥했다' });
  ok('답장 프롬프트 — 로어북 persona + notes 발췌 + 말투 지침', ip.includes('무뚝뚝한 창잡이')
    && ip.includes('김민수 — D급 승급') && !ip.includes('박무관') && ip.includes('초성체'), '');
}

console.log('\n━━ P4.5 — 알터 스토어 (상점) ━━');
{
  const shopMod = SC.require('shop');
  let t = fresh();
  ok('기본(init true) — 새 채팅부터 상점 활성', t.vars.store_on === true, '');
  t.vars.store_on = false;
  ok('꺼면(store_on=false) — 첫 입고 요청 없음', !engine.buildAuxPrompt(S, t, '서사', null).includes('첫 입고'));
  t.vars.store_on = true;
  ok('스토어 켜면 — 첫 입고 요청 + 지시문',
    engine.buildAuxPrompt(S, t, '서사', null).includes('첫 입고')
    && turn(t, {}, 90).prompt.includes('Alter Store'));
  // 2축 등급 (랭크×희귀도) — 어휘·밴드·짝 표기 강제
  ok('등급 24종 = 랭크 6 × 희귀도 4', S.shop.grades.length === 24
    && S.shop.grades.includes('E급 유니크') && S.shop.grades.includes('S급 레전드'), '');
  ok('E급 유니크가 C급 일반 가격대 (저랭크 유니크 ≠ 밸붕)',
    S.shop.bands['E급 유니크'][1] <= S.shop.bands['C급 일반'][1]
    && S.shop.bands['E급 유니크'][1] >= S.shop.bands['C급 일반'][0], JSON.stringify(S.shop.bands['E급 유니크']));
  // v1.0.9 — perCat: "갱신해도 카테고리별로 몇 개 안 나온다" (유저 지목) → 카테고리마다 4~6개
  ok('perCat [4,6] + maxStock 36 (6카테고리 × 6)',
    S.shop.perCat[0] === 4 && S.shop.perCat[1] === 6 && S.shop.maxStock === 36, '');
  ok('입고 지시 — "카테고리마다 4~6개씩" + 빈 카테고리 금지',
    (() => { const p = engine.buildAuxPrompt(S, t, '서사', null);
      return p.includes('카테고리마다 4~6개씩') && p.includes('빈 카테고리 금지'); })());
  // guide 중복 키 사고 회귀 — 두 번 선언되면 뒤 키가 앞을 덮어 짝 표기 지시가 통째로 죽는다
  ok('guide 병합 생존 — 짝 표기·레전드 1개·코인 기준이 한 키에',
    S.shop.guide.includes('짝 표기') && S.shop.guide.includes('한 입고에 최대 1개')
    && S.shop.guide.includes('E-rank monster kill pays 1~5 Coin'), '');
  ok('레전드 모순 문구 제거 ("never sells Legendary" ↔ 입고당 1개 충돌)',
    !S.shop.guide.includes('never sells Legendary'), '');
  // 뇌절 봉쇄 — 어휘 밖 등급 거부(맨 희귀도 포함)·밴드 클램프
  const r = shopMod.applyStock(S, t, { stock: [
    { cat: '스킬북', name: 'S급 스킬북', grade: '레전더리', price: 99999 },
    { cat: '소모품', name: '맨등급 포션', grade: '일반', price: 10 },
    { cat: '소모품', name: '하급 회복 포션', grade: 'E급 일반', price: 999 },
  ], buying: [{ name: '고블린 마정석', price: 4 }] });
  ok('레전더리·맨 희귀도 거부 + E급 일반가 60 클램프', r.stocked === 1 && t.shop.stock[0].price === 60
    && r.rejected.length === 2, JSON.stringify({ r, stock: t.shop.stock }));
  // 구매 → 코인 차감 + 통지가 다음 전송에 실리고 소거
  t.vars.coin = 100;
  const buy = shopMod.buy(S, t, t.shop.stock[0].id);
  ok('구매 정산 (코인 40 잔액 + 소지품 합류)', buy.ok && t.vars.coin === 40
    && t.vars.items.some((x) => x.includes('하급 회복 포션')), JSON.stringify(t.vars.items));
  const send = engine.sendPhase(S, t, { rng: seededRng('h', 91, 's') });
  ok('거래 통지 — 다음 전송 1회 후 소거', send.promptBlock.includes('알터 스토어')
    && send.state.meta.pendingNotifies.length === 0);
  // 시세판 판매 — 안 가진 물건은 거부, 가진 물건은 즉시 매입
  const sell = shopMod.sell(S, send.state, '고블린 마정석 5');
  ok('안 가진 물건 판매 거부', !sell.ok && !sell.needAppraisal);
  send.state.vars.items.push('고블린 마정석 5');
  const sell2 = shopMod.sell(S, send.state, '고블린 마정석 5');
  ok('시세판 매입 — 끝수 차감 + 코인 적립', sell2.ok && sell2.payout === 4
    && send.state.vars.items.includes('고블린 마정석 4'), JSON.stringify(send.state.vars.items));
  // 환전 (v0.97) — 캐논: 블랙 마켓 시세 ₩1,000/코인, 암거래 스프레드 0.2
  const t2 = send.state;
  const wonBefore = t2.vars.won, coinBefore = t2.vars.coin;
  const ex = shopMod.exchange(S, t2, 10, 'buy');
  ok('암거래 환전 — 코인 10 매입 = 12,000원', ex.ok && t2.vars.coin === coinBefore + 10
    && t2.vars.won === wonBefore - 12000, JSON.stringify({ won: t2.vars.won, coin: t2.vars.coin }));
  ok('환전 통지 접두 [암거래 환전]', t2.meta.pendingNotifies.some((n) => n.includes('[암거래 환전]')),
    JSON.stringify(t2.meta.pendingNotifies));
  const ex2 = shopMod.exchange(S, t2, 10, 'sell');
  ok('코인 10 매도 = 8,000원 회수', ex2.ok && t2.vars.coin === coinBefore
    && t2.vars.won === wonBefore - 12000 + 8000, JSON.stringify({ won: t2.vars.won }));
  ok('보유 초과 매도 거부', !shopMod.exchange(S, t2, 99999, 'sell').ok);
}

console.log('\n━━ P6 — 파티 편성 + 게이트 지도 + 모집판 ━━');
{
  const partyMod = SC.require('party');
  ok('파티 후보 32명 — 한국어 이름 추출 무결', PARTY_NAMES.length === 32
    && PARTY_NAMES.every((n) => n && /^[가-힣 ]+$/.test(n)), JSON.stringify(PARTY_NAMES));
  // 영입 전 편성 잠금 (roster 규약: "영입하면 열린다")
  let t = fresh();
  let pick = partyMod.applyPartyPick(S, t, 'party1', '김민수');
  ok('명부에 없는 헌터 편성 거부', !pick.ok && pick.reason.includes('보유'), JSON.stringify(pick));
  ({ st: t } = turn(t, { allies: { add: ['김민수'] } }, 100));
  ok('영입 기록 (동료 명부)', t.vars.allies.includes('김민수'), JSON.stringify(t.vars.allies));
  pick = partyMod.applyPartyPick(S, t, 'party1', '김민수');
  ok('영입 후 편성 성공', pick.ok && pick.changes.party1 === '김민수', JSON.stringify(pick));
  t.vars.party1 = '김민수';
  const p = turn(t, {}, 101);
  ok('파티 동행 지시문 — 이름 치환', p.prompt.includes('Party member accompanying')
    && p.prompt.includes('김민수'), '');
  // 지도 — {gates:tags:권역} 필터가 보드를 권역 칸에 나눠 꽂는다
  t.vars.gates = ['동북권 D 고블린 소굴 @+4', '도심권 C 붕괴 지하철 게이트 @+2'];
  const mapTpl = S.party.tabs.find((x) => x.id === 'map').template;
  const html = SC.require('render').renderPanelTemplate(S, t, mapTpl);
  const zone = (cls) => html.split(`hmz-${cls}`)[1].split('hmap-zone')[0];
  ok('지도 — 동북권 칸에만 고블린 소굴', zone('ne').includes('고블린 소굴') && !zone('ct').includes('고블린 소굴'), '');
  ok('지도 — 빈 권역은 "없음"', zone('sw').includes('없음'), '');
  const leftoverMap = (html.match(/\{[a-z_]+(?::[^}]*)?\}/g) || []);
  ok('지도 — 미치환 자리표시자 없음', leftoverMap.length === 0, leftoverMap.join(' '));
  // 헌터넷 모집판 (보드 카테고리 v0.98)
  const aux = engine.buildAuxPrompt(S, t, '서사', null);
  ok('보조 지시에 칸 어휘', aux.includes('자유 | 정보 | 모집'), '');
  t = engine.outputPhase(S, engine.sendPhase(S, t, { rng: seededRng('h', 102, 's') }).state, {}, {}, {
    rng: seededRng('h', 102, 'o'),
    board: { new: [
      { title: '동북권 D급 탱커 구함', author: '노원구주민', body: '내일 아침 공략', cat: '모집' },
      { title: '아무말', author: 'ㅇㅇ', body: '잡담', cat: '레전더리칸' },
    ] },
  }).state;
  const rec = t.board.posts.find((x) => x.title.includes('탱커 구함'));
  ok('모집 칸 글 등록', rec && rec.cat === '모집', JSON.stringify(t.board.posts.map((x) => x.cat)));
  ok('어휘 밖 칸 → 첫 칸(자유) 보정', t.board.posts.find((x) => x.title === '아무말').cat === '자유', '');
}

console.log('\n━━ P8 — 의뢰 보드 (수락 전 대기열) ━━');
{
  let t = fresh();
  ok('시드 의뢰 1건 ([협회] 접두)', t.vars.offers.length === 1 && t.vars.offers[0].startsWith('[협회]'),
    JSON.stringify(t.vars.offers));
  t.vars.offers = ['[협회] 하수도 정화 (80만원) @+5', '[길드] 마정석 납품 (300만원) @+7', '[개인] 실종자 수색 (150만원) @+3'];
  const tpl = S.party.tabs.find((x) => x.id === 'questboard').template;
  const html = SC.require('render').renderPanelTemplate(S, t, tpl);
  const col = (name) => html.split(`>${name}<`)[1].split('hmap-zone')[0];
  ok('발주처별 칸 분류 ([협회]/[길드]/[개인] 접두 필터)',
    col('협회').includes('하수도') && !col('협회').includes('납품')
    && col('길드').includes('납품') && col('개인·사설').includes('실종자'), '');
  const leftover = (html.match(/\{[a-z_]+(?::[^}]*)?\}/g) || []);
  ok('미치환 자리표시자 없음', leftover.length === 0, leftover.join(' '));
  // 기한 만료 — 보조 add 경로로 등록해야 상대 기한(@+N)이 그 시점에 굳는다 (quests와 같은 규약)
  let u = fresh(); u.vars.offers = [];
  ({ st: u } = turn(u, { offers: { add: ['[개인] 실종자 수색 (150만원) @+3', '[길드] 마정석 납품 (300만원) @+7'] } }, 119));
  ({ st: u } = turn(u, { skip_day: 4 }, 120));
  ({ st: u } = turn(u, {}, 121));
  ok('나흘 뒤 @+3 의뢰만 소멸', !u.vars.offers.some((o) => o.includes('실종자'))
    && u.vars.offers.some((o) => o.includes('납품')), JSON.stringify(u.vars.offers));
  ok('의뢰 게시 이벤트 존재', !!S.rules.randomEvents.table.find((r) => r.id === 'offer_post'), '');
  ok('수락 규칙 지시문 존재', S.directives.some((d) => d.id === 'offer_rule'), '');
}

console.log('\n━━ P7 — 막간 (주인공 부재) ━━');
{
  // 유저 제안: 페르소나가 있으면 모델이 주인공을 억지로 등장시켜 조연·흑막 쪽 장면을 못 본다
  const act = S.actions.find((a) => a.id === 'offstage');
  ok('막간 액션 존재 (hold + offstage)', !!act && act.mode === 'hold' && act.offstage === true, JSON.stringify(act));
  ok('상태 변수는 안 건드림 (주인공이 없는 장면이라 움직일 수치가 없다)',
    !act.effects && !act.check, '');
  let t = fresh();
  const p0 = turn(t, {}, 130).prompt;
  ok('평턴 — 흔적 없음 (토큰 0)', !p0.includes('주인공 부재'), '');
  t = engine.toggleAction(S, t, 'offstage').state;
  const send = engine.sendPhase(S, t, { rng: seededRng('h', 131, 's') });
  ok('막간 켜면 — 지시문 + 얼헌 카메라 지시', send.offstage === true
    && send.promptBlock.includes('[막간 — 주인공 부재]')
    && send.promptBlock.includes('헌터넷·협회·길드'), '');
  ok('지시문이 프롬프트 맨 끝', send.promptBlock.trimEnd().endsWith('장면으로 만들어라.'), '');
  const off = engine.sendPhase(S, engine.toggleAction(S, send.state, 'offstage').state,
    { rng: seededRng('h', 132, 's') });
  ok('끄면 원래대로', off.offstage === false && !off.promptBlock.includes('주인공 부재'), '');
}

console.log('\n━━ 길드·상층부 이벤트 (2026-09-01 확충 — 소속·명성·랭크 게이트) ━━');
{
  const T = S.rules.randomEvents.table;
  const row = (id) => T.find((r) => r.id === id);
  ok('5종 존재', ['guild_task', 'guild_friction', 'poach_war', 'celebrity', 'assoc_task'].every((id) => row(id)), '');
  // 실계산 — 신입(E급 · 무소속 · fame 0)에게는 전부 잠김
  const nb = engine.makeLookup(S, fresh().vars);
  ok('신입 — 전부 잠김', ['guild_task', 'guild_friction', 'poach_war', 'celebrity', 'assoc_task']
    .every((id) => !truthy(evaluate(row(id).when, nb, null))), '');
  // 길드 가입 → 길드 일감 열림, 명성 붙으면 길드 경쟁도
  const gm = engine.makeLookup(S, { ...fresh().vars, guild: '청염 길드' });
  ok('길드 가입 — 일감 열림 (경쟁은 아직)', truthy(evaluate(row('guild_task').when, gm, null))
    && !truthy(evaluate(row('guild_friction').when, gm, null)), '');
  const gf = engine.makeLookup(S, { ...fresh().vars, guild: '청염 길드', fame: 12 });
  ok('길드 + fame 10 — 경쟁 열림', truthy(evaluate(row('guild_friction').when, gf, null)), '');
  // 영입 전쟁은 무소속 전용 (가입하면 잠김 — scout_offer와 계단 구조)
  const pw = engine.makeLookup(S, { ...fresh().vars, fame: 40 });
  const pwG = engine.makeLookup(S, { ...fresh().vars, fame: 40, guild: '청염 길드' });
  ok('영입 전쟁 — 무소속 fame 35+만', truthy(evaluate(row('poach_war').when, pw, null))
    && !truthy(evaluate(row('poach_war').when, pwG, null)), '');
  // 상층부 — fame 40 유명세, A급(lic_n 5) 특무
  ok('유명세 fame 40+', truthy(evaluate(row('celebrity').when, pw, null)), '');
  const aT = engine.makeLookup(S, { ...fresh().vars, license: 'A' });
  ok('협회 특무 — A급(lic_n 5)은 열리고 신입은 잠김', truthy(evaluate(row('assoc_task').when, aT, null)), '');
  // 임무 등급 비례 (2026-09-01 후속) — 의뢰·길드·협회가 난이도를 주인공 대역에 맞춘다
  ok('의뢰 보드 — 라이선스 대역 ±1 지시', row('offer_post').notify.includes('license band (±1 rank)'), '');
  ok('길드 일감 — 랭크·명성 비례 지시', row('guild_task').notify.includes('Scale the ask'), '');
  ok('협회 심부름 — 대역 정합 지시', row('assoc_call').notify.includes('license band (±1 rank)'), '');
}

console.log('\n━━ P9 — 던전 탐사 (탐사도 · 구역 · 조사 포인트 · 보스 방 래치) ━━');
{
  let t = fresh();
  // 게이트 밖 — 지시문·표시 전부 접힘
  const p0 = engine.sendPhase(S, t, { rng: seededRng('h', 950, 's') });
  ok('밖 — 탐사 지시문 없음', !p0.promptBlock.includes('조사 가능한 요소')
    && !p0.promptBlock.includes('드랍 기준'), '');
  ok('밖 — 표시 — 로 접힘', engine.makeLookup(S, p0.state.vars)('explore_txt') === '—', '');
  t = p0.state;

  // 입장 — 래치 리셋 + 지시문 등장
  ({ st: t } = turn(t, { in_gate: true, explore: 10, gate_room: '무너진 개찰구 홀',
    gate_poi: '녹슨 개찰구 · 벽의 발톱자국' }, 951));
  ok('입장 턴 — 보조 보고 반영 (리셋은 입장 전이에만)', t.vars.explore === 10
    && t.vars.gate_room === '무너진 개찰구 홀' && t.vars.was_gate === true, JSON.stringify([t.vars.explore, t.vars.was_gate]));
  const p1 = engine.sendPhase(S, t, { rng: seededRng('h', 952, 's') });
  ok('안 — 탐사 연출 + 드랍 기준표 지시문', p1.promptBlock.includes('조사 가능한 요소')
    && p1.promptBlock.includes('드랍 기준') && p1.promptBlock.includes('탐사도 10%'), '');
  ok('상태창 — 탐사도·구역·포인트 표시', (() => {
    const html = SC.require('render').renderStatusHtml(S, p1.state, null, null, { uid: 11 });
    return html.includes('EXPLORATION') && html.includes('10%') && html.includes('무너진 개찰구 홀')
      && html.includes('발톱자국');
  })(), '');
  t = p1.state;

  // 탐사도 상승 전용 (감소 차단) + 보스 방 래치 85
  ({ st: t } = turn(t, { explore: -10 }, 953));
  ok('탐사도 감소 차단 (maxLoss 0)', t.vars.explore === 10, String(t.vars.explore));
  t.vars.explore = 80;
  ({ st: t } = turn(t, { explore: 8 }, 954));
  ok('85 도달 — 보스 방 발견 래치', t.vars.boss_found === true
    && t.meta.pendingNotifies.some((n) => n.includes('boss chamber')), '');
  const pB = engine.sendPhase(S, t, { rng: seededRng('h', 955, 's') });
  ok('표시 — 보스 방 발견 병기', engine.makeLookup(S, pB.state.vars)('explore_txt').includes('보스 방 발견'), '');
  t = pB.state;
  ({ st: t } = turn(t, { explore: 5 }, 956));
  ok('래치 유지 — 재발화 없음', t.vars.boss_found === true
    && !t.meta.pendingNotifies.some((n) => n.includes('boss chamber')), '');

  // 퇴장 — 전부 리셋
  ({ st: t } = turn(t, { in_gate: false }, 957));
  ok('퇴장 — 탐사 상태 리셋', t.vars.explore === 0 && t.vars.gate_room === ''
    && t.vars.gate_poi === '' && t.vars.boss_found === false && t.vars.was_gate === false, JSON.stringify(t.vars.explore));
  // 재입장 — 새 던전은 0부터
  t.vars.explore = 0; // (이미 0이지만 의도 명시)
  ({ st: t } = turn(t, { in_gate: true, explore: 12 }, 958));
  ok('재입장 — 새로 시작 (리셋 후 이번 턴 보고만)', t.vars.explore === 12 && t.vars.boss_found === false, String(t.vars.explore));

  // 탐사 인터럽트 4종 — 존재·게이트 확인
  const T = S.rules.randomEvents.table;
  const ids = ['chest', 'vein', 'hidden_space', 'trace'];
  ok('탐사 이벤트 4종 존재', ids.every((id) => T.some((r) => r.id === id)), '');
  ok('전부 in_gate 전용', ids.every((id) => T.find((r) => r.id === id).when.includes('in_gate')), '');
  ok('심부 이벤트는 탐사도 게이트 (숨겨진 공간 30+, 흔적 50+)',
    T.find((r) => r.id === 'hidden_space').when.includes('explore >= 30')
    && T.find((r) => r.id === 'trace').when.includes('explore >= 50'), '');
  // 탐사도 게이트 실계산 — 갓 입장(explore 0)에는 심부 이벤트 후보가 안 잡힌다
  const Lsh = engine.makeLookup(S, { ...fresh().vars, in_gate: true, explore: 0 });
  ok('갓 입장 — 심부 이벤트 잠김', !truthy(evaluate(T.find((r) => r.id === 'trace').when, Lsh, null)), '');
}

console.log('\n━━ 성신의 가호 — 컨텍스트 층 1호 (이벤트=점화 · 변수=상태 · 지시문=지속) ━━');
{
  const von = S.vars.find((x) => x.id === 'boon_on');
  const vself = S.vars.find((x) => x.id === 'boon_self');
  ok('정책 토글 2종 — /가호(기본 꺼짐), /가호주인공(기본 켬)', von.init === false && von.cmd === '가호'
    && vself.init === true && vself.cmd === '가호주인공', '');
  // 기본 꺼짐 — 아무 흔적 없이 굴러가다, 켜는 턴에 즉시 점화
  const freshOn = () => { const f = fresh(); f.vars.boon_on = true; return f; };
  let d = fresh();
  ({ st: d } = turn(d, {}, 890));
  const pd = engine.sendPhase(S, d, { rng: seededRng('h', 891, 's') });
  ok('기본 꺼짐 — 점화 없음 · 지시문 없음 · 배너 —', d.vars.boon_i === 0
    && !pd.promptBlock.includes('성신의 가호') && engine.makeLookup(S, d.vars)('boon_quirk') === '—', '');
  d = pd.state; d.vars.boon_on = true;                                 // /가호 1
  ({ st: d } = turn(d, {}, 892));
  ok('켜는 턴에 즉시 점화 (시계 -7 그대로)', d.vars.boon_i >= 1
    && d.meta.pendingNotifies.some((n) => n.includes('성신의 가호')), String(d.vars.boon_i));

  // 첫 턴 점화 — boon_prev init -7이라 elapsed 0에서 즉시 (가호는 세계 상수)
  let t = freshOn();
  ({ st: t } = turn(t, {}, 900));
  ok(`첫 턴 점화 — 짝 배정 (1~${BOON_N})`, t.vars.boon_i >= 1 && t.vars.boon_i <= BOON_N, String(t.vars.boon_i));
  ok('점화 통지 대기', t.meta.pendingNotifies.some((n) => n.includes('성신의 가호')), '');

  // 지속 — 다음 턴부터 매턴 지시문 (현상+효과 한 몸 구조)
  const p1 = engine.sendPhase(S, t, { rng: seededRng('h', 901, 's') });
  ok('지시문 상시 — 현상·효과 실림', p1.promptBlock.includes('[성신의 가호 — 공인 주간 현상]')
    && p1.promptBlock.includes('이번 주 현상: "') && !p1.promptBlock.includes('{boon_quirk}'), '');
  ok('boon_self 켬 — 전원 적용 + 저항 규칙(효과 소멸)', p1.promptBlock.includes('주인공 포함 모든 헌터')
    && p1.promptBlock.includes('효과도 사라진다'), '');
  ok('상태창 배너 — 현상→효과 표시', (() => {
    const html = SC.require('render').renderStatusHtml(S, p1.state, null, null, { uid: 9 });
    return html.includes('성신의 가호') && !html.includes('{boon_quirk}');
  })(), '');

  // 주인공 제외 모드 — 문구가 갈린다
  t.vars.boon_self = false;
  const p2 = engine.sendPhase(S, t, { rng: seededRng('h', 902, 's') });
  ok('boon_self 끔 — 주인공 제외 문구', p2.promptBlock.includes('주인공을 제외한')
    && !p2.promptBlock.includes('주인공 포함 모든 헌터'), '');
  t.vars.boon_self = true;

  // 주간 로테이션 — 7일마다, 직전과 반드시 다른 짝 (랩어라운드 보장 10회 검증)
  let prev = t.vars.boon_i; let changedAll = true; let inRange = true;
  for (let w = 0; w < 10; w++) {
    ({ st: t } = turn(t, { skip_day: 7 }, 910 + w));
    if (t.vars.boon_i === prev) changedAll = false;
    if (t.vars.boon_i < 1 || t.vars.boon_i > BOON_N) inRange = false;
    prev = t.vars.boon_i;
  }
  ok('주간 로테이션 10회 — 매번 직전과 다른 짝', changedAll, '');
  ok(`로테이션 후 항상 1~${BOON_N} (랩어라운드 정합)`, inRange, String(prev));

  // ── 수위 게이트 — alter 꺼진 판에서는 수위 항목(6~7)이 절대 안 뽑힌다 ──
  let a = freshOn(); a.vars.alter_on = false;
  let alterLeak = false;
  ({ st: a } = turn(a, {}, 960));
  for (let w = 0; w < 20; w++) {
    ({ st: a } = turn(a, { skip_day: 7 }, 961 + w));
    if (a.vars.boon_i > BOON_BASE_N) alterLeak = true;
  }
  ok(`수위 꺼짐 — 20주 로테이션 전부 기본 항목(1~${BOON_BASE_N})`, !alterLeak, String(a.vars.boon_i));
  // 수위 항목 활성 중 /수위 0 — 지시문·표시 즉시 잠금, 다음 로테이션은 기본 폭으로 복귀
  let b = freshOn();
  ({ st: b } = turn(b, {}, 985));
  b.vars.boon_i = BOON_N;              // 마지막 수위 항목을 강제 활성
  b.vars.alter_on = false;
  const pb2 = engine.sendPhase(S, b, { rng: seededRng('h', 986, 's') });
  ok('수위 항목 활성 중 /수위 0 — 지시문 잠김', !pb2.promptBlock.includes('[성신의 가호 — 공인 주간 현상]'), '');
  ok('표시도 — 로 잠김', engine.makeLookup(S, b.vars)('boon_quirk') === '—', '');
  b = pb2.state; b.vars.boon_i = BOON_N; b.vars.alter_on = false;
  ({ st: b } = turn(b, { skip_day: 7 }, 987));
  ok('다음 로테이션 — 기본 폭으로 복귀 (빼기 두 패스)', b.vars.boon_i >= 1 && b.vars.boon_i <= BOON_BASE_N,
    String(b.vars.boon_i));

  // 7일 미만엔 안 돈다
  const before = t.vars.boon_i;
  ({ st: t } = turn(t, { skip_day: 3 }, 930));
  ({ st: t } = turn(t, { skip_day: 3 }, 931));
  ok('6일 경과 — 아직 그대로', t.vars.boon_i === before, '');
  ({ st: t } = turn(t, { skip_day: 1 }, 932));
  ok('7일째 — 갱신', t.vars.boon_i !== before, '');

  // 끄면 — 지시문·로테이션 정지, 상태창은 — 표기
  let u = freshOn();
  ({ st: u } = turn(u, {}, 940));
  u.vars.boon_on = false;
  // 직전 턴 점화 통지([성신의 가호] 주간 갱신)는 이번 전송에 실리는 게 정상 — 지시문만 재라
  const p3 = engine.sendPhase(S, u, { rng: seededRng('h', 941, 's') });
  ok('/가호 0 — 지시문 사라짐', !p3.promptBlock.includes('[성신의 가호 — 공인 주간 현상]'), '');
  ok('끄면 파생도 — 표기', engine.makeLookup(S, u.vars)('boon_quirk') === '—', '');
  const iOff = u.vars.boon_i;
  ({ st: u } = turn(u, { skip_day: 14 }, 942));
  ok('꺼진 동안 로테이션 정지', u.vars.boon_i === iOff, '');

  // 보조가 가호 변수를 못 만진다 (시스템 전용)
  ok('updater allow에 boon 계열 없음', !S.updater.allow.some((a) => a.id.startsWith('boon_')), '');

  // ── 버튼 토글 (유저 요청) — 막간처럼 상태창 범례에서, oneshot 반전 ──
  const act = S.actions.find((x) => x.id === 'boon_toggle');
  ok('가호 토글 액션 존재 (oneshot)', !!act && (act.mode || 'oneshot') === 'oneshot', '');
  let c = freshOn();
  ({ st: c } = turn(c, {}, 990));            // 점화된 상태에서 시작
  ok('전제 — 켜져 있음', c.vars.boon_on === true, '');
  c = engine.toggleAction(S, c, 'boon_toggle').state;
  const off1 = engine.sendPhase(S, c, { rng: seededRng('h', 991, 's') });
  ok('버튼 1회 — 다음 전송에서 끔 + 같은 턴 지시문부터 반영', off1.state.vars.boon_on === false
    && off1.consumedActions.includes('boon_toggle')
    && !off1.promptBlock.includes('[성신의 가호 — 공인 주간 현상]'), '');
  ok('전환 연출 inject 실림', off1.promptBlock.includes('가호 정책이 방금 전환'), '');
  ok('oneshot — 발동 후 무장 해제', !off1.state.meta.armed?.boon_toggle, '');
  let c2 = engine.toggleAction(S, off1.state, 'boon_toggle').state;
  const on1 = engine.sendPhase(S, c2, { rng: seededRng('h', 992, 's') });
  ok('버튼 2회 — 도로 켬 + 지시문 복귀 (boon_i 유지라 같은 주 재개)', on1.state.vars.boon_on === true
    && on1.promptBlock.includes('[성신의 가호 — 공인 주간 현상]'), '');

  // ── 잔향 지우기 (유저 우려: 끄거나 바뀌어도 기록의 옛 말투가 이어진다) ──
  const FADE = '[성신의 가호 — 교체됨]';
  let z = freshOn();
  ({ st: z } = turn(z, {}, 1000));                                   // 첫 점화
  const z0 = engine.sendPhase(S, z, { rng: seededRng('h', 1001, 's') });
  ok('첫 점화 — 잔향 지시문 없음 (직전이 없다)', !z0.promptBlock.includes(FADE), '');
  z = z0.state;
  const beforeI = z.vars.boon_i;
  ({ st: z } = turn(z, { skip_day: 7 }, 1002));                      // 주간 교체
  const z1 = engine.sendPhase(S, z, { rng: seededRng('h', 1003, 's') });
  const prevTxt = engine.makeLookup(S, z1.state.vars)('boon_prev_txt');
  ok('교체 직후 — 잔향 지시문 + 직전 현상 이름', z1.promptBlock.includes(FADE)
    && z1.promptBlock.includes(`"${prevTxt}"`) && z.vars.boon_prev_i === beforeI, prevTxt);
  ok('새 현상 지시문과 공존', z1.promptBlock.includes('[성신의 가호 — 공인 주간 현상]'), '');
  z = z1.state;
  let seen = 0;
  for (let i = 0; i < 4; i++) {
    ({ st: z } = turn(z, {}, 1004 + i));
    if (engine.sendPhase(S, z, { rng: seededRng('h', 1010 + i, 's') }).promptBlock.includes(FADE)) seen++;
  }
  ok('잔향은 몇 턴 뒤 스스로 꺼진다 (4턴 안에 소멸)', seen < 4 && z.vars.boon_fade === 0, String(seen));
  // 버튼으로 끄기 — 같은 턴부터 잔향 + 3턴 유지
  let y = freshOn();
  ({ st: y } = turn(y, {}, 1020));
  const yi = y.vars.boon_i;
  y = engine.toggleAction(S, y, 'boon_toggle').state;
  const y1 = engine.sendPhase(S, y, { rng: seededRng('h', 1021, 's') });
  ok('버튼 끔 — 같은 턴에 잔향 지시문 (현상 지시문은 없음)', y1.promptBlock.includes(FADE)
    && !y1.promptBlock.includes('[성신의 가호 — 공인 주간 현상]') && y1.state.vars.boon_prev_i === yi, '');
  ok('끌 때 잔향 3', y1.state.vars.boon_fade === 3, String(y1.state.vars.boon_fade));
  // 도로 켜면 잔향 즉시 해제 (새 현상 통지가 있으니 잔향은 불필요)
  let y2 = engine.toggleAction(S, y1.state, 'boon_toggle').state;
  const y3 = engine.sendPhase(S, y2, { rng: seededRng('h', 1022, 's') });
  ok('도로 켬 — 잔향 0', y3.state.vars.boon_fade === 0 && !y3.promptBlock.includes(FADE), '');
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
