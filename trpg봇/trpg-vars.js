const __P = (...p) => require('path').resolve(__dirname, ...p);
// 페르소나테이블 (심코어판) — TRPGMaster(루아 1.4MB) 하이브리드 이식의 1단계 골격.
//
// 원본 봇: 대학 TRPG 동아리 4인이 레벨 1 PC를 굴리고 유저가 GM을 맡는다.
// 렉의 3대 원흉(거대 루아 파싱 / 메시지 속 패널 HTML / 매 턴 패널 LLM)을 전부 심코어로 옮기고,
// 루아에는 삽화 태그·에피소드 본문·커스텀 클래스 생성만 남긴다 (읽기 전용 — 게임 숫자는 심코어 소유).
//
// 숫자는 전부 원본 루아에서 실측 추출했다 (trpg봇/lua.txt):
//   판정: d20 + 보정 vs DC — 1 대실패 / 20 또는 DC+10 대성공 / DC 성공 / DC-3 부분 성공 / 실패
//   피해 배율: 1.5 / 1.0 / 0.5 / 0 / 0 (getDiceResultTier + TIER_DAMAGE_MULT)
//   능력 보정: floor((능력치 - 10) / 2), 스킬 효과량: 2 + 레벨 보정 + 능력 보정
//   HP 최대: 클래스 기본 + max(0, 체력 보정) — 레벨은 HP를 안 올린다 (tmMaxHpFor)
//   MP 최대: 클래스 기본 + max(0, max(지혜, 지능) 보정) (tmMaxMpFor)
//   XP 곡선: 레벨 구간 = 50 × 2^(레벨-1), party_xp는 공유·누적 (tmExpForLevelStep)
//   레벨업: AP +1, AP 1 = 능력치 +1 (tmLevelUpOwner / tmSpendApOnStat)
//   적 공식: en_l{밴드1-5}_{티어}: HP LUT / ATK 3·5·7·10·13 / DC 11·15·17·19·21 (tmEnemyDcFor)
//   서비스: 여관 20골드(휴식) / 교회 부활 50골드(절반 HP) — 도움말 실측값
//
// 원본에서 **일부러 뺀 것**: 페이스 시스템의 12턴 마무리 추첨 (장편을 죽이는 주범 —
// 종결은 지시문으로 "유저 선언 전엔 닫지 마라"를 못 박는 쪽으로 뒤집었다).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');
const party = SC.require('party');

// ── 파티 명단 (원본 고정 4인) ─────────────────────────────────────────
// [id, 호칭, 클래스, 주력 스탯, HP기본, MP기본, 스탯 우선순위(표준 배열 15·14·13·12·10·8 배분)]
// HP/MP 기본은 루아 TM_COMPRESSED_VITAL_DEFAULTS 실측값 그대로다.
const PCS = [
  ['soyul', '소율', '전사', 'str', 30, 4, ['str', 'con', 'dex', 'wis', 'cha', 'int']],
  ['hanna', '한나', '마법사', 'int', 22, 10, ['int', 'wis', 'dex', 'cha', 'con', 'str']],
  ['minhee', '민희', '무투가', 'str', 24, 4, ['str', 'dex', 'con', 'wis', 'cha', 'int']],
  ['seola', '설아', '로그', 'dex', 24, 4, ['dex', 'wis', 'con', 'int', 'cha', 'str']],
];
const STATS = [['str', '근력'], ['dex', '민첩'], ['con', '체력'], ['int', '지능'], ['wis', '지혜'], ['cha', '매력']];
const STAT_KO = Object.fromEntries(STATS);
const ARRAY = [15, 14, 13, 12, 10, 8];
const CONDS = ['정상', '중독', '출혈', '화상', '기절', '공포', '약화', '침묵', '전투불능'];

// 적 공식 — 루아 TM_ENEMY_HP_LUT / TM_ENEMY_ATK_BY_BAND 그대로
const EN_TIERS = [['허약', [9, 20, 34, 48, 66]], ['표준', [12, 22, 36, 50, 70]], ['중장', [14, 28, 42, 56, 74]], ['정점', [16, 30, 46, 60, 78]]];
const EN_ATK = [3, 5, 7, 10, 13];
// XP: 레벨 L→L+1에 필요한 누적치 = 50 × (2^L − 1). 레벨 8이 골격의 캡.
const XP_NEED = [50, 150, 350, 750, 1550, 3150, 6350];

const INN_COST = 20, REVIVE_COST = 50, CHAPEL_COST = 15, LEVEL_CAP = 8;

// 표현식 조립 헬퍼 — 표를 고치면 식이 따라온다
const bandPick = (arr) => arr.slice(0, -1).reduceRight(
  (acc, v, i) => `en_band >= ${arr.length - 1 - i + 1} ? ${arr[arr.length - 1 - i]} : (${acc})`, String(arr[0]));
// ⚠ reduceRight 인덱스 곡예는 읽기 지옥이라 밴드는 그냥 손으로 편다
const byBand = (arr) => `en_band >= 5 ? ${arr[4]} : (en_band >= 4 ? ${arr[3]} : (en_band >= 3 ? ${arr[2]} : (en_band >= 2 ? ${arr[1]} : ${arr[0]})))`;
const byActor = (fn) => PCS.slice(0, -1).reduceRight(
  (acc, [id, nick]) => `actor == '${nick}' ? (${fn(id)}) : (${acc})`, `(${fn(PCS[3][0])})`);
