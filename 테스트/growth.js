const __P = (...p) => require('path').resolve(__dirname, ...p);
// 베리디아 성장 루프 — "초반엔 유입이 힘들다"를 규칙에서 자동으로 나오게 한다.
//
// 유입을 이벤트로 "몇 턴 뒤 사람이 온다"고 박아두면 판마다 똑같아진다.
// 대신 조건만 걸어 둔다: 먹이고 남아야(잉여) · 소문이 나야(명성) · 재울 곳이 있어야(주거).
// 그러면 초반 정체는 설계가 아니라 결과다 — 110명 먹이는 데 밭 인원이 다 들어가니까.
//
// 그리고 성장은 보상이면서 새 문제다: 사람이 늘면 먹일 입도, 치안 부담도, 잘 곳도 는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

// 노동 정책 — 버튼 4개로 배분이 통째로 바뀐다. 개별 배치 버튼 8개를 두지 않기 위한 장치.
const POLICY = [
  //                밭    건설  경비  탐사
  ['생존 우선', 0.60, 0.10, 0.20, 0.10],
  ['재건 우선', 0.35, 0.40, 0.20, 0.05],
  ['방비 우선', 0.35, 0.15, 0.45, 0.05],
  ['개척 우선', 0.35, 0.15, 0.20, 0.30],
];
const share = (col) => POLICY.slice(0, -1).reduceRight(
  (acc, p, i) => `policy == ${JSON.stringify(p[0])} ? ${p[col]} : (${acc})`, String(POLICY[POLICY.length - 1][col]));

