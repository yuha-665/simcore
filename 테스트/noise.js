const __P = (...p) => require('path').resolve(__dirname, ...p);
// 액션 기여도의 실제 노이즈 바닥을 잰다 — 같은 스키마를 시드만 바꿔 여러 번.
// diagnose 내부와 똑같은 방식(짝지은 시드)으로 재되, 시드별 델타를 전부 남긴다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');
const { validateSchema } = SC.require('validate');
const { pickLoseVar } = SC.require('diagnose');

const save = JSON.parse(fs.readFileSync(process.argv[2] || 'E:/0.리수봇/simcore-save-림월드 테스트.json', 'utf8'));
const schema = save.schema || save;
const v = validateSchema(schema);
if (!v.ok) { console.log('검증 실패:', v.errors.slice(0, 3)); process.exit(1); }

const ACT = schema.actions || [];
const loseVar = pickLoseVar(schema);
const TURNS = Number(process.argv[3] || 120);
console.log(`스키마: ${schema.meta?.name} | 액션 ${ACT.length}개 | 패배변수 ${loseVar} | ${TURNS}턴\n`);

function sim(seed, policy) {
  let st = engine.initState(schema);
  let lost = null;
  for (let i = 0; i < TURNS; i++) {
    let avail = [];
    try { avail = ACT.filter((a) => engine.actionAvailability(schema, st, a).ok); } catch (e) { /* ignore */ }
    const pick = policy(avail, st, i, seed);
    if (pick) { const t = engine.toggleAction(schema, st, pick.id); if (t.armed) st = t.state; }
    st = engine.sendPhase(schema, st, { rng: seededRng(seed, i, 'send') }).state;
    st = engine.outputPhase(schema, st, {}, {}, { rng: seededRng(seed, i, 'out') }).state;
    if (lost === null && loseVar && st.vars[loseVar]) lost = i + 1;
  }
  return lost ?? TURNS;
}
const rest = (av, a, seed, i) => {
  const ok = av.filter((x) => x.id !== a.id);
  return ok.length ? ok[Math.floor(seededRng(seed, i, 'pick')() * ok.length)] : null;
};
const onPick = (a) => (av, st, i, seed) => {
  if ((a.mode || 'oneshot') === 'hold' && st.meta?.armed?.[a.id]) return rest(av, a, seed, i);
  return av.find((x) => x.id === a.id) || rest(av, a, seed, i);
};

const N = Number(process.argv[4] || 60);   // 시드 개수
const numericIds = new Set(schema.vars.filter((x) => x.type !== 'enum' && x.type !== 'bool').map((x) => x.id));
const isPolicySwitch = (a) => (a.effects || []).length > 0 && (a.effects || []).every((f) => !numericIds.has(f.set ?? f.list));

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

const rows = [];
for (const a of ACT) {
  if (isPolicySwitch(a)) continue;
  const paired = [], onLife = [], offLife = [];
  for (let k = 0; k < N; k++) {
    const s = `on${k}`;
    const o = sim(s, onPick(a)), f = sim(s, (av, st, i, sd2) => rest(av, a, sd2, i));
    onLife.push(o); offLife.push(f); paired.push(o - f);
  }
  // 짝지은 차이의 표준오차 (지금 방식) vs 짝을 안 지었다면의 표준오차
  const sePaired = sd(paired) / Math.sqrt(N);
  const seUnpaired = Math.sqrt(sd(onLife) ** 2 / N + sd(offLife) ** 2 / N);
  // 6시드로 잘랐을 때 나오는 값들 — 실제 진단이 보는 숫자의 흔들림
  const win = [];
  for (let s0 = 0; s0 + 6 <= N; s0 += 6) win.push(mean(paired.slice(s0, s0 + 6)));
  rows.push({ id: a.id, label: a.label ?? a.id, delta: mean(paired), sdP: sd(paired),
    sePaired, seUnpaired, win, winRange: Math.max(...win) - Math.min(...win) });
}
rows.sort((p, q) => q.delta - p.delta);

console.log(`시드 ${N}개, 짝지은 차이(paired) 기준\n`);
console.log('액션'.padEnd(20) + '평균Δ'.padStart(8) + '  ±95%CI'.padStart(10) + '   6시드 표본들'.padEnd(30) + ' 6시드 편차');
console.log('─'.repeat(96));
for (const r of rows) {
  const ci = 1.96 * r.sePaired;
  const sig = Math.abs(r.delta) > ci ? '' : '  (0과 구분 안 됨)';
  console.log(
    r.label.padEnd(20) + (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1).padStart(7)
    + ('±' + ci.toFixed(1)).padStart(10) + '   '
    + r.win.map((x) => (x >= 0 ? '+' : '') + x.toFixed(0)).join(' ').padEnd(27)
    + (r.winRange.toFixed(0) + '턴').padStart(7) + sig);
}
console.log('\n짝짓기(공통 난수) 효과 — 표준오차 비교');
console.log('액션'.padEnd(20) + ' 짝지음'.padStart(8) + ' 안 짝지음'.padStart(10) + '  분산 감소');
console.log('─'.repeat(52));
for (const r of rows) {
  console.log(r.label.padEnd(20) + r.sePaired.toFixed(2).padStart(8) + r.seUnpaired.toFixed(2).padStart(10)
    + ('×' + (r.seUnpaired / Math.max(0.001, r.sePaired)).toFixed(1)).padStart(11));
}
const avgWin = mean(rows.map((r) => r.winRange));
console.log(`\n▶ 6시드 표본 간 최대-최소 편차 평균: ${avgWin.toFixed(1)}턴  (= 실질 노이즈 바닥)`);
console.log(`▶ 6시드 95% 신뢰구간 폭 평균: ±${mean(rows.map((r) => 1.96 * r.sdP / Math.sqrt(6))).toFixed(1)}턴`);
console.log(`▶ 30시드로 올리면: ±${mean(rows.map((r) => 1.96 * r.sdP / Math.sqrt(30))).toFixed(1)}턴`);