const mod = (id, s) => `floor((${id}_${s} - 10) / 2)`;

// 담당(actor)이 맞은 피해·MP 소모 — 4인 각자의 변수에 삼항으로 흘려보낸다
const hurtActor = (amt) => PCS.map(([id, nick]) => (
  { set: `${id}_hp`, expr: `actor == '${nick}' ? max(0, ${id}_hp - (${amt})) : ${id}_hp` }));
const spendMp = (n) => PCS.map(([id, nick]) => (
  { set: `${id}_mp`, expr: `actor == '${nick}' ? max(0, ${id}_mp - ${n}) : ${id}_mp` }));

// ── 변수 ──────────────────────────────────────────────────────────────
const V = [];
const v = (o) => { V.push(o); return o; };

v({ id: 'scene', label: '국면', type: 'enum', enum: ['일상', '세션'], init: '일상',
  desc: '일상 = 동아리방 현실. 세션 = 테이블 위 TRPG 진행 중.' });
v({ id: 'gold', label: '소지금', type: 'int', init: 30, min: 0, format: '{v}G',
  desc: '파티 공유 지갑. 획득·지출은 시스템이 정산한다.' });
v({ id: 'party_xp', label: '파티 XP', type: 'int', init: 0, min: 0,
  desc: '공유 경험치. 판정과 전투가 쌓는다. 누적치라 줄지 않는다.' });
v({ id: 'actor', label: '판정 담당', type: 'enum', enum: PCS.map((p) => p[1]), init: PCS[0][1], cmd: '담당',
  desc: '지금 행동을 선언한 PC. 장면에서 실제로 움직이는 인물로 유지하라.' });
v({ id: 'check_stat', label: '판정 능력', type: 'enum', enum: STATS.map((s) => s[1]), init: '근력', cmd: '능력',
  desc: '자유 판정이 어느 능력으로 구르는지. 힘쓰기 근력 / 몸놀림 민첩 / 버티기 체력 / 추리 지능 / 직감·치료 지혜 / 언변 매력.' });
v({ id: 'dc', label: '난이도', type: 'int', init: 13, min: 5, max: 30, cmd: '난이도',
  desc: '자유 판정의 목표치. 쉬움 10, 보통 13, 어려움 16, 지극히 어려움 20.' });
v({ id: 'adv', label: '이점 대기', type: 'bool', init: false,
  desc: '켜져 있으면 다음 판정을 두 번 굴려 높은 눈을 쓴다. 쓰면 꺼진다.' });
v({ id: 'need_roll', label: '판정 요청', type: 'bool', init: false,
  desc: '서사상 판정이 필요한데 버튼이 안 눌렸을 때 켠다. 시스템이 대신 굴린다.' });

// 적 — 원본의 ▥ENEMY▥ 마커를 변수 3개로 대체한다. 보조 AI가 위협 등장을 선언하면
// (en_active) 등장 이벤트가 공식 HP를 시드하고, 처치·이탈이 내린다.
v({ id: 'en_active', label: '적 출현', type: 'bool', init: false,
  desc: '장면에 싸울 수 있는 위협이 나타나면 켠다. 등급은 en_band/en_tier로.' });
v({ id: 'en_engaged', label: '교전 중', type: 'bool', init: false,
  desc: '시스템 전용 — 등장 이벤트가 켜고 처치·이탈이 끈다.' });
v({ id: 'en_band', label: '위협 단계', type: 'int', init: 1, min: 1, max: 5,
  desc: '파티 레벨대에 맞춘 위협 밴드 1~5. 레벨 1~2 파티는 1, 이후 레벨 2당 +1 정도.' });
v({ id: 'en_tier', label: '위협 체급', type: 'enum', enum: EN_TIERS.map((t) => t[0]), init: '표준',
  desc: '허약(잡졸) / 표준 / 중장(단단함) / 정점(보스급).' });
v({ id: 'en_hp', label: '적 HP', type: 'int', init: 0, min: 0 });

for (const [id, nick, cls, main, hpBase, mpBase, order] of PCS) {
  for (let i = 0; i < order.length; i++) {
    v({ id: `${id}_${order[i]}`, label: `${nick} ${STAT_KO[order[i]]}`, type: 'int', init: ARRAY[i], min: 3, max: 20 });
  }
  // init은 표준 배열 기준 최대치와 같게 계산해 둔다 (파생 최대는 아래 derived)
  const conInit = ARRAY[order.indexOf('con')];
  const mpStatInit = Math.max(ARRAY[order.indexOf('wis')], ARRAY[order.indexOf('int')]);
  const m = (x) => Math.max(0, Math.floor((x - 10) / 2));
  v({ id: `${id}_hp`, label: `${nick} HP`, type: 'int', init: hpBase + m(conInit), min: 0, max: 99 });
  v({ id: `${id}_mp`, label: `${nick} MP`, type: 'int', init: mpBase + m(mpStatInit), min: 0, max: 30 });
  v({ id: `${id}_level`, label: `${nick} 레벨`, type: 'int', init: 1, min: 1, max: LEVEL_CAP, format: 'Lv{v}' });
  v({ id: `${id}_ap`, label: `${nick} AP`, type: 'int', init: 0, min: 0,
    desc: '레벨업이 준다. 시트 패널에서 능력치 1점과 바꾼다.' });
  v({ id: `${id}_cond`, label: `${nick} 상태`, type: 'enum', enum: CONDS, init: '정상',
    desc: '서사가 만든 상태이상 하나. HP 0이면 시스템이 전투불능으로 만든다.' });
}

