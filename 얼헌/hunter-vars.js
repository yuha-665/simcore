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
const idx1 = (list, v) => chain(list.slice(0, -1).map((name, i) => [`${v} == ${i + 1}`, `'${name}'`]),
  `'${list[list.length - 1]}'`);

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
    // 판정 주사위 — 헌터물에서 주사위는 호불호가 갈린다 (유저 지시 2026-08-29): 기본 켬 + /판정 으로 끔.
    // 끄면 판정 부착 이벤트 4종이 통째로 잠긴다 (판정 자체가 이벤트로만 굴러가므로 게이트가 하나다).
    { id: 'dice_on', label: '판정 주사위', type: 'bool', init: true, cmd: '판정',
      desc: '유저 정책값. 켜면 전투·회피·감지·교섭 국면에서 시스템이 주사위를 굴려 [판정] 줄을 준다. '
        + '끄면 순수 서사 재량. 시작 후 바꾸려면 /판정.' },
    // 원본 toggle_alterNSFW(=2) 승계 — 확장 수위 팩(alter_nsfw)의 when 게이트
    { id: 'alter_on', label: '수위 확장', type: 'bool', init: true, cmd: '수위',
      desc: '유저 정책값 (원본 alterNSFW 토글 승계). 끄면 확장 수위 이미지 팩이 잠긴다 '
        + '(기본 팩은 그대로). 시작 후 바꾸려면 /수위.' },
    { id: 'hazard', label: '위험도', type: 'int', init: 30, min: 0, max: 100,
      desc: '세계의 흉흉함 — 프리셋이 정하고 P3 게이트 빈도·이벤트 문턱이 읽는다. 직접 바꾸지 마라.' },

    // ── 게이트 (P3) ──
    { id: 'day_prev', label: '(내부) 지난 정산일', type: 'int', init: 0, min: 0,
      desc: '시스템 전용 — 일 단위 카운트다운의 거울 변수. 직접 바꾸지 마라.' },
    { id: 'pay_prev', label: '(내부) 지난 급여일', type: 'int', init: 0, min: 0,
      desc: '시스템 전용 — 길드 급여 주기(30일)의 거울 변수. 직접 바꾸지 마라.' },
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

    // ── 헌터넷 (P4) — 게이트 안 통신 두절 게이트 ──
    { id: 'in_gate', label: '게이트 안', type: 'bool', init: false,
      desc: 'true while the protagonist is INSIDE a Gate/dungeon (communications cut). '
        + 'Set back to false the moment they exit.' },

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
      // 브레이크 초읽기 — 흐른 날수만큼 깎는다. ⚠ day_prev 갱신은 반드시 이 뒤에.
      { set: 'break_in', expr: 'break_name != "" ? max(break_in - (elapsed - day_prev), 0) : 0' },
      { set: 'day_prev', expr: 'elapsed' },
      // 급여 시계 — 무소속인 동안엔 거울이 따라가고(주기 정지), 가입한 날부터 30일을 센다.
      { set: 'pay_prev', expr: "guild == '무소속' ? elapsed : pay_prev" },
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
            + 'measurement follow-up, paperwork, or a favor with strings attached.' },
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
        // ── 판정 이벤트 (dice_on 정책 — /판정 으로 온오프) ──
        // 굴림·정산은 엔진(checks), 여기는 "언제 굴리나"만. 끄면 이 4종이 통째로 잠기고
        // 나머지 이벤트는 그대로다 — 주사위 호불호가 콘텐츠 손실로 이어지지 않는다.
        { id: 'gate_clash', weight: 4, cooldown: 3, when: 'dice_on and in_gate', check: 'gate_fight',
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
  // "이벤트가 국면을 열고 주사위가 판을 정하는" 결이다. d20 + 스탯/10 보정, hazard가 문턱을 민다.
  checks: [
    { id: 'gate_fight', label: '전투 판정', roll: 'rand(1, 20)',
      mod: 'floor(mainstat / 10) + floor(level / 10)',
      vs: '13 + floor(hazard / 25)',
      grades: [
        { when: 'roll == 1', label: '치명적 실수', effects: [{ set: 'hp', expr: 'max(hp - 15, 0)' }],
          inject: '치명적인 실수가 나왔다 — 부상급 대가를 치르고 국면이 급격히 나빠진다.' },
        { when: 'total >= vs + 7', label: '압도', effects: [{ set: 'fame', expr: 'min(fame + 1, 100)' }],
          inject: '기대 이상의 전과다 — 지켜본 이가 있다면 소문이 날 만한 장면으로 그려라. '
            + '전리품도 후하게 떨어진다 (마정석·부산물·장비 — 소지품 갱신).' },
        { when: 'total >= vs', label: '우세', inject: '전투의 주도권을 잡는다 — 유효타를 그려라.' },
        { label: '고전', effects: [{ set: 'sp', expr: 'max(sp - 15, 0)' }],
          inject: '결정타가 나오지 않는다 — 소모전이다. 밀리는 국면을 그려라.' },
      ] },
    { id: 'evade', label: '회피 판정', roll: 'rand(1, 20)', mod: 'floor(agi / 10)',
      vs: '12 + floor(hazard / 25)',
      grades: [
        { when: 'roll == 1', label: '직격', effects: [{ set: 'hp', expr: 'max(hp - 20, 0)' }],
          inject: '피할 수 없었다 — 직격이다.' },
        { when: 'total >= vs + 7', label: '완벽 회피', inject: '종이 한 장 차이로 흘리고 반격 자세까지 잡는다.' },
        { when: 'total >= vs', label: '회피', inject: '아슬아슬하게 피한다.' },
        { label: '피격', effects: [{ set: 'hp', expr: 'max(hp - 10, 0)' }],
          inject: '미처 다 피하지 못했다 — 가볍지 않은 대가다.' },
      ] },
    { id: 'sense', label: '감지 판정', roll: 'rand(1, 20)', mod: 'floor(sen / 10)', vs: 13,
      grades: [
        { when: 'total >= vs + 7', label: '통찰', inject: '숨겨진 것의 정체까지 짚어낸다 — 정보를 아끼지 말고 줘라.' },
        { when: 'total >= vs', label: '감지', inject: '무언가 눈치챈다 — 단서 하나를 쥐여줘라.' },
        { label: '무감', inject: '낌새를 놓쳤다 — 그 대가는 나중에 온다.' },
      ] },
    { id: 'parley', label: '교섭 판정', roll: 'rand(1, 20)',
      mod: 'floor(intel / 10) + floor(fame / 20)', vs: 13,
      grades: [
        { when: 'total >= vs + 7', label: '설복', effects: [{ set: 'fame', expr: 'min(fame + 1, 100)' }],
          inject: '상대가 완전히 넘어온다 — 기대 이상의 조건을 끌어내라.' },
        { when: 'total >= vs', label: '타결', inject: '대화가 통한다 — 합리적인 선에서 성사시켜라.' },
        { label: '결렬', inject: '말이 먹히지 않는다 — 상대의 태도가 굳는다. 다른 길을 찾게 하라.' },
      ] },
  ],

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
      { id: 'npc_notes' },
      { id: 'allies' },
      { id: 'in_gate' },
      { id: 'gates' },
      { id: 'break_name', maxLength: 30 },
      { id: 'break_in', maxGain: 30, maxLoss: 30 },
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
    postsPerTurn: 2, maxPosts: 20,
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
.hmap-foot { margin-top: 8px; color: #7d8aa5; font-size: 11px; border-top: 1px dashed rgba(138,162,204,.18);
  padding-top: 6px; }`,
  },

  // ── 알터 스토어 (P4.5) — 상점 (v0.96 엔진 기능) ──
  // 원본 로어북 상점의 고질병(유저 지목): "S랭크 스킬북 뇌절 + 가격 계산 힘듦" →
  // 등급 어휘·가격 밴드를 여기 못박아 시스템이 강제한다. 코인 경제 기준: E랭크 킬 1~5C.
  shop: {
    label: '알터 스토어', icon: '🛒',
    currency: 'coin', buyTo: 'items', sellFrom: 'items',
    categories: ['추천', '인기', '소모품', '장비', '스킬북', '기타'],
    grades: ['일반', '레어', '유니크'],
    bands: { '일반': [1, 60], '레어': [60, 400], '유니크': [400, 3000] },
    sellRate: 0.6, maxStock: 18,
    when: 'store_on',
    // 환전 — 원작 캐논: 코인의 공식 거래는 금지, 블랙 마켓만 예외 (시세 1코인 ≈ ₩1,000).
    // spread 0.2가 암거래 리스크 프리미엄: 살 때 1,200원 / 팔 때 800원.
    exchange: { var: 'won', rate: 1000, spread: 0.2, label: '암거래 환전' },
    guide: 'Coin economy baseline: an E-rank monster kill pays 1~5 Coin — price everything relative '
      + 'to that. Practical hunter goods (potions, whetstones, antidotes, mana crystals, skill books, '
      + 'gear). 추천/인기 are curation shelves — reuse items from other categories with a hook. '
      + 'Occasional 한정 상품 (qty). The store never sells Legendary anything.',
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
      {
        id: 'char_emotions',
        source: '얼헌 원본 Characters/Status Command List',
        sep: ' ', format: '<img="{name}">', verify: false,
        usage: '인물 등장·조명·발화 시 기본 1장 — 이름만. 감정이 크게 움직이면 감정 칸을 덧붙인다.',
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
    + '<div class="a-sec">GATE BOARD</div>'
    + '<div class="a-row"><span>최근 출현</span><span class="v">{zone_txt} · {grade_txt}급</span></div>'
    + '<div class="a-row"><span>브레이크 경보</span><span class="v">{break_txt}</span></div>'
    + '{gates:tags}'
    + '<div class="a-sec">PEOPLE — 인물 변동</div>'
    + '{npc_notes:tags}'
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

console.log('\n━━ 전리품 — 드랍 순간을 여는 이벤트 ━━');
{
  const row = S.rules.randomEvents.table.find((r) => r.id === 'loot_drop');
  ok('게이트 안 전용', row && row.when === 'in_gate', row?.when);
  // 코인은 스토어가 켜진 세계에서만 굴러들어온다 (정책 조건이 effects 식 안에)
  const L0 = engine.makeLookup(S, fresh().vars);   // store_on=false, coin=0
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
  ok('팩 4종 (감정·엑스트라·체위·확장수위)', S.assets.packs.length === 4,
    S.assets.packs.map((p) => p.id).join(','));
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
}

console.log('\n━━ P4.5 — 알터 스토어 (상점) ━━');
{
  const shopMod = SC.require('shop');
  let t = fresh();
  ok('기본(store_on=false) — 첫 입고 요청 없음', !engine.buildAuxPrompt(S, t, '서사', null).includes('첫 입고'));
  t.vars.store_on = true;
  ok('스토어 켜면 — 첫 입고 요청 + 지시문',
    engine.buildAuxPrompt(S, t, '서사', null).includes('첫 입고')
    && turn(t, {}, 90).prompt.includes('Alter Store'));
  // 뇌절 봉쇄 — 레전더리 거부·밴드 클램프
  const r = shopMod.applyStock(S, t, { stock: [
    { cat: '스킬북', name: 'S급 스킬북', grade: '레전더리', price: 99999 },
    { cat: '소모품', name: '하급 회복 포션', grade: '일반', price: 999 },
  ], buying: [{ name: '고블린 마정석', price: 4 }] });
  ok('레전더리 뇌절 거부 + 일반가 60 클램프', r.stocked === 1 && t.shop.stock[0].price === 60
    && r.rejected.length === 1, JSON.stringify({ r, stock: t.shop.stock }));
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