const S = {
  simcore: '0.1',
  meta: { name: '베리디아 재건' },
  vars: [
    { id: 'day', label: '경과일', type: 'int', init: 0, min: 0 },
    { id: 'pop', label: '주민', type: 'int', init: 110, min: 0, format: '{v}명' },
    // 단위는 '인분·일'. 110명이 하루 110을 먹으므로 900이면 여드레치다.
    { id: 'food', label: '식량 비축', type: 'int', init: 900, min: 0 },
    { id: 'health', label: '보건', type: 'int', init: 25, min: 0, max: 100 },
    { id: 'morale', label: '사기', type: 'int', init: 30, min: 0, max: 100 },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'housing', label: '수용 가능', type: 'int', init: 120, min: 0, format: '{v}명' },
    { id: 'unrest', label: '치안 불안', type: 'int', init: 10, min: 0, max: 100 },
    { id: 'policy', label: '노동 정책', type: 'enum', enum: POLICY.map((p) => p[0]), init: '생존 우선' },
    // 지형에서 오는 값. 여기서는 시나리오별로 갈아끼워 성장 곡선이 어떻게 달라지는지 본다.
    { id: 'arable', label: '경작 적성', type: 'int', init: 4, min: 0, max: 12 },
    { id: 'ruined', label: '영지 붕괴', type: 'bool', init: false },
  ],
  derived: [
    // 노인·여자·부상병이 태반이라 처음엔 절반도 일을 못 한다. 보건이 오르면 나아진다.
    { id: 'able', label: '노동 가능', expr: 'round(pop * (0.38 + health * 0.0035))' },
    // 먹이고 재운 정도가 곧 일의 능률 — "식량 쓰고 휴식하면 게이지가 찬다"를 미시관리 없이 흡수한다
    { id: 'efficiency', label: '능률', expr: 'clamp(35 + health * 0.45 + morale * 0.2, 20, 100)' },
    { id: 'farm_men', label: '밭', expr: `round(able * (${share(1)}))` },
    { id: 'build_men', label: '건설', expr: `round(able * (${share(2)}))` },
    { id: 'guard_men', label: '경비', expr: `round(able * (${share(3)}))` },
    { id: 'scout_men', label: '탐사', expr: `round(able * (${share(4)}))` },
    // 산출 = 인원 × 땅 × 능률. 농부 하나가 몇 사람을 먹이느냐가 이 판의 전부다.
    // 척박한 땅(경작 2)에선 3.3명분, 기름진 땅(경작 7)에선 6.1명분 — 능률이 여기에 다시 곱해진다.
    // 탐사 인원은 사냥·채집으로 조금 보탠다. 안 그러면 '개척 우선'이 순손해라 아무도 안 고른다.
    { id: 'harvest', label: '수확',
      expr: 'round((farm_men * (2.2 + arable * 0.55) + scout_men * 1.2) * efficiency * 0.01)' },
    { id: 'eaten', label: '소비', expr: 'pop' },
    { id: 'surplus', label: '잉여', expr: 'harvest - eaten' },
    { id: 'crowding', label: '과밀', expr: 'max(0, pop - housing)' },
    // 유입 — 셋이 다 맞아야 사람이 온다. 초반 정체는 여기서 자동으로 나온다.
    { id: 'draw', label: '유입 여력',
      expr: 'surplus > 4 and fame >= 12 and crowding <= 0 ? round(min(surplus * 0.25, 6) * (1 + fame * 0.01)) : 0' },
    { id: 'guard_need', label: '필요 경비', expr: 'round(pop * 0.10)' },
    { id: 'phase', label: '국면',
      expr: 'pop >= 400 ? "번성" : (pop >= 220 ? "성장" : (surplus > 0 ? "자립" : "연명"))' },
  ],
  rules: {
    onTurn: [
      { set: 'day', expr: 'day + 1' },
      { set: 'food', expr: 'max(0, food + surplus)' },
      // ⚠ 처음엔 '잉여가 나야 보건이 오른다'로 짰다가 교착에 빠졌다 —
      //   보건이 낮으면 일할 사람이 적어 잉여가 안 나고, 잉여가 없으니 보건도 안 오른다.
      //   곳간이 비지 않은 동안은 천천히라도 오르게 해야 초반을 뚫을 여지가 생긴다.
      //   비축 식량이 곧 "체력을 끌어올릴 시간"이고, 그 시간 안에 자립해야 한다.
      { set: 'health', expr: 'clamp(health + (food <= 0 ? -7 : (surplus > 0 ? 2 : 1)) - (crowding > 0 ? 3 : 0), 0, 100)' },
      { set: 'morale', expr: 'clamp(morale + (food <= 0 ? -6 : 1) - (unrest >= 50 ? 3 : 0) - (crowding > 0 ? 2 : 0), 0, 100)' },
      // 사람이 늘수록 경비가 더 필요하다 — 성장이 곧 새 문제
      { set: 'unrest', expr: 'clamp(unrest + (guard_men < guard_need ? 2 : -3) + (food <= 0 ? 5 : 0), 0, 100)' },
      // 명성은 "여기 가면 살 수 있다"는 소문. 잉여가 나야 퍼진다.
      { set: 'fame', expr: 'clamp(fame + (surplus > 4 ? 2 : 0) + (phase == "성장" or phase == "번성" ? 1 : 0) - (unrest >= 60 ? 2 : 0), 0, 100)' },
      { set: 'pop', expr: 'max(0, pop + draw - (food <= 0 ? round(pop * 0.04) : 0) - (health <= 10 ? round(pop * 0.03) : 0))' },
    ],
    events: [
      { id: 'collapse', when: 'pop <= 40 and not ruined',
        effects: [{ set: 'ruined', expr: '1' }],
        notify: '남은 사람이 마흔도 되지 않는다. 영지는 더 이상 영지가 아니다.' },
    ],
  },
  directives: [],
  actions: [
    ...POLICY.map((p, i) => ({
      id: `pol${i}`, label: `${['🌾', '🔨', '🛡', '🧭'][i]} ${p[0]}`, mode: 'oneshot', cooldown: 2,
      when: `policy != ${JSON.stringify(p[0])}`,
      inject: `[영지 결정] 노동력 배분을 '${p[0]}'로 바꾼다.`,
      effects: [{ set: 'policy', expr: JSON.stringify(p[0]) }],
    })),
    { id: 'build_house', label: '🏘 주거 증축', mode: 'oneshot', cooldown: 3,
      when: 'build_men >= 12 and food >= 250',
      inject: '[영지 결정] 무너진 집들을 손봐 사람이 더 살 수 있게 한다.',
      effects: [{ set: 'housing', expr: 'housing + 60' }, { set: 'food', expr: 'max(0, food - 25)' }] },
    { id: 'clear_field', label: '🌱 개간', mode: 'oneshot', cooldown: 4,
      when: 'build_men >= 15 and arable < 12 and food >= 300',
      inject: '[영지 결정] 묵은 땅을 갈아엎어 경작지를 넓힌다.',
      effects: [{ set: 'arable', expr: 'min(12, arable + 1)' }, { set: 'food', expr: 'max(0, food - 30)' }] },
  ],
  statusUI: { mode: 'auto', groups: [
    { label: '영지', items: [{ var: 'pop' }, { var: 'phase' }, { var: 'food' }, { var: 'surplus' }] },
    { label: '민생', items: [{ var: 'health', bar: { max: 100 } }, { var: 'morale', bar: { max: 100 } },
      { var: 'unrest', bar: { max: 100 } }, { var: 'fame', bar: { max: 100 } }] },
    { label: '노동', items: [{ var: 'policy' }, { var: 'able' }, { var: 'farm_men' }, { var: 'build_men' },
      { var: 'guard_men' }, { var: 'scout_men' }] },
  ] },
  promptState: { template: '[베리디아 {day}일차 · {phase}] 주민 {pop}명 · 식량 {food}(잉여 {surplus}) · 보건 {health} · 사기 {morale} · 치안불안 {unrest} · 명성 {fame} · 노동 {policy}({able}명 가동)' },
  setup: { presets: [] },
};