// ── 파생 ──────────────────────────────────────────────────────────────
const D = [];
for (const [id, nick, cls, main, hpBase, mpBase] of PCS) {
  // HP는 레벨이 아니라 체질이 정한다 — AP로 체력을 올리면 최대 HP가 따라 오른다 (원본 공식)
  D.push({ id: `${id}_hp_max`, label: `${nick} 최대 HP`, expr: `${hpBase} + max(0, ${mod(id, 'con')})` });
  D.push({ id: `${id}_mp_max`, label: `${nick} 최대 MP`, expr: `${mpBase} + max(0, floor((max(${id}_wis, ${id}_int) - 10) / 2))` });
  // 판정 능력(check_stat)이 고르는 이 PC의 보정 — 자유 판정의 부품
  D.push({ id: `${id}_ck_mod`, label: `${nick} 판정 보정`,
    expr: STATS.slice(0, -1).reduceRight(
      (acc, [s, ko]) => `check_stat == '${ko}' ? ${mod(id, s)} : (${acc})`, mod(id, STATS[5][0])) });
  // 공격은 클래스 주력 스탯, 효과량 = 2 + 레벨 보정 + 능력 보정 (원본 스킬 효과량 공식)
  D.push({ id: `${id}_atk_amt`, label: `${nick} 공격 위력`, expr: `2 + floor((${id}_level - 1) / 2) + ${mod(id, main)}` });
  D.push({ id: `${id}_sp_amt`, label: `${nick} 주문 위력`, expr: `2 + floor((${id}_level - 1) / 2) + floor((max(${id}_wis, ${id}_int) - 10) / 2)` });
  // 다음 레벨 문턱 (공유 XP 누적치 기준)
  D.push({ id: `${id}_xp_need`, label: `${nick} 레벨업 필요치`,
    expr: XP_NEED.slice(0, -1).reduceRight(
      (acc, n, i) => `${id}_level <= ${i + 1} ? ${n} : (${acc})`, String(XP_NEED[6])) });
}
// 담당이 누구든 한 식으로 읽는 손잡이 — 판정·게이트가 이걸 문다
D.push({ id: 'act_ck_mod', label: '담당 판정 보정', expr: byActor((id) => `${id}_ck_mod`) });
D.push({ id: 'act_atk_mod', label: '담당 공격 보정', expr: byActor((id) => mod(id, PCS.find((p) => p[0] === id)[3])) });
D.push({ id: 'act_atk_amt', label: '담당 공격 위력', expr: byActor((id) => `${id}_atk_amt`) });
D.push({ id: 'act_sp_amt', label: '담당 주문 위력', expr: byActor((id) => `${id}_sp_amt`) });
D.push({ id: 'act_mp', label: '담당 MP', expr: byActor((id) => `${id}_mp`) });
D.push({ id: 'act_ko', label: '담당 전투불능', expr: byActor((id) => `${id}_cond == '전투불능' ? 1 : 0`) });
// 적 스펙 — 밴드·체급이 정하고 누구도 직접 못 만진다
D.push({ id: 'en_hp_max', label: '적 최대 HP',
  expr: EN_TIERS.slice(0, -1).reduceRight(
    (acc, [ko, arr]) => `en_tier == '${ko}' ? (${byBand(arr)}) : (${acc})`, `(${byBand(EN_TIERS[3][1])})`) });
D.push({ id: 'en_dc', label: '적 방어 목표치', expr: 'en_band * 2 + 9 + (en_band >= 2 ? 2 : 0)' });
D.push({ id: 'en_atk', label: '적 반격 위력', expr: byBand(EN_ATK) });
D.push({ id: 'downs', label: '전투불능 수',
  expr: PCS.map(([id]) => `(${id}_cond == '전투불능' ? 1 : 0)`).join(' + ') });

