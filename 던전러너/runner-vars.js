const __P = (...p) => require('path').resolve(__dirname, ...p);
// 던전러너 — 중세판타지 타르코프 + 던전밥. 골격판(v1).
//
// 설계 한 줄: **레이드 인벤은 숫자, 하이드아웃 창고도 숫자, 사람·옷만 목록.**
//   목록(list)은 add/remove만 되고 전체 교체가 금지라 "죽으면 가방을 통째로 잃는다"를 못 짠다.
//   그래서 휴대품을 등급별 수량(int)으로 두면 사망 이벤트가 `set 0` 한 줄로 턴다 —
//   우회가 아니라 타르코프의 인벤/스태시 분리가 구조로 강제되는 쪽이다.
//
// 시스템이 맡는 것 / AI가 맡는 것의 경계 (베리디아와 같은 기준):
//   매 턴 머리로 굴려야 하는 값 → 시스템 (onTurn·이벤트·판정)
//   서사가 정하는 값           → AI (updater.allow + 상한)
//   유저가 정하는 값           → 패널·명령 (allow에서 뺀다)
// 편성·복장·골드·위치는 **셋째 칸**이다. AI에게 열면 찐빠가 나고, 열 이유도 없다.
//
// 145명 명단·초상화·고용표는 이 골격이 도는 걸 확인한 뒤 명단에서 기계로 붙인다.
// 여기서는 실물 에셋 이름 8명만 넣어 조립(`{{img::{ally1}_{wear1}_default}}`)을 실측한다.
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

// ── 명단 (골격: 실제 배포 명단 145명 중 8명) ───────────────────────────
// 값이 곧 에셋 접두사다 — `Acheron_default_happy_smiling`의 첫 칸.
// 그래서 한글 별칭을 못 쓴다(조립이 깨진다). 화면엔 영문이 뜨고, 부르는 이름은 서사에 맡긴다.
// ⚠ 빈값(party.empty)은 **모든 슬롯의 enum에 들어 있어야** 한다(검증이 막는다). 편성 슬롯과
//   의상 슬롯이 그 값을 공유하므로, 의상 목록에 원래 있는 'default'를 빈값으로 쓴다 —
//   "동료를 뺀다"와 "옷을 벗겨 기본 차림으로 되돌린다"가 같은 버튼이 되어 뜻도 맞는다.
//   빈값은 후보 목록에서 빠지므로 편성 탭에 'default'라는 인물이 뜨는 일은 없다.
const EMPTY = 'default';
const ALLIES = [
  'Acheron', 'Makima', 'Tifa_Lockhart', 'Scathach',
  'Ganyu', 'Mirko', 'Nami', '2B',
];
// 고용 굴림 구간 — 폭이 곧 확률이다. 합이 굴림 상한(HIRE_MAX)과 같아야 한다.
//   [이름, 구간 폭, 등급 표기]
const HIRE_TABLE = [
  ['Acheron', 4, '희귀'], ['Makima', 4, '희귀'], ['Scathach', 4, '희귀'], ['2B', 4, '희귀'],
  ['Tifa_Lockhart', 8, '일반'], ['Ganyu', 8, '일반'], ['Mirko', 8, '일반'], ['Nami', 8, '일반'],
];
const HIRE_MAX = HIRE_TABLE.reduce((a, r) => a + r[1], 0);
const HIRE_COST = 500;

// ── 의상 ──────────────────────────────────────────────────────────────
// 배포 규격의 6벌 그대로. 해금은 재봉대 레벨이 연다 — 목록에 이름이 들어가야 슬롯이 열린다.
const WEARS = ['default', 'dangerous_beast', 'butler', 'cheerleader', 'magical_girl', 'cowkini'];
const WEAR_UNLOCK = [                       // [의상, 필요 재봉대 레벨]
  ['butler', 1], ['cheerleader', 1], ['magical_girl', 2], ['cowkini', 2], ['dangerous_beast', 3],
];
const SLOTS = 5;                            // 편성 자리 — 이 이상은 대기실에만 있는다

// ── 파밍 장소 ─────────────────────────────────────────────────────────
// danger가 곧 난이도 손잡이다: 수색 문턱·탈출 문턱·산출 등급을 한 숫자가 민다.
//   [값, 이름, 위험도, 한 줄, 버튼 이모지]
const PLACES = [
  ['mine', '버려진 폐광', 1, '무너진 갱도. 얕지만 사람 손을 덜 탔다.', '⛏️'],
  ['marsh', '고사리 습지', 2, '무릎까지 잠기는 물. 밟는 소리가 멀리 간다.', '🌿'],
  ['abbey', '무너진 수도원', 3, '성물이 남아 있다는 소문. 그만큼 붐빈다.', '⛪'],
  ['tomb', '왕릉 지하', 4, '지도가 없다. 들어간 자가 돌아온 적이 드물다.', '⚰️'],
];
const HOME = 'hideout';
const placeVals = [HOME, ...PLACES.map((p) => p[0])];
// 위험도·이름을 값에서 끌어오는 파생식 (중첩 삼항 — 표를 고치면 식이 따라온다)
const byPlace = (col, dflt) => PLACES.reduceRight(
  (acc, p) => `place == ${JSON.stringify(p[0])} ? ${JSON.stringify(p[col])} : (${acc})`, JSON.stringify(dflt));