const v = validateSchema(S);
console.log('검증:', v.ok ? '통과' : '실패');
for (const e of v.errors) console.log('  ✗', e.path, e.msg);
if (!v.ok) process.exit(1);

// ── 지형이 성장 곡선을 바꾸는가 ──────────────────────────────
function run(arable, turns, plan) {
  let st = engine.initState(S); st.meta.setupDone = true;
  st.vars.arable = arable;
  const log = [];
  for (let i = 0; i < turns; i++) {
    const a = plan(st, i);
    if (a) { const t = engine.toggleAction(S, st, a); if (t.armed) st = t.state; }
    st = engine.sendPhase(S, st, { rng: seededRng('g', i, 's') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('g', i, 'o') }).state;
    const L = engine.makeLookup(S, st.vars);
    log.push({ t: i + 1, pop: st.vars.pop, sur: L('surplus'), fame: st.vars.fame, ph: L('phase'), un: st.vars.unrest });
  }
  return log;
}
// 그럴듯한 플레이: 잉여가 날 때까지 생존 우선 → 나면 재건으로 → 불안하면 방비로
const smart = (st, i) => {
  const L = engine.makeLookup(S, st.vars);
  if (st.vars.unrest >= 55 && st.vars.policy !== '방비 우선') return 'pol2';
  if (L('crowding') > 0 && L('build_men') >= 12) return 'build_house';
  if (L('surplus') > 6 && st.vars.policy === '생존 우선') return 'pol1';
  if (st.vars.policy === '재건 우선' && L('build_men') >= 15 && st.vars.arable < 9) return 'clear_field';
  if (L('surplus') < 0 && st.vars.policy !== '생존 우선') return 'pol0';
  return null;
};

for (const [arable, name] of [[2, '척박한 변경 (경작 2)'], [4, '고른 땅 (경작 4)'], [7, '기름진 땅 (경작 7)']]) {
  const log = run(arable, 60, smart);
  console.log(`\n━━ ${name} ━━`);
  for (const r of log) {
    if (r.t % 8 === 0 || r.t === 1) {
      console.log(`  ${String(r.t).padStart(2)}일  주민 ${String(r.pop).padStart(3)}명  잉여 ${String(r.sur).padStart(4)}  명성 ${String(r.fame).padStart(2)}  불안 ${String(r.un).padStart(2)}  [${r.ph}]`);
    }
  }
  const first = log.find((r) => r.pop > 110);
  console.log(`  → 첫 유입: ${first ? first.t + '일차' : '끝내 없음'} · 60일 후 ${log[log.length - 1].pop}명`);
}

console.log('\n━━ 아무 정책도 안 바꾸면 (생존 우선 고정, 경작 4) ━━');
const idle = run(4, 60, () => null);
for (const r of idle) if (r.t % 15 === 0) console.log(`  ${String(r.t).padStart(2)}일  주민 ${r.pop}명  잉여 ${r.sur}  [${r.ph}]`);

const d = diagnose(S, { turns: 60, runs: 6 });
console.log('\n━━ 진단 ━━');
console.log(`방치 생존 ${d.stats.idleSurvive}/6 (평균 ${d.stats.idleLife.toFixed(0)}턴) · 플레이 ${d.stats.playSurvive}/6 (평균 ${d.stats.playLife.toFixed(0)}턴)`);
const sev = { high: '🔴', mid: '🟡', low: '🔵' };
for (const f of d.findings) console.log(` ${sev[f.sev]} [${f.tag}] ${f.text.slice(0, 105)}`);

fs.writeFileSync('E:/0.리수봇/영지-성장루프-시안.json', JSON.stringify(S, null, 2));