// ── 판정 ──────────────────────────────────────────────────────────────
// 등급은 원본 getDiceResultTier 그대로: 1 대실패 / 20 또는 vs+10 대성공 / vs 성공 / vs-3 부분 / 실패.
// XP는 굴림마다 조금씩 — "판정과 전투가 XP를 준다"(원본 도움말)를 정액으로 굳혔다.
const CHECKS = [
  {
    id: 'ck_free', label: '판정',
    roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)', mod: 'act_ck_mod', vs: 'dc',
    grades: [
      { when: 'roll == 1', label: '대실패', effects: [{ set: 'party_xp', expr: 'party_xp + 1' }],
        inject: '단순한 실패가 아니라 상황을 악화시키는 대실패로 그려라.' },
      { when: 'roll == 20 or total >= vs + 10', label: '대성공', effects: [{ set: 'party_xp', expr: 'party_xp + 6' }],
        inject: '기대 이상의 성과다 — 극적으로 그려라.' },
      { when: 'total >= vs', label: '성공', effects: [{ set: 'party_xp', expr: 'party_xp + 4' }] },
      { when: 'total >= vs - 3', label: '부분 성공', effects: [{ set: 'party_xp', expr: 'party_xp + 2' }],
        inject: '성공은 성공이되 대가나 제약이 따라붙는 부분 성공으로 그려라.' },
      { label: '실패', effects: [{ set: 'party_xp', expr: 'party_xp + 1' }] },
    ],
  },
  {
    id: 'ck_attack', label: '공격 판정',
    roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)', mod: 'act_atk_mod', vs: 'en_dc',
    grades: [
      { when: 'roll == 1', label: '대실패',
        effects: [...hurtActor('en_atk'), { set: 'party_xp', expr: 'party_xp + 1' }],
        inject: '빈틈을 내주고 반격까지 허용한 대실패로 그려라.' },
      { when: 'roll == 20 or total >= vs + 10', label: '대성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - round(act_atk_amt * 1.5))' }, { set: 'party_xp', expr: 'party_xp + 5' }],
        inject: '압도적인 일격이다 — 극적으로 그려라.' },
      { when: 'total >= vs', label: '성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - act_atk_amt)' }, { set: 'party_xp', expr: 'party_xp + 3' }] },
      { when: 'total >= vs - 3', label: '부분 성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - floor(act_atk_amt / 2))' }, { set: 'party_xp', expr: 'party_xp + 2' }],
        inject: '스치듯 얕게 들어간 부분 성공으로 그려라.' },
      { label: '실패',
        effects: [...hurtActor('en_atk'), { set: 'party_xp', expr: 'party_xp + 1' }],
        inject: '공격이 빗나가고 반격을 허용했다.' },
    ],
  },
  {
    // 주문은 지혜·지능 중 높은 쪽 — 실패해도 반격은 없지만 MP는 이미 태웠다 (액션 effects가 소모)
    id: 'ck_spell', label: '주문 판정',
    roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
    mod: byActor((id) => `floor((max(${id}_wis, ${id}_int) - 10) / 2)`), vs: 'en_dc',
    grades: [
      { when: 'roll == 1', label: '대실패',
        effects: [...hurtActor('3'), { set: 'party_xp', expr: 'party_xp + 1' }],
        inject: '마력이 역류했다 — 시전자가 대가를 치르는 대실패로 그려라.' },
      { when: 'roll == 20 or total >= vs + 10', label: '대성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - round(act_sp_amt * 1.5))' }, { set: 'party_xp', expr: 'party_xp + 5' }],
        inject: '주문이 완벽하게 맺혔다 — 극적으로 그려라.' },
      { when: 'total >= vs', label: '성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - act_sp_amt)' }, { set: 'party_xp', expr: 'party_xp + 3' }] },
      { when: 'total >= vs - 3', label: '부분 성공',
        effects: [{ set: 'en_hp', expr: 'max(0, en_hp - floor(act_sp_amt / 2))' }, { set: 'party_xp', expr: 'party_xp + 2' }],
        inject: '주문이 흐트러져 절반만 닿았다.' },
      { label: '실패', effects: [{ set: 'party_xp', expr: 'party_xp + 1' }],
        inject: '주문이 허공에서 흩어졌다. 마력만 날렸다.' },
    ],
  },
];