// ── 하이드아웃 시설 ───────────────────────────────────────────────────
//   [id, 이름, 최대, 기본비용, 선행조건, 설명]
const FACILITIES = [
  ['st_storage', '창고', 3, 400, null, '보관 한도를 늘린다. 다른 시설의 뿌리다.'],
  ['st_kitchen', '조리대', 3, 350, 'st_storage >= 1', '전리품을 끼니로 바꾼다. 활력 회복량이 는다.'],
  ['st_water', '정수기', 3, 350, 'st_storage >= 1', '흙탕물을 마실 물로. 수분 회복량이 는다.'],
  ['st_med', '의무실', 3, 500, 'st_storage >= 2', '상처를 꿰맨다. 귀환 시 체력이 회복된다.'],
  ['st_tailor', '재봉대', 3, 600, 'st_storage >= 2', '동료의 옷을 짓는다. 레벨마다 의상이 풀린다.'],
  ['st_scout', '정찰대', 3, 550, 'st_storage >= 1', '탈출로 지도를 모은다. 탈출 판정에 보정.'],
];

// ── 변수 ──────────────────────────────────────────────────────────────
const V = [];
const v = (o) => { V.push(o); return o; };

v({ id: 'gold', label: '금화', type: 'int', init: 300, min: 0, format: '{v}' });
v({ id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 });
v({ id: 'energy', label: '활력', type: 'int', init: 80, min: 0, max: 100, desc: '배고픔. 0이 되면 굶주림이 시작된다.' });
v({ id: 'water', label: '수분', type: 'int', init: 80, min: 0, max: 100, desc: '목마름. 0이 되면 탈수가 시작된다.' });

// 출격은 **장소마다 버튼 하나**다. 목적지 변수 + 출격 버튼 하나로 쪼개면 목적지를 바꾸는 곳이
// 채팅 명령뿐이라, 진단이 "아무도 안 바꾸는 고정 변수"로 읽고 위험도 2 이상을 영영 못 굴려 본다
// (덤으로 난이도별 사건이 전부 죽은 이벤트로 잡힌다). 버튼이 곧 목적지면 그 사각이 사라진다.
v({ id: 'place', label: '현재 위치', type: 'enum', enum: placeVals, init: HOME });
v({ id: 'escape_found', label: '탈출로', type: 'bool', init: false, desc: '찾기 전에는 빠져나갈 수 없다.' });
v({ id: 'raid_turns', label: '체류', type: 'int', init: 0, min: 0, format: '{v}턴' });

// 레이드 인벤 — 죽으면 통째로 잃는 쪽. 그래서 목록이 아니라 숫자다.
v({ id: 'loot_c', label: '짐: 흔한 것', type: 'int', init: 0, min: 0 });
v({ id: 'loot_u', label: '짐: 쓸 만한 것', type: 'int', init: 0, min: 0 });
v({ id: 'loot_r', label: '짐: 귀한 것', type: 'int', init: 0, min: 0 });
// 하이드아웃 창고 — 살아 돌아와야 여기로 들어온다
v({ id: 'stash_c', label: '창고: 흔한 것', type: 'int', init: 4, min: 0 });
v({ id: 'stash_u', label: '창고: 쓸 만한 것', type: 'int', init: 0, min: 0 });
v({ id: 'stash_r', label: '창고: 귀한 것', type: 'int', init: 0, min: 0 });

v({ id: 'starving', label: '굶주림', type: 'bool', init: false });
v({ id: 'dehydrated', label: '탈수', type: 'bool', init: false });

v({ id: 'free_hire', label: '무료 고용권', type: 'int', init: 1, min: 0, format: '{v}장',
  desc: '있으면 고용이 공짜다. 첫 동료는 이걸로 들인다.' });
v({ id: 'roster_ally', label: '보유 동료', type: 'list', init: [], maxItems: 60 });
v({ id: 'roster_wear', label: '보유 의상', type: 'list', init: ['default'], maxItems: 12 });

for (let i = 1; i <= SLOTS; i++) {
  v({ id: `ally${i}`, label: `${i}번 자리`, type: 'enum', enum: [EMPTY, ...ALLIES], init: EMPTY });
  v({ id: `wear${i}`, label: `${i}번 차림`, type: 'enum', enum: WEARS, init: 'default' });
}
for (const [id, label, max, , , desc] of FACILITIES) {
  v({ id, label, type: 'int', init: 0, min: 0, max, desc });
}

// ── 파생 ──────────────────────────────────────────────────────────────
const scale = (id, steps) => steps.slice(0, -1).reduceRight(
  (acc, [n, w]) => `${id} >= ${n} ? ${JSON.stringify(w)} : (${acc})`, JSON.stringify(steps[steps.length - 1][1]));

const D = [
  { id: 'place_name', label: '장소', expr: byPlace(1, '하이드아웃') },
  { id: 'danger', label: '위험도', expr: byPlace(2, 0) },
  { id: 'in_raid', label: '레이드 중', expr: `place != ${JSON.stringify(HOME)}` },
  { id: 'carry', label: '짊어진 것', expr: 'loot_c + loot_u + loot_r' },
  { id: 'stash', label: '창고 재고', expr: 'stash_c + stash_u + stash_r' },
  { id: 'body', label: '몸 상태', expr: scale('hp', [[80, '멀쩡하다'], [55, '지쳤다'], [30, '성치 않다'], [1, '한 걸음이 위태롭다'], [0, '쓰러졌다']]) },
  { id: 'belly', label: '허기', expr: scale('energy', [[70, '든든하다'], [40, '출출하다'], [15, '허기가 심하다'], [0, '굶고 있다']]) },
  { id: 'throat', label: '갈증', expr: scale('water', [[70, '괜찮다'], [40, '목이 마르다'], [15, '입안이 마른다'], [0, '탈수다']]) },
];

