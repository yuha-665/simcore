const __P = (...p) => require('path').resolve(__dirname, ...p);
// 죽은 조건들의 "얼마나 모자란지"를 실측한다 + 액션별 기여도
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');
const schema = JSON.parse(fs.readFileSync('E:/0.리수봇/simcore-save-림월드 테스트.json', 'utf8')).schema;
const ACT = schema.actions;
const TURNS = 60, RUNS = 10;

// ── 참조 횟수 (셸 이스케이프 없이) ──
const blob = JSON.stringify({ rules: schema.rules, actions: schema.actions, derived: schema.derived,
  directives: schema.directives, statusUI: schema.statusUI, promptState: schema.promptState });
console.log('\x1b[1m변수가 실제로 읽히는 횟수\x1b[0m');
for (const id of ['climate', 'storyteller', 'temp_target', 'prisoners', 'ship_parts', 'build', 'defense', 'wealth']) {
  const n = (blob.match(new RegExp(`\\b${id}\\b`, 'g')) || []).length;
  const kind = schema.derived.some((d) => d.id === id) ? '파생' : '상태';
  console.log(`  ${id.padEnd(13)} ${kind}  참조 ${String(n).padStart(3)}회`);
}
console.log(`  setup.presets: ${schema.setup.presets.length}개, setup.ai.enabled: ${schema.setup.ai.enabled}`);

// ── 지표 추적 ──
function play(seed, policy) {
  let st = engine.initState(schema);
  const peak = { wealth: 0, margin: -999, build: 0, defense: 0, ship_parts: 0, prisoners: 0, people: 0 };
  let collapsed = null;
  for (let i = 0; i < TURNS; i++) {
    const avail = ACT.filter((a) => engine.actionAvailability(schema, st, a).ok);
    const pick = policy(avail, st, i, seed);
    if (pick) { const t = engine.toggleAction(schema, st, pick.id); if (t.armed) st = t.state; }
    st = engine.sendPhase(schema, st, { rng: seededRng(seed, i, 'send') }).state;
    st = engine.outputPhase(schema, st, {}, {}, { rng: seededRng(seed, i, 'out') }).state;
    const look = engine.makeLookup(schema, st.vars);
    peak.wealth = Math.max(peak.wealth, look('wealth'));
    peak.margin = Math.max(peak.margin, look('raid_margin'));
    for (const k of ['build', 'defense', 'ship_parts', 'prisoners', 'people']) peak[k] = Math.max(peak[k], st.vars[k]);
    if (collapsed === null && st.vars.colony_lost) collapsed = i + 1;
  }
  return { peak, collapsed, st };
}

const POLICIES = {
  '방치 (아무것도 안 함)': () => null,
  '무작위 (아무 버튼이나)': (av, st, i, seed) => av.length ? av[Math.floor(seededRng(seed, i, 'p')() * av.length)] : null,
  '유능 (해로운 버튼 회피)': (av) => {
    // 사람이 실제로 할 법한 선택: 작업 모드는 건설 고정, 배급은 안 건드림, 장기적출/밤샘 회피
    const order = ['treat_all', 'trade_buy', 'trade_sell', 'butcher', 'feast', 'pay_off', 'recruit', 'meds_daily', 'work_build', 'crunch_build'];
    for (const id of order) { const a = av.find((x) => x.id === id); if (a) return a; }
    return null;
  },
};

console.log('\n\x1b[1m정책별 결과 (60턴 × 10시드)\x1b[0m');
for (const [name, pol] of Object.entries(POLICIES)) {
  const rs = Array.from({ length: RUNS }, (_, k) => play(`x${k}`, pol));
  const surv = rs.filter((r) => r.collapsed === null).length;
  const avg = (f) => (rs.reduce((s, r) => s + f(r), 0) / RUNS).toFixed(0);
  console.log(`  ${name.padEnd(22)} 생존 ${surv}/${RUNS}  최고부 ${avg((r) => r.peak.wealth)}`
    + `  최고전력차 ${avg((r) => r.peak.margin)}  최고build ${avg((r) => r.peak.build)}`
    + `  최고defense ${avg((r) => r.peak.defense)}  포로최대 ${avg((r) => r.peak.prisoners)}`);
}

// ── 죽은 조건이 얼마나 모자랐나 ──
console.log('\n\x1b[1m죽은 조건 — 실제 최고치 대비 요구치\x1b[0m');
const best = Array.from({ length: RUNS }, (_, k) => play(`b${k}`, POLICIES['유능 (해로운 버튼 회피)']));
const pk = (f) => Math.max(...best.map(f));
const gap = (label, need, got) => {
  const pct = got <= 0 ? 0 : Math.round((got / need) * 100);
  console.log(`  ${label.padEnd(26)} 필요 ${String(need).padStart(5)}  최고 ${String(got).padStart(5)}  (${pct}%)  ${got >= need ? '✅' : '❌'}`);
};
gap('해적 습격 (wealth)', 2000, pk((r) => r.peak.wealth));
gap('드롭포드 (wealth)', 2500, pk((r) => r.peak.wealth));
gap('공성 (wealth)', 3500, pk((r) => r.peak.wealth));
gap('메카노이드 (wealth)', 4500, pk((r) => r.peak.wealth));
gap('메카 클러스터 (wealth)', 7000, pk((r) => r.peak.wealth));
gap('제국 사절 (wealth)', 3000, pk((r) => r.peak.wealth));
gap('포로 획득 (raid_margin)', 15, pk((r) => r.peak.margin));
gap('굴착병 (defense)', 3, pk((r) => r.peak.defense));
gap('탈출 (ship_parts)', 6, pk((r) => r.peak.ship_parts));
gap('성벽/우주선 (build)', 100, pk((r) => r.peak.build));

// ── 액션 하나만 켜고/빼고 비교 ──
console.log('\n\x1b[1m액션별 기여도 (그 액션만 항상 쓰기 vs 방치)\x1b[0m');
const baseline = Array.from({ length: RUNS }, (_, k) => play(`c${k}`, () => null));
const baseSurv = baseline.filter((r) => r.collapsed === null).length;
const baseLife = baseline.reduce((s, r) => s + (r.collapsed ?? TURNS), 0) / RUNS;
console.log(`  기준(방치): 생존 ${baseSurv}/${RUNS}, 평균 수명 ${baseLife.toFixed(0)}턴`);
const rows = [];
for (const a of ACT) {
  const rs = Array.from({ length: RUNS }, (_, k) => play(`c${k}`, (av) => av.find((x) => x.id === a.id) || null));
  const life = rs.reduce((s, r) => s + (r.collapsed ?? TURNS), 0) / RUNS;
  rows.push([a.id, a.label, life - baseLife, rs.filter((r) => r.collapsed === null).length]);
}
rows.sort((p, q) => q[2] - p[2]);
for (const [id, label, d, surv] of rows) {
  const mark = d > 3 ? '🟢' : d < -3 ? '🔴' : '  ';
  console.log(`  ${mark} ${String(label).padEnd(14)} 수명 ${d >= 0 ? '+' : ''}${d.toFixed(1)}턴  생존 ${surv}/${RUNS}  ${id}`);
}