// ── 액션 ──────────────────────────────────────────────────────────────
const A = [
  { id: 'session_start', label: '📖 세션 시작', mode: 'oneshot', when: "scene == '일상'",
    effects: [{ set: 'scene', expr: "'세션'" }],
    inject: '동아리방 테이블에 시트가 깔린다. 세션이 시작된다 — 오프닝 장면을 그려라.' },
  { id: 'session_end', label: '🕯️ 세션 종료', mode: 'oneshot', when: "scene == '세션'",
    effects: [
      { set: 'scene', expr: "'일상'" },
      { set: 'en_active', expr: 'false' }, { set: 'en_engaged', expr: 'false' }, { set: 'en_hp', expr: '0' },
    ],
    inject: '오늘 세션을 접는다. 시트를 정리하는 테이블과 세션 후 여운을 그려라.' },
  // 상시 판정 — 켜 두면 매 전송마다 담당·능력·난이도로 구른다. 순수 대화 턴엔 꺼 둔다.
  { id: 'auto_roll', label: '🎲 상시 판정', mode: 'hold', check: 'ck_free', when: "scene == '세션'",
    inject: '[행동] 이번 시도를 판정에 부친다.',
    effects: [{ set: 'adv', expr: 'false' }] },
  { id: 'attack', label: '⚔️ 공격', mode: 'oneshot', check: 'ck_attack',
    when: "scene == '세션' and en_engaged and act_ko == 0",
    inject: '[행동] 담당 PC가 무기로 현재 위협을 공격한다.',
    effects: [{ set: 'adv', expr: 'false' }] },
  { id: 'cast', label: '✨ 주문 (MP 2)', mode: 'oneshot', check: 'ck_spell',
    when: "scene == '세션' and en_engaged and act_ko == 0 and act_mp >= 2",
    inject: '[행동] 담당 PC가 주문으로 현재 위협을 공격한다.',
    effects: [...spendMp(2), { set: 'adv', expr: 'false' }] },
  { id: 'focus', label: '🧘 집중 (다음 판정 이점)', mode: 'oneshot', when: 'not adv', cooldown: 4,
    inject: '[행동] 호흡을 가다듬고 다음 순간에 집중한다.',
    effects: [{ set: 'adv', expr: 'true' }] },
  { id: 'flee', label: '🏳️ 교전 이탈', mode: 'oneshot', when: 'en_engaged',
    effects: [{ set: 'en_active', expr: 'false' }, { set: 'en_engaged', expr: 'false' }, { set: 'en_hp', expr: '0' }],
    inject: '싸움에서 물러난다. 무엇을 포기하고 몸을 뺐는지 그려라.' },
  // 서비스 — 원본 물가 그대로. 여관은 전투불능만 못 고친다 (그건 교회 몫)
  { id: 'inn_rest', label: `🛏️ 여관 숙박 (${INN_COST}G)`, mode: 'oneshot', when: `gold >= ${INN_COST}`, cooldown: 3,
    effects: [
      { set: 'gold', expr: `gold - ${INN_COST}` },
      ...PCS.map(([id]) => ({ set: `${id}_hp`, expr: `${id}_cond == '전투불능' ? ${id}_hp : ${id}_hp_max` })),
      ...PCS.map(([id]) => ({ set: `${id}_mp`, expr: `${id}_cond == '전투불능' ? ${id}_mp : ${id}_mp_max` })),
    ],
    inject: '여관에서 하룻밤 쉰다. 밤의 대화와 아침의 회복을 그려라.' },
  { id: 'chapel', label: `⛪ 교회 정화 (${CHAPEL_COST}G)`, mode: 'oneshot', when: `gold >= ${CHAPEL_COST}`, cooldown: 2,
    effects: [
      { set: 'gold', expr: `gold - ${CHAPEL_COST}` },
      ...PCS.map(([id]) => ({ set: `${id}_cond`, expr: `${id}_cond == '전투불능' ? ${id}_cond : '정상'` })),
    ],
    inject: '교회에서 축복을 받아 상태이상을 씻어낸다.' },
  ...PCS.map(([id, nick]) => ({
    id: `revive_${id}`, label: `✝️ ${nick} 부활 (${REVIVE_COST}G)`, mode: 'oneshot',
    when: `${id}_cond == '전투불능' and gold >= ${REVIVE_COST}`,
    effects: [
      { set: 'gold', expr: `gold - ${REVIVE_COST}` },
      { set: `${id}_hp`, expr: `floor(${id}_hp_max / 2)` },
      { set: `${id}_cond`, expr: "'정상'" },
    ],
    inject: `교회의 의식으로 ${nick}의 PC가 눈을 뜬다. 절반의 기력으로 돌아온 순간을 그려라.`,
  })),
];

// ── 규칙 ──────────────────────────────────────────────────────────────
// AP로 체력을 올리면 최대 HP가 늘어난다 — 현재치가 새 최대를 넘는 일은 없지만
// (늘기만 하므로), 반대로 최대가 줄 일도 없어 클램프는 안전망 한 줄이면 된다.
const onTurn = [
  ...PCS.map(([id]) => ({ set: `${id}_hp`, expr: `min(${id}_hp, ${id}_hp_max)` })),
  ...PCS.map(([id]) => ({ set: `${id}_mp`, expr: `min(${id}_mp, ${id}_mp_max)` })),
];

const EVENTS = [
  // 적 등장 — 보조 AI가 en_active를 켜면 공식 HP를 시드한다. en_engaged가 재발동을 막는 빗장.
  { id: 'en_spawn', when: 'en_active and not en_engaged',
    effects: [{ set: 'en_hp', expr: 'en_hp_max' }, { set: 'en_engaged', expr: 'true' }],
    notify: '위협이 모습을 드러냈다. 교전 상태에 들어간다 — 공격 판정으로 맞선다.' },
  { id: 'en_down', when: 'en_engaged and en_hp <= 0',
    effects: [
      { set: 'en_active', expr: 'false' }, { set: 'en_engaged', expr: 'false' },
      { set: 'party_xp', expr: "party_xp + en_band * 10 + (en_tier == '정점' ? 15 : (en_tier == '중장' ? 8 : 0))" },
      { set: 'gold', expr: "gold + en_band * 12 + (en_tier == '정점' ? 25 : (en_tier == '중장' ? 10 : 0))" },
    ],
    notify: '위협을 쓰러뜨렸다. 전리품과 경험이 파티에 들어온다 — 승리 직후를 그려라.' },
  // KO — HP 0이 되면 시스템이 전투불능을 박는다. 되살리는 길은 교회뿐 (원본 흐름).
  ...PCS.map(([id, nick]) => ({
    id: `ko_${id}`, when: `${id}_hp <= 0 and ${id}_cond != '전투불능'`,
    effects: [{ set: `${id}_cond`, expr: "'전투불능'" }],
    notify: `${nick}의 PC가 쓰러졌다. 교회의 의식 없이는 일어나지 못한다.`,
  })),
  // 레벨업 — 공유 XP가 문턱을 넘으면 자동. 한 턴에 하나씩 오르므로 몰아 받아도 순차 처리된다.
  ...PCS.map(([id, nick]) => ({
    id: `lv_${id}`, when: `party_xp >= ${id}_xp_need and ${id}_level < ${LEVEL_CAP}`,
    effects: [
      { set: `${id}_level`, expr: `${id}_level + 1` },
      { set: `${id}_ap`, expr: `${id}_ap + 1` },
    ],
    notify: `${nick}의 PC가 레벨업했다 (AP +1). 시트 패널에서 능력치에 투자할 수 있다.`,
  })),
];