// ── 판정 ──────────────────────────────────────────────────────────────
// 굴림은 엔진이 한다 = **리롤해도 같은 눈**. 고용이 리롤 어뷰징에 안 뚫리는 이유이자,
// 수색·탈출의 긴장이 "마음에 안 들면 다시"로 안 무너지는 이유다.
const hireGrades = [];
{
  let lo = 1;
  for (const [name, width, tier] of HIRE_TABLE) {
    const hi = lo + width - 1;
    hireGrades.push({
      when: `total >= ${lo} and total <= ${hi} and not has(roster_ally, ${JSON.stringify(name)})`,
      label: `${name} 합류 (${tier})`,
      effects: [{ list: 'roster_ally', add: [name] }],
      inject: `길드가 ${name}을(를) 데려왔다. 첫인사를 그려라 — 아직 서로를 모른다.`,
    });
    lo = hi + 1;
  }
  hireGrades.push({
    label: '이미 아는 얼굴',
    effects: [{ set: 'gold', expr: 'gold + 150' }],
    inject: '이미 명단에 있는 자가 불려 나왔다. 헛걸음이고, 길드가 수수료 일부를 돌려준다.',
  });
}

const CHECKS = [
  {
    id: 'hire', label: '고용', roll: `rand(1, ${HIRE_MAX})`, grades: hireGrades,
  },
  {
    // ⚠ 위험도는 **뒤지기를 쉽게** 만든다 (사람 손을 덜 탄 곳일수록 물건이 널려 있다).
    //   문턱까지 같이 올리면 위험한 곳이 손해만 주는 자리가 된다 — 실제로 첫 판에서
    //   왕릉(위험 4)의 값어치가 폐광(위험 1)보다 낮게 나왔다. 위험이 값을 치르는 자리는
    //   조우 피해와 탈출 문턱이지 산출이 아니다.
    id: 'search', label: '수색', roll: 'rand(1, 20)', mod: 'floor(hp / 40)', vs: '13 - danger',
    grades: [
      { when: 'total >= vs + 7', label: '노다지', effects: [{ set: 'loot_r', expr: 'loot_r + 1 + floor(danger / 2)' }, { set: 'loot_u', expr: 'loot_u + 1' }], inject: '이번 판의 값어치를 통째로 바꿀 물건이 나왔다.' },
      { when: 'total >= vs', label: '수확', effects: [{ set: 'loot_u', expr: 'loot_u + 1 + floor(danger / 2)' }, { set: 'loot_c', expr: 'loot_c + 2' }], inject: '쓸 만한 것을 챙겼다.' },
      { when: 'total >= vs - 4', label: '푼돈', effects: [{ set: 'loot_c', expr: 'loot_c + 1' }], inject: '손에 잡힌 건 흔한 것뿐이다.' },
      // 실패의 대가가 위험도를 탄다 — 깊은 곳일수록 한 번의 실수가 크다
      { label: '헛디딤', effects: [{ set: 'hp', expr: 'max(0, hp - (12 + danger * 4))' }], inject: '뒤지다 사고가 났다. 소리가 났고, 몸도 상했다.' },
    ],
  },
  {
    id: 'exit', label: '탈출로 탐색', roll: 'rand(1, 20)', mod: 'st_scout * 2', vs: '12 + danger',
    grades: [
      { when: 'total >= vs', label: '발견', effects: [{ set: 'escape_found', expr: 'true' }], inject: '빠져나갈 길을 찾았다. 어디로 어떻게 나가는 길인지 그려라.' },
      { when: 'total >= vs - 3', label: '단서', inject: '길의 윤곽만 잡혔다. 확신은 없다.' },
      { label: '헛수고', effects: [{ set: 'hp', expr: 'max(0, hp - (6 + danger * 2))' }], inject: '엉뚱한 데로 돌았다. 시간과 힘만 버렸다.' },
    ],
  },
];