// ── 지시문 ────────────────────────────────────────────────────────────
// 원본 페이스 시스템의 "12턴 마무리 추첨"을 정반대로 뒤집는 자리 — 장편 캠페인 선언.
const DIRECTIVES = [
  { id: 'daily', when: "scene == '일상'",
    text: '지금은 동아리방 일상이다. 세션 준비·잡담·관계가 중심이고, TRPG 수치는 잠들어 있다. 세션 시작을 재촉하지 마라.' },
  { id: 'campaign', when: "scene == '세션'",
    text: '장편 캠페인 진행 중이다. 시나리오의 종결·클리어·마무리를 먼저 제안하거나 서두르지 마라 — 끝내는 선언은 오직 GM(유저)의 몫이다. 막히면 단서·압박·반응으로 장면을 잇는다.' },
  { id: 'engage', when: 'en_engaged',
    text: '교전 중이다 — 적 HP {en_hp}/{en_hp_max}, 위협 단계 {en_band}({en_tier}). 피해와 처치는 [판정] 결과가 정한다. 수치를 본문에 적지 말고 타격의 무게로 묘사하라.' },
  { id: 'downed', when: 'downs >= 1',
    text: '전투불능인 PC가 {downs}명 있다. 그들은 행동 선언을 할 수 없고, 교회 의식 전에는 일어나지 못한다.' },
  { id: 'ask_roll', when: "scene == '세션' and not need_roll",
    text: '[판정 안내] 성패가 갈릴 행동인데 [판정] 결과가 함께 없다면 결과를 임의로 정하지 말고, 판정이 필요하다는 것만 드러내라. 수치는 시스템이 굴린다.' },
];

// ── 편성표 (시트 패널) ────────────────────────────────────────────────
const PARTY = {
  label: '시트', icon: '🎲', unique: false,
  note: 'AP는 레벨업이 준다. 능력치 1점 = AP 1. 체력을 올리면 최대 HP가 따라 오른다.',
  tabs: [
    ...PCS.map(([id, nick, cls]) => ({
      id: `grow_${id}`, label: `${nick}`, points: `${id}_ap`,
      note: `${cls} — AP {${id}_ap}. 능력치에 투자한다.`,
      items: STATS.map(([s, ko]) => ({ var: `${id}_${s}`, label: ko, max: 20, cost: '1' })),
    })),
    { id: 'ops', label: '세션', note: '판정 담당·능력은 /담당 /능력 명령이나 보조 AI가 장면 따라 정한다.',
      actions: ['session_start', 'session_end', 'auto_roll', 'attack', 'cast', 'focus', 'flee'] },
    { id: 'care', label: '회복', note: '여관은 몸을, 교회는 상태와 목숨을 되돌린다.',
      actions: ['inn_rest', 'chapel', ...PCS.map(([id]) => `revive_${id}`)] },
  ],
};

// ── 상태창 ────────────────────────────────────────────────────────────
// 다크 아카데미아 팔레트 (원본 CSS의 잉크·리넨·골드) — 8,400줄이 이 40줄로 줄어든 자리.
const pcCards = PCS.map(([id, nick, cls]) => `  <div class="pc{${id}_cond == '전투불능' ? ' ko' : ''}">
    <div class="nm">${nick} <i>${cls} Lv{${id}_level}</i><em>{${id}_cond == '정상' ? '' : ${id}_cond}</em></div>
    <div class="bar"><b>HP {${id}_hp}/{${id}_hp_max}</b><i><s style="width:{floor(${id}_hp * 100 / max(1, ${id}_hp_max))}%"></s></i></div>
    <div class="bar mp"><b>MP {${id}_mp}/{${id}_mp_max}</b><i><s style="width:{floor(${id}_mp * 100 / max(1, ${id}_mp_max))}%"></s></i></div>
  </div>`).join('\n');