// ── 액션 ──────────────────────────────────────────────────────────────
// 실행은 우상단 플로팅 버튼. 라벨 맨 앞 이모지가 곧 아이콘이 된다.
const A = [
  ...PLACES.map(([pid, pname, risk, blurb, icon]) => ({
    id: `go_${pid}`, label: `${icon} ${pname}`, mode: 'oneshot',
    when: `place == "hideout" and hp >= 25`,
    effects: [
      { set: 'place', expr: JSON.stringify(pid) },
      { set: 'raid_turns', expr: '0' }, { set: 'escape_found', expr: 'false' },
    ],
    inject: `하이드아웃을 떠나 ${pname}으로 향한다 (${blurb}). 가는 길과 도착했을 때의 첫인상을 그려라.`,
  })),
  {
    id: 'search', label: '🎒 뒤진다', mode: 'oneshot', check: 'search', when: 'place != "hideout"',
    inject: '주변을 뒤져 쓸 만한 것을 찾는다.',
  },
  {
    id: 'findexit', label: '🚪 탈출로를 찾는다', mode: 'oneshot', check: 'exit',
    when: 'place != "hideout" and not escape_found', inject: '빠져나갈 길을 더듬는다.',
  },
  {
    id: 'extract', label: '🏃 탈출한다', mode: 'oneshot', when: 'place != "hideout" and escape_found',
    effects: [
      { set: 'stash_c', expr: 'stash_c + loot_c' }, { set: 'stash_u', expr: 'stash_u + loot_u' }, { set: 'stash_r', expr: 'stash_r + loot_r' },
      { set: 'loot_c', expr: '0' }, { set: 'loot_u', expr: '0' }, { set: 'loot_r', expr: '0' },
      { set: 'place', expr: '"hideout"' }, { set: 'escape_found', expr: 'false' }, { set: 'raid_turns', expr: '0' },
      { set: 'hp', expr: 'min(100, hp + st_med * 8)' },
    ],
    inject: '짐을 지고 탈출로로 빠져나간다. 살아 돌아온 자의 하이드아웃을 그려라.',
  },
  {
    id: 'eat', label: '🍖 먹는다', mode: 'oneshot', when: 'stash_c >= 1 or loot_c >= 1',
    effects: [
      { set: 'loot_c', expr: 'loot_c >= 1 ? loot_c - 1 : loot_c' },
      { set: 'stash_c', expr: 'loot_c >= 1 ? stash_c : max(0, stash_c - 1)' },
      { set: 'energy', expr: 'min(100, energy + 30 + st_kitchen * 8)' },
      { set: 'water', expr: 'min(100, water + 10)' },
    ],
    inject: '가진 것으로 끼니를 때운다. 재료가 무엇이고 어떻게 조리했는지 그려라 — 맛도.',
  },
  {
    id: 'drink', label: '💧 마신다', mode: 'oneshot',
    // 회복량이 해제 문턱(water > 25)과 같으면 한 번 마셔도 탈수가 안 풀린다 — 넘겨야 풀린다
    effects: [{ set: 'water', expr: 'min(100, water + 30 + st_water * 10)' }],
    inject: '물을 마신다. 어디서 얻은 물인지 그려라.',
  },
  {
    id: 'hire', label: '💰 용병을 고용한다', mode: 'oneshot', check: 'hire',
    when: 'place == "hideout" and (free_hire >= 1 or gold >= ' + HIRE_COST + ')',
    effects: [
      { set: 'gold', expr: `gold - (free_hire >= 1 ? 0 : ${HIRE_COST})` },
      { set: 'free_hire', expr: 'max(0, free_hire - 1)' },
    ],
    inject: '용병 길드에 사람을 청한다. 누가 걸어 들어오는지는 길드가 정한다.',
  },
  {
    // 창고에 소비처가 없으면 전리품이 무한히 쌓이기만 한다 (진단의 '단조 자원').
    // 판다 = 값어치가 금화로 바뀌는 유일한 통로이자, 끼니를 축내는 선택이기도 하다.
    // 흔한 것은 안 판다 — 그게 끼니이기 때문이다. 다 넘기게 두면 창고가 늘 0에 눌어붙고
    // (첫 판에서 92%가 바닥이었다) 먹을 것이 영영 없다.
    id: 'sell', label: '💱 상인에게 판다', mode: 'oneshot',
    when: 'place == "hideout" and stash_u + stash_r >= 1',
    effects: [
      { set: 'gold', expr: 'gold + stash_u * 90 + stash_r * 260' },
      { set: 'stash_u', expr: '0' }, { set: 'stash_r', expr: '0' },
    ],
    inject: '값나가는 것만 골라 상인에게 넘긴다 (흔한 것은 끼니로 남긴다). 흥정을 그려라.',
  },
  {
    id: 'rest', label: '🛏️ 쉰다', mode: 'oneshot', when: 'place == "hideout"',
    effects: [{ set: 'hp', expr: 'min(100, hp + 15 + st_med * 5)' }, { set: 'energy', expr: 'max(0, energy - 5)' }],
    inject: '하이드아웃에서 한숨 돌린다.',
  },
];

// ── 규칙·이벤트 ───────────────────────────────────────────────────────
const onTurn = [
  // 하이드아웃은 덜 닳는다 — "레이드가 자원을 태운다"가 이 한 줄에 들어 있다
  { set: 'energy', expr: 'max(0, energy - (place == "hideout" ? 1 : 3))' },
  { set: 'water', expr: 'max(0, water - (place == "hideout" ? 1 : 4))' },
  { set: 'hp', expr: 'clamp(hp - (starving ? 3 : 0) - (dehydrated ? 4 : 0) + (place == "hideout" and not starving and not dehydrated ? 2 : 0), 0, 100)' },
  { set: 'raid_turns', expr: 'place == "hideout" ? 0 : raid_turns + 1' },
];

// ⚠ 시작/끝 이벤트는 **짝**으로. `energy <= 0`만 두면 굶는 동안 매 턴 재발동한다.
const EVENTS = [
  { id: 'starve_on', when: 'energy <= 0 and not starving', effects: [{ set: 'starving', expr: 'true' }],
    notify: '허기가 한계를 넘었다. 손이 떨리고 판단이 흐려진다.' },
  { id: 'starve_off', when: 'energy > 20 and starving', effects: [{ set: 'starving', expr: 'false' }],
    notify: '겨우 배를 채웠다. 떨림이 가라앉는다.' },
  { id: 'thirst_on', when: 'water <= 0 and not dehydrated', effects: [{ set: 'dehydrated', expr: 'true' }],
    notify: '입안이 말라붙었다. 이대로면 오래 못 간다.' },
  { id: 'thirst_off', when: 'water > 20 and dehydrated', effects: [{ set: 'dehydrated', expr: 'false' }],
    notify: '물이 목을 넘어간다. 시야가 다시 잡힌다.' },
  // 추격 — "더 뒤질까, 지금 나갈까"의 긴장은 여기서 나온다. **랜덤이 아니라 조건 이벤트**다:
  // 조건이 참인 동안 매 턴 발동하므로, 오래 머물수록 확실히 조여온다 (확률에 맡기면 욕심이
  // 대가 없이 이긴다 — 첫 판에서 욕심 플레이가 쓰러짐 2%에 기대값 2배였다).
  // 자기해제는 나가는 것뿐이다. 그게 이 이벤트의 요구다.
  { id: 'hunted', when: 'place != "hideout" and raid_turns >= 5',
    effects: [{ set: 'hp', expr: 'max(0, hp - (4 + (raid_turns - 4) * 3 + danger * 2))' }],
    notify: '따라붙는 것이 있다. 여기 너무 오래 있었다 — 머물수록 가까워진다.' },
  // 사망 — 짐을 통째로 잃는다. 숫자로 둔 값어치가 여기서 나온다 (목록이면 이 한 줄이 불가능하다).
  // hp를 되살리는 것이 곧 조건 자기해제다.
  { id: 'down', when: 'hp <= 0',
    effects: [
      { set: 'loot_c', expr: '0' }, { set: 'loot_u', expr: '0' }, { set: 'loot_r', expr: '0' },
      { set: 'place', expr: '"hideout"' }, { set: 'escape_found', expr: 'false' }, { set: 'raid_turns', expr: '0' },
      { set: 'hp', expr: '25' }, { set: 'energy', expr: 'max(20, energy)' }, { set: 'water', expr: 'max(20, water)' },
    ],
    notify: '쓰러졌다. 누군가 끌고 나왔고, 짊어졌던 것은 전부 그 자리에 남았다. 눈을 뜬 곳은 하이드아웃이다.' },
];
// 의상 해금 — 재봉대가 열고, 목록에 이름이 들어가야 의상실 슬롯이 풀린다
for (const [w, lv] of WEAR_UNLOCK) {
  EVENTS.push({
    id: `wear_${w}`, once: true,
    when: `st_tailor >= ${lv} and not has(roster_wear, ${JSON.stringify(w)})`,
    effects: [{ list: 'roster_wear', add: [w] }],
    notify: `재봉대에서 새 옷이 나왔다 (${w}). 이제 의상실에서 입힐 수 있다.`,
  });
}

// 필드 랜덤 — 위치로 게이트를 걸어 장소마다 다른 표가 굴러간다
const randomEvents = {
  chancePerTurn: 0.42,
  table: [
    { id: 'beast', weight: 3, when: 'place != "hideout"', effects: [{ set: 'hp', expr: 'max(0, hp - (8 + danger * 5))' }],
      notify: '무언가와 마주쳤다. 싸웠든 피했든 대가를 치렀다 — 무엇이었는지 그려라.' },
    { id: 'cache', weight: 2, when: 'place != "hideout"', effects: [{ set: 'loot_c', expr: 'loot_c + 2' }],
      notify: '앞서 죽은 자가 남긴 것을 찾았다.' },
    // 깊은 곳 전용 조우 — 위험도가 값을 치르는 자리는 여기다 (산출이 아니라 몸)
    { id: 'horror', weight: 5, when: 'place != "hideout" and danger >= 3 and raid_turns >= 2',
      effects: [{ set: 'hp', expr: 'max(0, hp - (16 + danger * 6))' }],
      notify: '이 안쪽의 것과 마주쳤다. 겨우 떼어 놓았다 — 무엇이었는지, 무엇을 잃었는지 그려라.' },
    { id: 'spring', weight: 2, when: 'place != "hideout" and water < 70', effects: [{ set: 'water', expr: 'min(100, water + 20)' }],
      notify: '마실 만한 물을 찾았다.' },
    { id: 'edible', weight: 2, when: 'place != "hideout" and energy < 70', effects: [{ set: 'energy', expr: 'min(100, energy + 18)' }],
      notify: '먹을 수 있는 것이 눈에 띄었다. 던전밥이다 — 무엇을 어떻게 먹었는지 그려라.' },
    { id: 'deep', weight: 2, when: 'place != "hideout" and raid_turns >= 3 and danger >= 2',
      effects: [{ set: 'loot_r', expr: 'loot_r + 1' }, { set: 'hp', expr: 'max(0, hp - 10)' }],
      notify: '더 안쪽에서 값진 것을 봤다. 손에 넣었지만 대가가 있었다.' },
    // 무료권이 줄기만 하면 반드시 바닥난다 (진단의 '단조 자원'). 동료가 있는 자에게만
    // 이따금 호의가 붙는다 — 첫 무료권과 달리 이건 이미 굴러가는 판에 대한 보상이다.
    { id: 'guild_favor', weight: 1, cooldown: 30,
      when: 'place == "hideout" and free_hire == 0 and count(roster_ally) >= 1',
      effects: [{ set: 'free_hire', expr: 'free_hire + 1' }],
      notify: '용병 길드가 호의를 보냈다 — 다음 한 사람은 값을 받지 않겠다고 한다.' },
    { id: 'peddler', weight: 1, when: 'place == "hideout" and stash_c >= 4',
      effects: [{ set: 'stash_c', expr: 'max(0, stash_c - 2)' }, { set: 'gold', expr: 'gold + 120' }],
      notify: '떠돌이 상인이 들렀다. 흔한 것 몇을 금화로 바꿔 갔다.' },
  ],
};