const TEMPLATE = `<style>
.pt{display:flex;flex-direction:column;gap:7px;font-size:13px;color:#F5F5DC;background:#1C1917;border:1px solid rgba(212,165,116,.3);border-radius:6px;padding:9px}
.pt .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pt .tag{padding:1px 8px;border:1px solid rgba(212,165,116,.42);border-radius:9px;color:#D4A574;font-size:12px}
.pt .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
.pt .pc{border:1px solid rgba(212,165,116,.16);border-radius:5px;padding:6px 8px}
.pt .pc.ko{opacity:.5;border-color:#991B1B}
.pt .nm{font-weight:700;margin-bottom:3px}
.pt .nm i{font-weight:400;font-style:normal;opacity:.65;font-size:11px;margin-left:4px}
.pt .nm em{font-style:normal;color:#991B1B;font-size:11px;margin-left:5px}
.pt .bar b{display:block;font-weight:400;opacity:.8;font-size:11px}
.pt .bar i{display:block;height:5px;background:rgba(245,245,220,.12);border-radius:3px}
.pt .bar i s{display:block;height:100%;background:#4A5A2A;border-radius:3px}
.pt .bar.mp i s{background:#3F72B0}
.pt .foe{border:1px solid rgba(153,27,27,.55);border-radius:5px;padding:5px 8px}
.pt .foe b{display:block;font-weight:600;font-size:12px;color:#D4A574}
.pt .foe i{display:block;height:6px;background:rgba(245,245,220,.12);border-radius:3px}
.pt .foe i s{display:block;height:100%;background:#991B1B;border-radius:3px}
</style>
<div class="pt">
  <div class="row">
    <span class="tag">{scene}</span>
    <span class="tag">💰 {gold}G</span>
    <span class="tag">📖 XP {party_xp}</span>
    <span class="tag">🎯 {actor} · {check_stat} · DC {dc}</span>
    <span class="tag">{adv ? '✨ 이점 대기' : ''}</span>
  </div>
  <div class="grid">
${pcCards}
  </div>
  <div class="foe" style="{en_engaged ? '' : 'display:none'}">
    <b>⚔️ 교전 — {en_tier} · 단계 {en_band} <em>{en_hp}/{en_hp_max}</em></b>
    <i><s style="width:{en_engaged ? floor(en_hp * 100 / max(1, en_hp_max)) : 0}%"></s></i>
  </div>
  {lastcheck}
  {choices}
  {commands}
</div>`;

// ── 보조 AI ───────────────────────────────────────────────────────────
// 골드·XP·레벨·AP는 시스템 전용 (원본도 Lua 소유였다). 보조는 서사가 실제로 그린 것만:
// 담당·능력·난이도 유지, 위협 선언, 몸 상태 반영.
const UPDATER = {
  contextTurns: 2,
  allow: [
    { id: 'actor' }, { id: 'check_stat' }, { id: 'dc', maxDelta: 8 }, { id: 'need_roll' },
    { id: 'en_active' }, { id: 'en_band', maxDelta: 2 }, { id: 'en_tier' },
    // 원본의 에피소드 보상·상점 거래는 LLM 마커(REWARD/SHOP)였다 — 상한 걸고 같은 자리를 연다.
    // 처치 보상은 시스템(en_down)이 따로 주므로 이건 순수 서사 보상·지출 몫이다.
    { id: 'gold', maxGain: 15, maxLoss: 25 },
    ...PCS.flatMap(([id]) => [
      { id: `${id}_hp`, maxGain: 8, maxLoss: 12 },
      { id: `${id}_mp`, maxGain: 3, maxLoss: 4 },
      { id: `${id}_cond` },
    ]),
  ],
  guide: '주사위는 시스템이 굴린다 — 판정 결과를 절대 정하지 마라. '
    + '판정 담당(actor)은 지금 행동을 선언한 PC로, 판정 능력(check_stat)은 시도의 성격에 맞게, 난이도(dc)는 상황에 맞게 유지하라. '
    + '장면에 싸울 수 있는 위협이 나타나면 en_active를 켜고 en_band(파티 레벨대)·en_tier(체급)를 정하라 — HP는 시스템이 계산한다. '
    + '성패가 갈릴 시도가 나왔는데 판정이 없으면 need_roll을 켜라. '
    + '상태이상(cond)은 서사가 실제로 만든 것만. '
    + '소지금(gold)은 서사에서 보상 획득·거래 지출이 실제로 일어났을 때만 반영하라 — 처치 보상은 시스템이 따로 준다. '
    + 'XP·레벨·AP는 시스템이 정산한다 — 서사가 그렇게 말해도 건드리지 마라.',
};

// ── 스키마 ────────────────────────────────────────────────────────────
const S = {
  simcore: '0.1',
  meta: { name: '페르소나테이블', desc: '동아리 4인이 레벨 1 PC를 굴리고 유저가 GM을 맡는 장편 TRPG 캠페인.' },
  vars: V, derived: D, checks: CHECKS, actions: A,
  rules: { onTurn, events: EVENTS },
  directives: DIRECTIVES,
  party: PARTY,
  promptState: {
    template: '[{scene}] 소지금 {gold}G · XP {party_xp} · 판정: {actor}/{check_stat}/DC {dc}\n'
      + PCS.map(([id, nick, cls]) => `${nick}(${cls} Lv{${id}_level}) HP {${id}_hp}/{${id}_hp_max} MP {${id}_mp}/{${id}_mp_max} {${id}_cond}`).join(' · '),
    includeEvents: true, eventPriority: true,
  },
  updater: UPDATER,
  statusUI: { mode: 'template', template: TEMPLATE },
  setup: {
    presets: [
      { id: 'fresh', label: '첫 세션 (표준)', set: {} },
      { id: 'veteran', label: '이어 하는 캠페인 (Lv3 시작)',
        set: Object.fromEntries([
          ['gold', 120], ['party_xp', 160],
          ...PCS.flatMap(([id, , , main]) => [[`${id}_level`, 3], [`${id}_${main}`, 16]]),
        ]) },
    ],
  },
};

// ── 검증 · 진단 ───────────────────────────────────────────────────────
const val = validateSchema(S);
console.log('━━ 검증 ━━');
if (val.ok) console.log('  통과');
for (const e of val.errors || []) console.log('  ❌', e.path, e.msg);
for (const w of val.warnings || []) console.log('  ⚠️', w.path, w.msg);