// ── 지시문 ────────────────────────────────────────────────────────────
// "터지는 것"이 이벤트라면 이건 "깔리는 것". 없으면 수분 0인데 AI가 여유롭게 물을 들이켠다.
const DIRECTIVES = [
  { id: 'here_home', when: 'place == "hideout"',
    text: '지금은 하이드아웃이다. 안전하지만 아무것도 늘지 않는다. 창고 재고 {stash}, 금화 {gold}.' },
  { id: 'here_raid', when: 'place != "hideout"',
    text: '지금은 {place_name} 안이다 (위험도 {danger}, 체류 {raid_turns}). 짊어진 것 {carry}개는 여기서 죽으면 전부 잃는다.' },
  { id: 'no_exit', when: 'place != "hideout" and not escape_found',
    text: '탈출로를 아직 못 찾았다. 나가는 길은 판마다 다르고, 찾기 전에는 빠져나갈 수 없다.' },
  { id: 'exit_open', when: 'escape_found',
    text: '탈출로를 확보했다. 언제든 빠져나갈 수 있지만, 더 뒤질수록 잃을 것도 커진다.' },
  { id: 'body', when: 'hp < 55', text: '몸은 {body}. 무리한 묘사를 하지 마라.' },
  { id: 'need', when: 'energy < 40 or water < 40', text: '허기는 {belly}, 갈증은 {throat}. 대사와 행동에 배어 나오게 하라.' },
  // 동료 — 대기실 인원은 프롬프트에 아예 안 실린다. 등장 인물이 편성으로 고정되는 자리다.
  { id: 'party', when: 'count(roster_ally) >= 1',
    text: '곁에 있는 동료: {deployed}. 명단에 없는 자는 이 장면에 등장하지 않는다. '
      + '차림 — 1번 {wear1} / 2번 {wear2} / 3번 {wear3} / 4번 {wear4} / 5번 {wear5}. 차림에 맞게 묘사하라.' },
  { id: 'alone', when: 'count(roster_ally) == 0',
    text: '아직 동료가 없다. 혼자다. 용병 길드에서 사람을 들일 수 있다.' },
];

// ── 편성표 ────────────────────────────────────────────────────────────
// ⚠ unique를 끈 이유: unique는 party 전역 설정인데, 켜 두면 **의상 슬롯끼리 충돌한다**
//   (둘 이상이 같은 옷을 못 입는다 — 전원 'default'로 시작하므로 즉시 걸린다).
//   지금은 끄는 게 유일한 답이고, 대가는 한 인물을 두 자리에 앉힐 수 있다는 것.
const PARTY = {
  label: '편성', icon: '⚔️', empty: EMPTY, unique: false, nav: 'select',
  note: '뽑고 · 앉히고 · 입히고 · 짓는다.',
  portraits: Object.fromEntries(ALLIES.map((n) => [n, `${n}_default_default`])),
  tabs: [
    {
      id: 'squad', label: '편성', roster: 'roster_ally',
      note: '보유한 동료만 앉는다. 자리에 없는 동료는 대기실에 있고 장면에 등장하지 않는다.',
      slots: Array.from({ length: SLOTS }, (_, i) => ({ var: `ally${i + 1}`, label: `${i + 1}번 자리` })),
    },
    {
      id: 'wardrobe', label: '의상실', roster: 'roster_wear',
      note: '재봉대를 올리면 잠긴 옷이 풀린다.',
      slots: Array.from({ length: SLOTS }, (_, i) => ({ var: `wear${i + 1}`, label: `${i + 1}번 차림` })),
    },
    {
      id: 'hideout', label: '하이드아웃', points: 'gold',
      note: '금화로 짓는다. 비용은 레벨마다 오른다.',
      items: FACILITIES.map(([id, label, max, base, req, note]) => ({
        var: id, label, max, note,
        cost: `${base} * (${id} + 1)`,
        ...(req ? { requires: req, requiresLabel: '선행 시설이 부족하다' } : {}),
      })),
    },
    { id: 'guild', label: '용병 길드', note: '무료권이 있으면 공짜, 없으면 금화 ' + HIRE_COST + '. 누가 올지는 길드가 정한다.', actions: ['hire'] },
    { id: 'sortie', label: '출격', note: '위험도가 높을수록 산출도 크고 실수의 대가도 크다.', actions: PLACES.map((p) => `go_${p[0]}`) },
  ],
};

// ── 상태창 ────────────────────────────────────────────────────────────
// 초상화는 `{{img::{ally1}_{wear1}_default}}` 조립 — 프롬프트 비용 0, 리롤에 안 흔들린다.
// 빈 자리는 Empty_default_default(투명 PNG 한 장)로 떨어진다.
// 빈 자리는 두 칸을 함께 갈아 끼워 `blank_default_default` 한 장으로 떨어뜨린다 —
// 안 그러면 `default_{차림}_default`가 조합마다 필요해진다 (투명 PNG를 6장 만들 이유가 없다).
const portraitCells = Array.from({ length: SLOTS }, (_, i) => {
  const a = `ally${i + 1}`, w = `wear${i + 1}`;
  const who = `{${a} == '${EMPTY}' ? 'blank' : ${a}}`;
  const wear = `{${a} == '${EMPTY}' ? 'default' : ${w}}`;
  return `  <figure class="who"><img src="{{img::${who}_${wear}_default}}" alt="">`
    + `<figcaption>{${a} == '${EMPTY}' ? '빈 자리' : ${a}}</figcaption></figure>`;
}).join('\n');
const TEMPLATE = `<style>
.hud{display:flex;flex-direction:column;gap:8px;font-size:13px}
.hud .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.hud .tag{padding:1px 7px;border:1px solid currentColor;border-radius:9px;opacity:.85}
.hud .bar{flex:1;min-width:110px}
.hud .bar b{display:block;font-weight:600;opacity:.7;font-size:11px}
.hud .bar i{display:block;height:6px;background:currentColor;opacity:.3;border-radius:3px}
.hud .bar i s{display:block;height:100%;background:currentColor;opacity:1;border-radius:3px}
.hud .squad{display:flex;gap:6px;overflow-x:auto}
.hud .who{margin:0;text-align:center;flex:0 0 62px}
.hud .who img{width:62px;height:62px;object-fit:cover;border-radius:6px;display:block}
.hud .who figcaption{font-size:10px;opacity:.7;word-break:break-all}
.hud .risk{color:#c0392b;font-weight:600}
</style>
<div class="hud">
  <div class="row">
    <span class="tag">📍 {place_name}</span>
    <span class="tag">💰 {gold}</span>
    <span class="tag">🎒 {loot_c}·{loot_u}·<b>{loot_r}</b></span>
    <span class="tag">📦 {stash_c}·{stash_u}·<b>{stash_r}</b></span>
    <span class="tag">🎟️ {free_hire}</span>
    <span class="{escape_found ? 'tag' : 'tag risk'}">{place == 'hideout' ? '안전' : (escape_found ? '탈출로 확보' : '탈출로 미발견')}</span>
  </div>
  <div class="row">
    <span class="bar"><b>체력 {hp} · {body}</b><i><s style="width:{hp}%"></s></i></span>
    <span class="bar"><b>활력 {energy} · {belly}</b><i><s style="width:{energy}%"></s></i></span>
    <span class="bar"><b>수분 {water} · {throat}</b><i><s style="width:{water}%"></s></i></span>
  </div>
  <div class="squad">
${portraitCells}
  </div>
  {lastcheck}
  {choices}
  {commands}
</div>`;

// ── 보조 AI ───────────────────────────────────────────────────────────
// 편성·복장·위치·금화·시설은 **넣지 않는다** — 유저가 정하는 축이고, enum 후보 145개가
// 프롬프트에 실릴 자리이기도 하다. 보조는 서사가 실제로 그린 몸 상태만 만진다.
const UPDATER = {
  contextTurns: 2,
  allow: [
    { id: 'hp', maxGain: 10, maxLoss: 20 },
    { id: 'energy', maxGain: 15, maxLoss: 15 },
    { id: 'water', maxGain: 15, maxLoss: 15 },
    { id: 'loot_c', maxDelta: 2 },
    { id: 'loot_u', maxDelta: 1 },
    { id: 'loot_r', maxDelta: 1 },
  ],
  guide: '서사가 실제로 그린 것만 반영하라. 전리품은 장면에서 손에 넣은 것이 분명할 때만 올려라. '
    + '이동·편성·의상·금화·시설은 시스템이 정한다 — 서사가 그렇게 말해도 건드리지 마라.',
};