if (val.ok) {
  console.log('\n━━ 진단 ━━');
  const dg = diagnose(S, { turns: 120, seed: 'ptable' });
  for (const f of dg.findings || []) console.log(`  [${f.sev}] ${f.tag} — ${f.text}`);
  if (!(dg.findings || []).length) console.log('  지적 없음');

  console.log('\n━━ 시트 패널 ━━');
  const st0 = engine.initState(S);
  st0.vars.soyul_ap = 2;
  const view = party.partyView(S, st0);
  for (const t of view.tabs) {
    const bits = [];
    if (t.slots.length) bits.push(`슬롯 ${t.slots.length}`);
    if (t.items.length) bits.push(`항목 ${t.items.length} (살 수 있음 ${t.items.filter((i) => i.canBuy).length})`);
    if (t.actions.length) bits.push(`버튼 ${t.actions.length}`);
    console.log(`  [${t.label}] ${bits.join(' · ')}`);
  }

  // 판정 등급 분포 — 원본 공식과 어긋나면 여기서 보인다 (DC 13, 보정 +2 기준)
  console.log('\n━━ ck_free 등급 분포 (DC 13, 근력 15 소율, 2000회) ━━');
  {
    const tally = {};
    for (let i = 0; i < 2000; i++) {
      let t = engine.initState(S);
      t.vars.scene = '세션';
      t.meta.armed = { auto_roll: true };
      t = engine.sendPhase(S, t, { rng: seededRng('dist', String(i), 'r') }).state;
      const g = t.meta.lastCheck ? t.meta.lastCheck.grade : '?';
      tally[g] = (tally[g] || 0) + 1;
    }
    for (const [g, n] of Object.entries(tally)) console.log(`  ${g}: ${(n / 20).toFixed(1)}%`);
  }

  // 전투 시뮬 — 밴드별 표준 체급을 4인 로테이션(한나만 MP 있으면 주문)으로 친다.
  // 재는 것: 몇 턴 만에 잡나 / 그 사이 파티가 얼마나 다치나 / 전멸이 나오나.
  console.log('\n━━ 전투 300판 (표준 체급, Lv1 파티 로테이션) ━━');
  for (let band = 1; band <= 5; band++) {
    let turnsSum = 0, koSum = 0, wipe = 0;
    const RUNS = 300, MAXT = 30;
    for (let i = 0; i < RUNS; i++) {
      let t = engine.initState(S);
      t.vars.scene = '세션';
      t.vars.en_active = true; t.vars.en_band = band; t.vars.en_tier = '표준';
      t.vars.gold = 999; // 전투만 잰다 — 회복 경제는 안 섞는다
      t = engine.outputPhase(S, t, {}, {}, { rng: seededRng('spawn', `${band}-${i}`, 'o') }).state; // en_spawn
      let k = 0;
      for (; k < MAXT && t.vars.en_engaged; k++) {
        const alive = PCS.filter(([id]) => t.vars[`${id}_cond`] !== '전투불능');
        if (!alive.length) { wipe++; break; }
        const [aid, anick] = alive[k % alive.length];
        t.vars.actor = anick;
        const useSpell = aid === 'hanna' && t.vars.hanna_mp >= 2;
        t.meta.armed = { [useSpell ? 'cast' : 'attack']: true };
        t = engine.sendPhase(S, t, { rng: seededRng(`b${band}`, `${i}`, `s${k}`) }).state;
        t = engine.outputPhase(S, t, {}, {}, { rng: seededRng(`b${band}`, `${i}`, `o${k}`) }).state;
      }
      turnsSum += k;
      koSum += PCS.filter(([id]) => t.vars[`${id}_cond`] === '전투불능').length;
    }
    console.log(`  단계 ${band} (HP ${EN_TIERS[1][1][band - 1]}·DC ${9 + band * 2 + (band >= 2 ? 2 : 0)})  `
      + `평균 ${(turnsSum / RUNS).toFixed(1)}턴 · KO ${(koSum / RUNS).toFixed(2)}명/판 · 전멸 ${(wipe * 100 / RUNS).toFixed(1)}%`);
  }

  // XP 페이스 — 성공 위주 플레이 기준, 몇 굴림에 레벨이 오르나 (장편 감각 확인)
  console.log('\n━━ XP 페이스 ━━');
  {
    const perRoll = 3.3; // 등급 분포 가중 평균 근사 (성공 4·부분 2·대성공 6·실패 1)
    let acc = 0;
    for (let lv = 1; lv <= 6; lv++) {
      const need = XP_NEED[lv - 1] - acc;
      console.log(`  Lv${lv}→${lv + 1}: 누적 ${XP_NEED[lv - 1]}XP (추가 ${need}XP ≈ 굴림 ${Math.ceil(need / perRoll)}회)`);
      acc = XP_NEED[lv - 1];
    }
  }
}

fs.writeFileSync(__P('페르소나테이블.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('페르소나테이블.json')
  + `  (변수 ${S.vars.length} · 파생 ${S.derived.length} · 판정 ${S.checks.length} · 액션 ${S.actions.length} · 이벤트 ${S.rules.events.length})`);