const S = {
  simcore: '0.1',
  meta: { name: '던전러너', desc: '하이드아웃에서 나가 파밍하고 살아 돌아온다. 잃는 건 짊어진 것뿐이다.' },
  vars: V, derived: D, checks: CHECKS, actions: A,
  rules: { onTurn, events: EVENTS, randomEvents },
  directives: DIRECTIVES,
  party: PARTY,
  promptState: {
    template: '위치 {place_name} · 체력 {hp}({body}) · 활력 {energy}({belly}) · 수분 {water}({throat})\n'
      + '짐 {carry} · 창고 {stash} · 금화 {gold} · 동료 {deployed}',
    includeEvents: true, eventPriority: true,
  },
  updater: UPDATER,
  statusUI: { mode: 'template', template: TEMPLATE },
  setup: {
    presets: [
      { id: 'normal', label: '평범한 시작', set: {} },
      { id: 'poor', label: '맨몸 (어려움)', set: { gold: 80, stash_c: 0, hp: 80, energy: 55, water: 55 } },
      { id: 'veteran', label: '전직 러너 (쉬움)', set: { gold: 900, stash_c: 5, stash_u: 2, st_storage: 1, free_hire: 2 } },
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
  const dg = diagnose(S, { turns: 120, seed: 'runner' });
  for (const f of dg.findings || []) console.log(`  [${f.sev}] ${f.tag} — ${f.text}`);
  if (!(dg.findings || []).length) console.log('  지적 없음');

  console.log('\n━━ 편성표 ━━');
  const st = engine.initState(S);
  st.vars.roster_ally = ['Acheron', 'Nami'];
  st.vars.ally1 = 'Acheron'; st.vars.wear1 = 'cheerleader';
  st.vars.ally2 = 'Nami';
  const view = party.partyView(S, st);
  for (const t of view.tabs) {
    const bits = [];
    if (t.slots.length) bits.push(`슬롯 ${t.slots.length} (후보 ${t.slots[0].candidates.length}, 잠김 ${t.slots[0].candidates.filter((c) => c.locked).length})`);
    if (t.items.length) bits.push(`항목 ${t.items.length} (살 수 있음 ${t.items.filter((i) => i.canBuy).length})`);
    if (t.actions.length) bits.push(`버튼 ${t.actions.length}`);
    console.log(`  [${t.label}] ${bits.join(' · ')}`);
  }

  console.log('\n━━ 상태창 초상화 조립 ━━');
  const html = renderStatusHtml(S, st, []);
  for (const m of html.match(/\{\{img::[^}]+\}\}/g) || []) console.log('  ' + m);

  // 100판 시뮬 — 죽는 판/빈손 판 비율이 장르로서 말이 되는가
  // 레이드 시뮬 — 러너처럼 군다: 두 턴 뒤지고, 탈출로를 찾을 때까지 찾고, 찾으면 나온다.
  // 재는 것은 셋. **살아 나오나 / 얼마를 들고 나오나 / 못 나온 판은 왜인가.**
  console.log('\n━━ 레이드 300판 (최대 10턴, 두 턴 뒤진 뒤 탈출로 탐색 → 발견 즉시 탈출) ━━');
  // ⚠ seededRng(chatId, msgIndex, label) — 인자는 **셋**이다. 넷째를 넘기면 조용히 무시돼
  //   판마다 같은 난수열이 나온다(첫 판이 통째로 같은 눈으로 굴렀다). 턴을 label에 싣는다.
  // 두 전략을 나란히 재야 설계가 보인다. 신중만 재면 "쓰러짐 0%"가 나오는데, 그건
  // 밸런스가 무르다는 뜻이 아니라 **욕심을 안 부렸다**는 뜻이다. 장르의 긴장은 둘의 격차다:
  // 신중이 안전하고 가난한가, 욕심이 부유하고 위험한가.
  const RUNS = 300, MAXT = 12;
  //  [이름, 몇 턴까지 뒤지고 나서 탈출로를 찾을 것인가]
  const STYLES = [['신중', 2], ['욕심', 6]];
  for (const [pid, pname, risk] of PLACES) {
    const line = [];
    for (const [sname, greed] of STYLES) {
      let out = 0, down = 0, stuck = 0, haul = 0, turns = 0;
      for (let i = 0; i < RUNS; i++) {
        let t = engine.initState(S);
        t.vars.place = pid;
        const base = t.vars.stash_c + t.vars.stash_u + t.vars.stash_r;
        let downed = false, k = 0;
        for (; k < MAXT && t.vars.place !== HOME; k++) {
          // 욕심: 정해진 턴까지는 탈출로를 찾았어도 계속 뒤진다
          const act = (k < greed) ? 'search' : (t.vars.escape_found ? 'extract' : 'findexit');
          t.meta.armed = { [act]: true };
          t = engine.sendPhase(S, t, { rng: seededRng(pid, `${sname}${i}`, `s${k}`) }).state;
          const before = t.vars.hp;
          t = engine.outputPhase(S, t, {}, {}, { rng: seededRng(pid, `${sname}${i}`, `o${k}`) }).state;
          if (before > 0 && t.vars.hp === 25 && t.vars.place === HOME) { downed = true; break; }  // down 이벤트가 끌어냄
        }
        turns += k;
        if (downed) down++;
        else if (t.vars.place === HOME) { out++; haul += (t.vars.stash_c + t.vars.stash_u + t.vars.stash_r) - base + t.vars.stash_r * 2; }
        else stuck++;
      }
      const pc = (n) => String(Math.round(n * 100 / RUNS)).padStart(3) + '%';
      // 기대값 = 살아 나올 확률 × 들고 나온 값어치. 이게 두 전략을 비교하는 유일한 잣대다.
      const ev = (haul / RUNS).toFixed(1);
      line.push(`${sname} 탈출 ${pc(out)}·쓰러짐 ${pc(down)}·못나옴 ${pc(stuck)} ${(turns / RUNS).toFixed(1)}턴 기대값 ${String(ev).padStart(4)}`);
    }
    console.log(`  ${pname.padEnd(12)}(위험 ${risk})  ${line.join('   |   ')}`);
  }
}

fs.writeFileSync(__P('던전러너.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('던전러너.json')
  + `  (변수 ${S.vars.length} · 파생 ${S.derived.length} · 판정 ${S.checks.length} · 액션 ${S.actions.length} · 이벤트 ${S.rules.events.length})`);
